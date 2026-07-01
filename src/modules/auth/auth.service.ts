import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import { validateHash } from '../../common/utils';
import { TokenType } from '../../constants';
import { type UserDto } from '../user/dtos/user.dto';
import { type UserEntity } from '../user/user.entity';
import { UserService } from '../user/user.service';
import { type AuthTokenDto } from './dtos/auth-token.dto';
import { type LoginDto } from './dtos/login.dto';
import { getJwtExpirationSeconds } from './jwt-expiration.util';
import { type IJwtAccessPayload } from './types/jwt-access-payload.type';
import { type IJwtAuthenticatedUser } from './types/jwt-authenticated-user.type';

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async login(dto: LoginDto): Promise<AuthTokenDto> {
    const user = await this.userService.findByIdentifierWithPassword(
      dto.username,
    );

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isMatched = await validateHash(dto.password, user.passwordHash);

    if (!isMatched) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const expiresIn = this.getAccessTokenExpiresIn();
    const token = await this.issueAccessToken(user);

    return {
      user: user.toDto(),
      token: {
        expiresIn,
        accessToken: token,
      },
    };
  }

  async me(user: IJwtAuthenticatedUser): Promise<UserDto> {
    const entity = await this.userService.findById(user.id);

    if (!entity || !entity.isActive) {
      throw new UnauthorizedException('User not found');
    }

    return entity.toDto();
  }

  private async issueAccessToken(user: UserEntity): Promise<string> {
    const payload: IJwtAccessPayload = {
      sub: user.id,
      type: TokenType.ACCESS_TOKEN,
      role: user.role,
      ...(user.email ? { email: user.email } : {}),
    };

    return this.jwtService.signAsync(payload);
  }

  private getAccessTokenExpiresIn(): number {
    return getJwtExpirationSeconds(this.configService);
  }
}
