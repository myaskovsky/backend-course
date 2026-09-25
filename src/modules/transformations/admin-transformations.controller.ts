import {
  Controller,
  Get,
  Logger,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Query,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiGoneResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import type { RequestUser } from '@/modules/auth/auth.constants';
import { CurrentUser } from '@/modules/auth/decorators/current-user.decorator';
import { RequirePermission } from '@/modules/rbac/decorators/require-permission.decorator';
import { RbacGuard } from '@/modules/rbac/guards/rbac.guard';
import { UsersService } from '@/modules/users/users.service';

import { PaginatedHistoryDto } from './dto/history-item.dto';
import { ListHistoryQueryDto } from './dto/list-history-query.dto';
import { TransformationsService } from './transformations.service';

@ApiTags('admin-transformations')
@ApiCookieAuth('access_token')
@Controller('admin/users/:userId/transformations')
@UseGuards(RbacGuard)
export class AdminTransformationsController {
  private readonly logger = new Logger(AdminTransformationsController.name);

  constructor(
    private readonly transformationsService: TransformationsService,
    private readonly usersService: UsersService,
  ) {}

  @Get('history')
  @RequirePermission('transformations@read')
  @ApiOperation({ summary: "List a specific user's transformation history" })
  @ApiOkResponse({ type: PaginatedHistoryDto })
  @ApiForbiddenResponse({ description: 'Missing transformations@read.' })
  @ApiNotFoundResponse({ description: 'User not found.' })
  async history(
    @CurrentUser() actor: RequestUser,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query() query: ListHistoryQueryDto,
  ): Promise<PaginatedHistoryDto> {
    await this.assertUserExists(userId);
    const page = await this.transformationsService.listHistory(userId, query);
    this.logger.log(
      `history.list actor=${actor.userId} target=${userId} count=${page.items.length}`,
    );
    return page;
  }

  @Get('history/:itemId/download')
  @RequirePermission('transformations@download')
  @ApiOperation({ summary: "Download a saved file from a user's history" })
  @ApiOkResponse({ description: 'The saved file streamed as an attachment.' })
  @ApiForbiddenResponse({ description: 'Missing transformations@download.' })
  @ApiNotFoundResponse({ description: 'User, item, or saved file not found.' })
  @ApiGoneResponse({ description: 'Saved file has expired.' })
  async download(
    @CurrentUser() actor: RequestUser,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ): Promise<StreamableFile> {
    await this.assertUserExists(userId);
    const result = await this.transformationsService.getUserDownload(
      userId,
      itemId,
    );
    this.logger.log(
      `history.download actor=${actor.userId} target=${userId} item=${itemId}`,
    );
    return new StreamableFile(result.stream, {
      type: result.contentType,
      disposition: `attachment; filename="${result.filename}"`,
    });
  }

  private async assertUserExists(userId: string): Promise<void> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }
  }
}
