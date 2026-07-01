import { type StaffRole } from '../../../constants';

export interface IJwtAuthenticatedUser {
  id: Uuid;
  role: StaffRole;
  email?: string | null;
}
