import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { Auth, AuthUser, PublicRoute } from '../../decorators';
import { UserDto } from '../user/dtos/user.dto';
import { AuthService } from './auth.service';
import { AuthTokenDto } from './dtos/auth-token.dto';
import { LoginDto } from './dtos/login.dto';
import { type IJwtAuthenticatedUser } from './types/jwt-authenticated-user.type';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @PublicRoute(true)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @ApiOkResponse({ type: AuthTokenDto })
  login(@Body() dto: LoginDto): Promise<AuthTokenDto> {
    return this.authService.login(dto);
  }

  @Get('me')
  @Auth()
  @ApiOkResponse({ type: UserDto })
  me(@AuthUser() user: IJwtAuthenticatedUser): Promise<UserDto> {
    return this.authService.me(user);
  }
}
