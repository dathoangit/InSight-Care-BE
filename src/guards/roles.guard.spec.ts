import { type ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { StaffRole } from '../constants';
import { RolesGuard } from './roles.guard';

function createContext(role?: StaffRole): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user: role ? { role } : undefined }),
    }),
    getHandler: () => jest.fn(),
    getClass: () => jest.fn(),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  it('allows when no roles are required', () => {
    const reflector = new Reflector();
    const guard = new RolesGuard(reflector);

    jest.spyOn(reflector, 'get').mockReturnValue(undefined as never);

    expect(guard.canActivate(createContext(StaffRole.NURSE))).toBe(true);
  });

  it('allows when user role rank meets requirement', () => {
    const reflector = new Reflector();
    const guard = new RolesGuard(reflector);

    jest.spyOn(reflector, 'get').mockReturnValue([StaffRole.NURSE]);

    expect(guard.canActivate(createContext(StaffRole.ADMIN))).toBe(true);
  });

  it('throws when user role rank is insufficient', () => {
    const reflector = new Reflector();
    const guard = new RolesGuard(reflector);

    jest.spyOn(reflector, 'get').mockReturnValue([StaffRole.ADMIN]);

    expect(() => guard.canActivate(createContext(StaffRole.NURSE))).toThrow(
      ForbiddenException,
    );
  });
});
