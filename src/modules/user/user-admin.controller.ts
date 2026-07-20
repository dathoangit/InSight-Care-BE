import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { StaffRole } from '../../constants';
import { Auth, AuthUser, UUIDParam } from '../../decorators';
import { type IJwtAuthenticatedUser } from '../auth/types/jwt-authenticated-user.type';
import { CreateUserDto } from './dtos/create-user.dto';
import {
  type IUsersListResponseDto,
  ListUsersQueryDto,
} from './dtos/list-users-query.dto';
import { UpdateUserDto } from './dtos/update-user.dto';
import { UpdateUserRoleDto } from './dtos/update-user-role.dto';
import { UserDto } from './dtos/user.dto';
import { UserService } from './user.service';

@ApiTags('admin')
@Controller('admin')
export class UserAdminController {
  constructor(private readonly userService: UserService) {}

  @Get('users')
  @Auth([StaffRole.ADMIN])
  @ApiOkResponse({ description: 'Paginated user list' })
  async getUsers(
    @Query() query: ListUsersQueryDto,
  ): Promise<IUsersListResponseDto> {
    const result = await this.userService.findAllUsers(query);

    return {
      items: result.items.map((user) => user.toDto()),
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    };
  }

  @Post('users')
  @Auth([StaffRole.ADMIN])
  @ApiCreatedResponse({ type: UserDto })
  async createUser(@Body() dto: CreateUserDto): Promise<UserDto> {
    const user = await this.userService.createAdminUser(dto);

    return user.toDto();
  }

  @Patch('users/:id')
  @Auth([StaffRole.ADMIN])
  @ApiOkResponse({ type: UserDto })
  async updateUser(
    @UUIDParam('id') userId: Uuid,
    @Body() dto: UpdateUserDto,
    @AuthUser() currentUser: IJwtAuthenticatedUser,
  ): Promise<UserDto> {
    const user = await this.userService.updateUser(userId, dto, currentUser.id);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user.toDto();
  }

  @Patch('users/:id/role')
  @Auth([StaffRole.ADMIN])
  @ApiOkResponse({ type: UserDto })
  async updateUserRole(
    @UUIDParam('id') userId: Uuid,
    @Body() dto: UpdateUserRoleDto,
  ): Promise<UserDto> {
    const user = await this.userService.updateRole(userId, dto.role);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user.toDto();
  }

  @Delete('users/:id')
  @Auth([StaffRole.ADMIN])
  @ApiOkResponse({ type: UserDto })
  async deactivateUser(
    @UUIDParam('id') userId: Uuid,
    @AuthUser() currentUser: IJwtAuthenticatedUser,
  ): Promise<UserDto> {
    const user = await this.userService.deactivateUser(userId, currentUser.id);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user.toDto();
  }
}
