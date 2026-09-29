import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';

import { UsersModule } from '@/modules/users/users.module';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ChallengeModule } from './challenge.module';
import { CookieService } from './cookie.service';
import { RevokedToken } from './entities/revoked-token.entity';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { PasswordService } from './password.service';
import { RevokedTokensCleanupService } from './revoked-tokens-cleanup.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { TokenRevocationService } from './token-revocation.service';
import { TokensService } from './tokens.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([RevokedToken]),
    UsersModule,
    PassportModule,
    JwtModule.register({}),
    ChallengeModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    TokensService,
    CookieService,
    TokenRevocationService,
    RevokedTokensCleanupService,
    JwtStrategy,
    // Global authentication: every route requires a valid access token
    // unless annotated with @Public().
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
  exports: [PasswordService, TokensService],
})
export class AuthModule {}
