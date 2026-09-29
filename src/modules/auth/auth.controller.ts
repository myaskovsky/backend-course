import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from './auth.constants';
import type { RequestUser } from './auth.constants';
import {
  AuthService,
  ConfirmationRequired,
  LoginResult,
  PublicUser,
  RegisterResult,
} from './auth.service';
import { CookieService } from './cookie.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ConfirmDto } from './dto/confirm.dto';
import { LoginDto } from './dto/login.dto';
import {
  PasswordResetConfirmDto,
  PasswordResetRequestDto,
} from './dto/password-reset.dto';
import { RegisterDto } from './dto/register.dto';
import { ResendOtpDto } from './dto/resend-otp.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly cookieService: CookieService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Register a new account and issue an OTP challenge',
  })
  @ApiCreatedResponse({
    description: 'Registration accepted; confirmation required.',
  })
  @ApiConflictResponse({ description: 'Email already registered.' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded.' })
  register(@Body() dto: RegisterDto): Promise<RegisterResult> {
    return this.authService.register(dto);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm registration with an OTP and sign in' })
  @ApiOkResponse({ description: 'Registration confirmed; auth cookies set.' })
  @ApiUnauthorizedResponse({
    description: 'Invalid or expired confirmation code.',
  })
  async confirmRegistration(
    @Body() dto: ConfirmDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<PublicUser> {
    const result = await this.authService.confirmRegistration(dto);
    this.cookieService.setAuthCookies(reply, result.tokens);
    return result.user;
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Log in with email and password' })
  @ApiOkResponse({ description: 'Logged in, or confirmation required.' })
  @ApiUnauthorizedResponse({ description: 'Invalid credentials.' })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<PublicUser | ConfirmationRequired> {
    const result = await this.authService.login(dto);
    if ('requiresConfirmation' in result) {
      return result;
    }
    this.cookieService.setAuthCookies(reply, result.tokens);
    return result.user;
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm login with an OTP and sign in' })
  @ApiOkResponse({ description: 'Login confirmed; auth cookies set.' })
  @ApiUnauthorizedResponse({
    description: 'Invalid or expired confirmation code.',
  })
  async confirmLogin(
    @Body() dto: ConfirmDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<PublicUser> {
    const result: LoginResult = await this.authService.confirmLogin(dto);
    this.cookieService.setAuthCookies(reply, result.tokens);
    return result.user;
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rotate access/refresh tokens using the refresh cookie',
  })
  @ApiOkResponse({ description: 'Tokens refreshed; auth cookies set.' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid refresh token.' })
  async refresh(
    @Req() request: FastifyRequest & { cookies?: Record<string, string> },
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ success: true }> {
    const tokens = await this.authService.refresh(
      request.cookies?.[REFRESH_TOKEN_COOKIE],
    );
    this.cookieService.setAuthCookies(reply, tokens);
    return { success: true };
  }

  // Public so a client whose access token already expired can still revoke
  // its refresh token. Only the tokens presented in the cookies are revoked.
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary:
      'Log out: revoke the current access/refresh tokens and clear cookies',
  })
  @ApiOkResponse({ description: 'Tokens revoked; auth cookies cleared.' })
  async logout(
    @Req() request: FastifyRequest & { cookies?: Record<string, string> },
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ success: true }> {
    await this.authService.logout(
      request.cookies?.[ACCESS_TOKEN_COOKIE],
      request.cookies?.[REFRESH_TOKEN_COOKIE],
    );
    this.cookieService.clearAuthCookies(reply);
    return { success: true };
  }

  // ---- Password recovery ----
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('password-reset/request')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request a password reset code by email' })
  @ApiOkResponse({
    description: 'Neutral acknowledgement (never reveals if the email exists).',
  })
  async requestPasswordReset(
    @Body() dto: PasswordResetRequestDto,
  ): Promise<{ success: true }> {
    await this.authService.requestPasswordReset(dto);
    // Neutral response — never reveal whether the email exists.
    return { success: true };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('password-reset/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Confirm a password reset with an OTP and new password',
  })
  @ApiOkResponse({ description: 'Password reset successfully.' })
  @ApiUnauthorizedResponse({
    description: 'Invalid or expired confirmation code.',
  })
  async confirmPasswordReset(
    @Body() dto: PasswordResetConfirmDto,
  ): Promise<{ success: true }> {
    await this.authService.confirmPasswordReset(dto);
    return { success: true };
  }

  // ---- Authenticated password change ----
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary:
      'Change the password; revokes all other sessions and re-issues cookies',
  })
  @ApiOkResponse({ description: 'Password changed successfully.' })
  @ApiUnauthorizedResponse({
    description: 'Not authenticated or current password incorrect.',
  })
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @CurrentUser() actor: RequestUser,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ success: true }> {
    const tokens = await this.authService.changePassword(actor.userId, dto);
    this.cookieService.setAuthCookies(reply, tokens);
    return { success: true };
  }

  // ---- Resend OTP ----
  @Public()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('otp/resend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resend an OTP for an existing challenge' })
  @ApiOkResponse({ description: 'A new OTP was issued for the challenge.' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded.' })
  async resendOtp(@Body() dto: ResendOtpDto): Promise<{ challengeId: string }> {
    return this.authService.resendOtp(dto.challengeId);
  }
}
