import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Transactional } from 'typeorm-transactional';

import { ConfigService } from '@/core/config/config.service';
import { User, UserStatus } from '@/modules/users/entities/user.entity';
import { UsersService } from '@/modules/users/users.service';

import { JwtPayload } from './auth.constants';
import { ChallengeService } from './challenge.service';
import { ChallengeType } from './entities/email-challenge.entity';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ConfirmDto } from './dto/confirm.dto';
import { LoginDto } from './dto/login.dto';
import {
  PasswordResetConfirmDto,
  PasswordResetRequestDto,
} from './dto/password-reset.dto';
import { RegisterDto } from './dto/register.dto';
import { PasswordService } from './password.service';
import { TokenRevocationService } from './token-revocation.service';
import { TokenPair, TokensService } from './tokens.service';

export interface PublicUser {
  id: string;
  email: string;
  status: string;
  displayName: string | null;
  photo: string | null;
  createdAt: Date;
}

export interface LoginResult {
  user: PublicUser;
  tokens: TokenPair;
}

export interface ConfirmationRequired {
  requiresConfirmation: true;
  challengeId: string;
}

export type RegisterResult = PublicUser | ConfirmationRequired;
export type LoginOrChallenge = LoginResult | ConfirmationRequired;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly passwordService: PasswordService,
    private readonly tokensService: TokensService,
    private readonly tokenRevocation: TokenRevocationService,
    private readonly challengeService: ChallengeService,
    private readonly configService: ConfigService,
  ) {}

  @Transactional()
  async register(dto: RegisterDto): Promise<RegisterResult> {
    const email = this.normalizeEmail(dto.email);

    const existing = await this.usersService.findByEmail(email);
    if (existing) {
      this.logger.warn('Registration rejected: email already in use');
      throw new ConflictException('Email already registered');
    }

    const confirm = this.isFlagEnabled('CONFIRM_REGISTRATION_ENABLED');
    const passwordHash = await this.passwordService.hash(dto.password);
    const user = await this.usersService.create({
      email,
      passwordHash,
      displayName: dto.displayName ?? null,
      status: confirm ? UserStatus.PENDING : UserStatus.ACTIVE,
    });

    if (confirm) {
      const { challengeId } = await this.challengeService.issue({
        type: ChallengeType.REGISTRATION,
        email,
        userId: user.id,
      });
      this.logger.log(`Registration pending confirmation: ${user.id}`);
      return { requiresConfirmation: true, challengeId };
    }

    this.logger.log(`User registered: ${user.id}`);
    return this.toPublicUser(user);
  }

  async confirmRegistration(dto: ConfirmDto): Promise<LoginResult> {
    const challenge = await this.challengeService.verifyAndConsume(
      dto.challengeId,
      dto.code,
      ChallengeType.REGISTRATION,
    );
    if (!challenge.userId) {
      throw new BadRequestException('Invalid confirmation');
    }
    await this.usersService.activate(challenge.userId);
    const user = await this.usersService.findById(challenge.userId);
    if (!user) {
      throw new BadRequestException('Invalid confirmation');
    }
    return this.issueLoginResult(user);
  }

  async login(dto: LoginDto): Promise<LoginOrChallenge> {
    const email = this.normalizeEmail(dto.email);
    const user = await this.usersService.findByEmailWithPassword(email);

    // Neutral error — do not reveal whether the email exists.
    const invalid = new UnauthorizedException('Invalid email or password');

    if (!user || user.status !== UserStatus.ACTIVE) {
      throw invalid;
    }

    const passwordOk = await this.passwordService.verify(
      user.passwordHash,
      dto.password,
    );
    if (!passwordOk) {
      this.logger.warn(`Failed login attempt for user ${user.id}`);
      throw invalid;
    }

    if (this.isFlagEnabled('CONFIRM_LOGIN_ENABLED')) {
      const { challengeId } = await this.challengeService.issue({
        type: ChallengeType.LOGIN,
        email: user.email,
        userId: user.id,
      });
      this.logger.log(`Login pending confirmation: ${user.id}`);
      return { requiresConfirmation: true, challengeId };
    }

    return this.issueLoginResult(user);
  }

  async confirmLogin(dto: ConfirmDto): Promise<LoginResult> {
    const challenge = await this.challengeService.verifyAndConsume(
      dto.challengeId,
      dto.code,
      ChallengeType.LOGIN,
    );
    if (!challenge.userId) {
      throw new BadRequestException('Invalid confirmation');
    }
    const user = await this.usersService.findById(challenge.userId);
    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new BadRequestException('Invalid confirmation');
    }
    return this.issueLoginResult(user);
  }

  private async issueLoginResult(user: User): Promise<LoginResult> {
    await this.usersService.markLoggedIn(user.id);
    const tokens = await this.tokensService.issueTokenPair({
      userId: user.id,
      email: user.email,
    });
    this.logger.log(`User logged in: ${user.id}`);
    return { user: this.toPublicUser(user), tokens };
  }

  async refresh(refreshToken: string | undefined): Promise<TokenPair> {
    if (!refreshToken) {
      throw new UnauthorizedException('Missing refresh token');
    }

    let payload: JwtPayload;
    try {
      payload = await this.tokensService.verifyRefresh(refreshToken);
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('Invalid token type');
    }

    const user = await this.usersService.findById(payload.sub);
    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('User is not active');
    }
    if (this.tokenRevocation.isRevokedForUser(payload, user)) {
      throw new UnauthorizedException('Refresh token has been revoked');
    }

    // Rotation: the presented refresh token is revoked and a new pair issued.
    // If it was already revoked, someone is replaying a used token — treat the
    // whole session family as compromised and revoke everything.
    const firstUse = await this.tokenRevocation.revoke(payload);
    if (!firstUse) {
      await this.usersService.revokeAllSessions(user.id);
      this.logger.warn(`Refresh token reuse detected for user ${user.id}`);
      throw new UnauthorizedException('Refresh token has been revoked');
    }

    return this.tokensService.issueTokenPair({
      userId: user.id,
      email: user.email,
    });
  }

  /**
   * Revokes the presented access and refresh tokens so they stop working
   * immediately. Invalid/expired tokens are skipped — they are unusable anyway.
   */
  async logout(
    accessToken: string | undefined,
    refreshToken: string | undefined,
  ): Promise<void> {
    const payloads = await Promise.all([
      accessToken
        ? this.tryVerify(() => this.tokensService.verifyAccess(accessToken))
        : null,
      refreshToken
        ? this.tryVerify(() => this.tokensService.verifyRefresh(refreshToken))
        : null,
    ]);
    for (const payload of payloads) {
      if (payload?.jti) {
        await this.tokenRevocation.revoke(payload);
      }
    }
    const userId = payloads.find((p) => p)?.sub;
    if (userId) {
      this.logger.log(`User logged out: ${userId}`);
    }
  }

  /**
   * Step 1 of password recovery. Always resolves the same way regardless of
   * whether the email exists (no account enumeration). Sends an OTP if the
   * account exists and is active.
   */
  async requestPasswordReset(dto: PasswordResetRequestDto): Promise<void> {
    if (!this.isFlagEnabled('CONFIRM_PASSWORD_RECOVERY')) {
      throw new BadRequestException('Password recovery is disabled');
    }
    const email = this.normalizeEmail(dto.email);
    const user = await this.usersService.findByEmail(email);
    if (user && user.status === UserStatus.ACTIVE) {
      await this.challengeService.issue({
        type: ChallengeType.PASSWORD_RESET,
        email: user.email,
        userId: user.id,
      });
      this.logger.log(`Password reset requested for user ${user.id}`);
    } else {
      this.logger.warn('Password reset requested for unknown/inactive email');
    }
  }

  /**
   * Step 2 of password recovery: verify OTP and set the new password.
   */
  async confirmPasswordReset(dto: PasswordResetConfirmDto): Promise<void> {
    const email = this.normalizeEmail(dto.email);
    const challenge = await this.challengeService.verifyAndConsumeByEmail(
      email,
      dto.code,
      ChallengeType.PASSWORD_RESET,
    );
    if (!challenge.userId) {
      throw new BadRequestException('Invalid confirmation');
    }
    const passwordHash = await this.passwordService.hash(dto.newPassword);
    await this.usersService.setPassword(challenge.userId, passwordHash);
    this.logger.log(`Password reset completed for user ${challenge.userId}`);
  }

  /**
   * Authenticated password change: verifies the current password first. All
   * existing sessions are revoked; a fresh pair is returned so the device that
   * made the change stays signed in.
   */
  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
  ): Promise<TokenPair> {
    const user = await this.usersService.findByIdWithPassword(userId);
    if (!user) {
      throw new UnauthorizedException();
    }
    const ok = await this.passwordService.verify(
      user.passwordHash,
      dto.currentPassword,
    );
    if (!ok) {
      throw new BadRequestException('Current password is incorrect');
    }
    const passwordHash = await this.passwordService.hash(dto.newPassword);
    await this.usersService.setPassword(userId, passwordHash);
    this.logger.log(`Password changed for user ${userId}`);
    return this.tokensService.issueTokenPair({
      userId: user.id,
      email: user.email,
    });
  }

  resendOtp(challengeId: string): Promise<{ challengeId: string }> {
    return this.challengeService.resend(challengeId);
  }

  private async tryVerify(
    verify: () => Promise<JwtPayload>,
  ): Promise<JwtPayload | null> {
    try {
      return await verify();
    } catch {
      return null;
    }
  }

  private normalizeEmail(email: string): string {
    return email.toLowerCase().trim();
  }

  private isFlagEnabled(
    key:
      | 'CONFIRM_REGISTRATION_ENABLED'
      | 'CONFIRM_LOGIN_ENABLED'
      | 'CONFIRM_PASSWORD_RECOVERY',
  ): boolean {
    return String(this.configService.get(key)) === 'true';
  }

  private toPublicUser(user: User): PublicUser {
    return {
      id: user.id,
      email: user.email,
      status: user.status,
      displayName: user.displayName,
      photo: user.photo,
      createdAt: user.createdAt,
    };
  }
}
