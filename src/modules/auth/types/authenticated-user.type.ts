import { type StaffRole } from '../../../constants';

export interface IAuthenticatedUser {
  id: Uuid;
  username: string;
  role: StaffRole;
}
