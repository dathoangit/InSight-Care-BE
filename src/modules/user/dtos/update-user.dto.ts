import {
  BooleanFieldOptional,
  EmailFieldOptional,
  PasswordFieldOptional,
  StringFieldOptional,
} from '../../../decorators';

export class UpdateUserDto {
  @StringFieldOptional({ maxLength: 64 })
  username?: string;

  @StringFieldOptional({ maxLength: 128 })
  fullName?: string;

  @EmailFieldOptional({ nullable: true })
  email?: string | null;

  @BooleanFieldOptional()
  isActive?: boolean;

  @PasswordFieldOptional()
  password?: string;
}
