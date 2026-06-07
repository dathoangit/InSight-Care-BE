import { StaffRole } from '../../../constants';
import { EnumField } from '../../../decorators';

export class UpdateUserRoleDto {
  @EnumField(() => StaffRole)
  role!: StaffRole;
}
