import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { TokenType } from '../../../constants';
import { type UserEntity } from '../../user/user.entity';
import { UserService } from '../../user/user.service';
import { type IJwtAccessPayload } from '../types/jwt-access-payload.type';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  private readonly logger = new Logger(JwtStrategy.name);

  constructor(
    configService: ConfigService,
    private readonly userService: UserService,
  ) {
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

  async validate(payload: IJwtAccessPayload): Promise<UserEntity> {
    if (payload.type !== TokenType.ACCESS_TOKEN) {
      this.logger.warn(`Invalid token type: ${payload.type}`);

      throw new UnauthorizedException('Invalid token type');
    }

    const user = await this.userService.findById(payload.sub);

    if (!user || !user.isActive) {
      this.logger.warn(
        `User not found or inactive for token sub=${payload.sub}`,
      );

      throw new UnauthorizedException('User not found');
    }

    return user;
  }
}
