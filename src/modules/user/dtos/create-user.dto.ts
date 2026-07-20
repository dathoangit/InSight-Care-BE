import { StaffRole } from '../../../constants';
import {
  BooleanFieldOptional,
  EmailFieldOptional,
  EnumField,
  PasswordFieldOptional,
  StringField,
} from '../../../decorators';

export class CreateUserDto {
  @StringField({ maxLength: 64 })
  username!: string;

  @StringField({ maxLength: 128 })
  fullName!: string;

  @PasswordFieldOptional()
  password?: string;

  @EmailFieldOptional({ nullable: true })
  email?: string | null;

  @EnumField(() => StaffRole)
  role!: StaffRole;

  @BooleanFieldOptional()
  isActive?: boolean;
}
