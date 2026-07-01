import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { UserModule } from '../user/user.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { getJwtExpirationSeconds } from './jwt-expiration.util';
import { JwtStrategy } from './strategies/jwt.strategy';
import { PublicStrategy } from './strategies/public.strategy';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    ConfigModule,
    UserModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const privateKey = (
          configService.get<string>('JWT_PRIVATE_KEY') ?? ''
        ).replaceAll('\\n', '\n');
        const publicKey = (
          configService.get<string>('JWT_PUBLIC_KEY') ?? ''
        ).replaceAll('\\n', '\n');

        if (!privateKey || !publicKey) {
          throw new Error(
            'JWT_PRIVATE_KEY and JWT_PUBLIC_KEY are required for RS256 auth',
          );
        }

        return {
          privateKey,
          publicKey,
          signOptions: {
            algorithm: 'RS256' as const,
            expiresIn: getJwtExpirationSeconds(configService),
          },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, PublicStrategy],
  exports: [AuthService],
})
export class AuthModule {}
