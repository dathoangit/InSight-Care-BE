import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Patch,
} from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { StaffRole } from '../../constants';
import { Auth, UUIDParam } from '../../decorators';
import { UpdateUserRoleDto } from './dtos/update-user-role.dto';
import { UserDto } from './dtos/user.dto';
import { UserService } from './user.service';

@ApiTags('admin')
@Controller('admin')
export class UserAdminController {
  constructor(private readonly userService: UserService) {}

  @Get('users')
  @Auth([StaffRole.ADMIN])
  @ApiOkResponse({ type: UserDto, isArray: true })
  async getUsers(): Promise<UserDto[]> {
    const users = await this.userService.findAllUsers();

    return users.map((user) => user.toDto());
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
}
