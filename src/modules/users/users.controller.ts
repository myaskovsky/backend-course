import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import type { RequestUser } from '@/modules/auth/auth.constants';
import { ChallengeService } from '@/modules/auth/challenge.service';
import { CurrentUser } from '@/modules/auth/decorators/current-user.decorator';
import { ConfirmDto } from '@/modules/auth/dto/confirm.dto';
import { ChallengeType } from '@/modules/auth/entities/email-challenge.entity';
import { ConfigService } from '@/core/config/config.service';
import { ConflictException } from '@nestjs/common';
import { RbacService } from '@/modules/rbac/rbac.service';

import { EmailChangeDto } from './dto/email-change.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserProfile, UsersService } from './users.service';

interface ConfirmationRequired {
  requiresConfirmation: true;
  challengeId: string;
}

@ApiTags('users')
@ApiCookieAuth('access_token')
@Controller('users')
export class UsersController {
  private readonly logger = new Logger(UsersController.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly rbacService: RbacService,
    private readonly challengeService: ChallengeService,
    private readonly configService: ConfigService,
  ) {}

  @Get(':id')
  @ApiOperation({ summary: 'Get a user profile by id' })
  @ApiOkResponse({ description: 'The requested user profile.' })
  @ApiForbiddenResponse({ description: 'Insufficient permissions.' })
  @ApiNotFoundResponse({ description: 'User not found.' })
  async getById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: RequestUser,
  ): Promise<UserProfile> {
    const isSelf = actor.userId === id;
    if (!isSelf && !this.rbacService.check(actor.roles, 'users', 'read')) {
      throw new ForbiddenException('Insufficient permissions');
    }
    // Default-deny field visibility: self sees the full profile; a permitted
    // third party (users@read) sees only a reduced set.
    return this.usersService.getProfileOrThrow(id, isSelf ? 'self' : 'support');
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a user profile (self or admin)' })
  @ApiOkResponse({ description: 'The updated user profile.' })
  @ApiForbiddenResponse({
    description: 'Insufficient permissions or forbidden field.',
  })
  @ApiNotFoundResponse({ description: 'User not found.' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() actor: RequestUser,
  ): Promise<UserProfile> {
    const isAdmin = this.rbacService.check(actor.roles, 'users', 'update');
    const isSelf = actor.userId === id;

    if (!isAdmin && !isSelf) {
      throw new ForbiddenException('Insufficient permissions');
    }

    // Audit: log actor, target and field NAMES only (no values / PII).
    this.logger.log(
      `profile.update actor=${actor.userId} target=${id} fields=[${Object.keys(dto).join(',')}]`,
    );

    if (isAdmin) {
      return this.usersService.updateProfile(id, dto, [
        'email',
        'displayName',
        'photo',
        'status',
      ]);
    }

    // Self: may not change email through this endpoint.
    if (dto.email !== undefined) {
      throw new ForbiddenException(
        'Email cannot be changed here; use the email-change flow',
      );
    }
    return this.usersService.updateProfile(id, dto, ['displayName', 'photo']);
  }

  // ---- Self-service email change (with OTP confirmation) ----
  @Post(':id/email-change')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Initiate a self-service email change (sends OTP)' })
  @ApiOkResponse({
    description: 'Confirmation required; OTP challenge issued.',
  })
  @ApiForbiddenResponse({
    description: 'Only the account owner may change their email.',
  })
  @ApiConflictResponse({ description: 'Email already in use.' })
  async initiateEmailChange(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EmailChangeDto,
    @CurrentUser() actor: RequestUser,
  ): Promise<ConfirmationRequired> {
    if (actor.userId !== id) {
      throw new ForbiddenException(
        'Only the account owner can change their email',
      );
    }
    const newEmail = dto.newEmail.toLowerCase().trim();
    const existing = await this.usersService.findByEmail(newEmail);
    if (existing) {
      throw new ConflictException('Email already in use');
    }
    const { challengeId } = await this.challengeService.issue({
      type: ChallengeType.EMAIL_CHANGE,
      email: newEmail,
      userId: id,
    });
    this.logger.log(
      `email-change initiated actor=${actor.userId} target=${id}`,
    );
    return { requiresConfirmation: true, challengeId };
  }

  @Post(':id/email-change/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm a self-service email change with an OTP' })
  @ApiOkResponse({ description: 'Email changed successfully.' })
  @ApiForbiddenResponse({
    description: 'Confirmation does not belong to this user.',
  })
  async confirmEmailChange(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfirmDto,
    @CurrentUser() actor: RequestUser,
  ): Promise<{ success: true }> {
    if (actor.userId !== id) {
      throw new ForbiddenException(
        'Only the account owner can change their email',
      );
    }
    const challenge = await this.challengeService.verifyAndConsume(
      dto.challengeId,
      dto.code,
      ChallengeType.EMAIL_CHANGE,
    );
    if (challenge.userId !== id) {
      throw new ForbiddenException('Confirmation does not belong to this user');
    }
    await this.usersService.changeEmail(id, challenge.email);
    this.logger.log(
      `email-change confirmed actor=${actor.userId} target=${id}`,
    );
    return { success: true };
  }

  // ---- Deletion (admin direct; self via OTP confirmation) ----
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delete a user (admin direct; self via OTP confirmation)',
  })
  @ApiOkResponse({
    description: 'User deleted, or confirmation required for self-delete.',
  })
  @ApiForbiddenResponse({ description: 'Insufficient permissions.' })
  @ApiNotFoundResponse({ description: 'User not found.' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: RequestUser,
  ): Promise<{ deleted: true } | ConfirmationRequired> {
    const isAdmin = this.rbacService.check(actor.roles, 'users', 'delete');
    if (isAdmin) {
      this.logger.log(
        `user.delete actor=${actor.userId} target=${id} type=admin`,
      );
      await this.usersService.softDelete(id);
      return { deleted: true };
    }

    if (actor.userId !== id) {
      throw new ForbiddenException('Insufficient permissions');
    }

    // Self-delete: require OTP confirmation when enabled.
    if (this.isSelfDeleteConfirmationEnabled()) {
      const user = await this.usersService.findById(id);
      if (!user) {
        throw new NotFoundException('User not found');
      }
      const { challengeId } = await this.challengeService.issue({
        type: ChallengeType.SELF_DELETE,
        email: user.email,
        userId: id,
      });
      this.logger.log(`self-delete initiated actor=${actor.userId}`);
      return { requiresConfirmation: true, challengeId };
    }

    this.logger.log(`user.delete actor=${actor.userId} target=${id} type=self`);
    await this.usersService.softDelete(id);
    return { deleted: true };
  }

  @Post(':id/deletion/confirm')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Confirm a self-service account deletion with an OTP',
  })
  @ApiForbiddenResponse({
    description: 'Confirmation does not belong to this user.',
  })
  async confirmSelfDelete(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfirmDto,
    @CurrentUser() actor: RequestUser,
  ): Promise<void> {
    if (actor.userId !== id) {
      throw new ForbiddenException(
        'Only the account owner can confirm deletion',
      );
    }
    const challenge = await this.challengeService.verifyAndConsume(
      dto.challengeId,
      dto.code,
      ChallengeType.SELF_DELETE,
    );
    if (challenge.userId !== id) {
      throw new ForbiddenException('Confirmation does not belong to this user');
    }
    this.logger.log(
      `user.delete actor=${actor.userId} target=${id} type=self-confirmed`,
    );
    await this.usersService.softDelete(id);
  }

  private isSelfDeleteConfirmationEnabled(): boolean {
    return (
      String(this.configService.get('CONFIRM_SELF_DELETE_ENABLED')) === 'true'
    );
  }
}
