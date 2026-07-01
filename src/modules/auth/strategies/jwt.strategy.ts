import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { TokenType } from '../../../constants';
import { type IJwtAccessPayload } from '../types/jwt-access-payload.type';
import { type IJwtAuthenticatedUser } from '../types/jwt-authenticated-user.type';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  private readonly logger = new Logger(JwtStrategy.name);

  constructor(configService: ConfigService) {
    const publicKey = (
      configService.get<string>('JWT_PUBLIC_KEY') ?? ''
    ).replaceAll('\\n', '\n');

    if (!publicKey) {
      throw new Error('JWT_PUBLIC_KEY is required for RS256 verification');
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: publicKey,
      algorithms: ['RS256'],
    });
  }

  validate(payload: IJwtAccessPayload): IJwtAuthenticatedUser {
    if (payload.type !== TokenType.ACCESS_TOKEN) {
      this.logger.warn(`Invalid token type: ${payload.type}`);

      throw new UnauthorizedException('Invalid token type');
    }

    return {
      id: payload.sub,
      role: payload.role,
      email: payload.email ?? null,
    };
  }
}
