import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { generateHash } from '../../common/utils';
import { DEFAULT_NEW_USER_PASSWORD, StaffRole } from '../../constants';
import { type CreateUserDto } from './dtos/create-user.dto';
import { type ListUsersQueryDto } from './dtos/list-users-query.dto';
import { type UpdateUserDto } from './dtos/update-user.dto';
import { UserEntity } from './user.entity';

interface ICreateUserPayload {
  username: string;
  fullName: string;
  email?: string | null;
  passwordHash: string;
  role?: StaffRole;
  isActive?: boolean;
}

const USERS_DEFAULT_LIMIT = 100;
const USERS_MAX_LIMIT = 500;

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
  ) {}

  findById(id: Uuid): Promise<UserEntity | null> {
    return this.userRepository.findOne({ where: { id } });
  }

  findByUsername(username: string): Promise<UserEntity | null> {
    return this.userRepository.findOne({
      where: { username: this.normalizeUsername(username) },
    });
  }

  findByEmail(email: string): Promise<UserEntity | null> {
    return this.userRepository.findOne({
      where: { email: email.trim().toLowerCase() },
    });
  }

  findByUsernameWithPassword(username: string): Promise<UserEntity | null> {
    return this.userRepository
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.username = :username', {
        username: this.normalizeUsername(username),
      })
      .getOne();
  }

  findByEmailWithPassword(email: string): Promise<UserEntity | null> {
    return this.userRepository
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.email = :email', { email: email.trim().toLowerCase() })
      .andWhere('user.emailVerifiedAt IS NOT NULL')
      .getOne();
  }

  async findByIdentifierWithPassword(
    identifier: string,
  ): Promise<UserEntity | null> {
    const normalized = identifier.trim().toLowerCase();

    if (normalized.includes('@')) {
      return this.findByEmailWithPassword(normalized);
    }

    return this.findByUsernameWithPassword(normalized);
  }

  async createUser(payload: ICreateUserPayload): Promise<UserEntity> {
    const rawEmail =
      payload.email === null || payload.email === undefined
        ? ''
        : String(payload.email).trim();
    const email = rawEmail.length > 0 ? rawEmail.toLowerCase() : null;

    const entity = this.userRepository.create({
      username: this.normalizeUsername(payload.username),
      fullName: this.normalizeFullName(payload.fullName),
      email,
      passwordHash: payload.passwordHash,
      role: payload.role ?? StaffRole.NURSE,
      isActive: payload.isActive ?? true,
      emailVerifiedAt: null,
    });

    return this.userRepository.save(entity);
  }

  async createUserWithPlainPassword(payload: {
    username: string;
    fullName: string;
    email?: string | null;
    password: string;
    role: StaffRole;
    isActive?: boolean;
  }): Promise<UserEntity> {
    return this.createUser({
      username: payload.username,
      fullName: payload.fullName,
      email: payload.email,
      passwordHash: generateHash(payload.password),
      role: payload.role,
      isActive: payload.isActive,
    });
  }

  async updatePassword(id: Uuid, passwordHash: string): Promise<void> {
    await this.userRepository.update({ id }, { passwordHash });
  }

  async updateRole(id: Uuid, role: StaffRole): Promise<UserEntity | null> {
    await this.userRepository.update({ id }, { role });

    return this.findById(id);
  }

  async markEmailVerified(id: Uuid, email: string): Promise<UserEntity | null> {
    await this.userRepository.update(
      { id },
      { email: email.trim().toLowerCase(), emailVerifiedAt: new Date() },
    );

    return this.findById(id);
  }

  async findAllUsers(query: ListUsersQueryDto = {}): Promise<{
    items: UserEntity[];
    total: number;
    limit: number;
    offset: number;
  }> {
    const limit = Math.min(query.limit ?? USERS_DEFAULT_LIMIT, USERS_MAX_LIMIT);
    const offset = query.offset ?? 0;
    const [items, total] = await this.userRepository.findAndCount({
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });

    return { items, total, limit, offset };
  }

  async createAdminUser(dto: CreateUserDto): Promise<UserEntity> {
    await this.assertUsernameAvailable(dto.username);

    if (dto.email !== undefined && dto.email !== null && dto.email.trim()) {
      await this.assertEmailAvailable(dto.email);
    }

    const password =
      dto.password && dto.password.trim().length > 0
        ? dto.password
        : DEFAULT_NEW_USER_PASSWORD;

    return this.createUserWithPlainPassword({
      username: dto.username,
      fullName: dto.fullName,
      email: dto.email,
      password,
      role: dto.role,
      isActive: dto.isActive,
    });
  }

  async updateUser(
    id: Uuid,
    dto: UpdateUserDto,
    currentUserId?: Uuid,
  ): Promise<UserEntity | null> {
    const user = await this.findById(id);

    if (!user) {
      return null;
    }

    this.assertNotSelfDeactivation(id, dto.isActive, currentUserId);

    const patch = await this.buildUserUpdatePatch(user, dto);

    if (Object.keys(patch).length > 0) {
      await this.userRepository.update({ id }, patch);
    }

    if (dto.password !== undefined && dto.password.trim().length > 0) {
      await this.updatePassword(id, generateHash(dto.password));
    }

    return this.findById(id);
  }

  async deactivateUser(
    id: Uuid,
    currentUserId: Uuid,
  ): Promise<UserEntity | null> {
    if (id === currentUserId) {
      throw new BadRequestException('Cannot deactivate your own account');
    }

    const user = await this.findById(id);

    if (!user) {
      return null;
    }

    await this.userRepository.update({ id }, { isActive: false });

    return this.findById(id);
  }

  private assertNotSelfDeactivation(
    userId: Uuid,
    isActive: boolean | undefined,
    currentUserId?: Uuid,
  ): void {
    if (
      currentUserId !== undefined &&
      userId === currentUserId &&
      isActive === false
    ) {
      throw new BadRequestException('Cannot deactivate your own account');
    }
  }

  private async buildUserUpdatePatch(
    user: UserEntity,
    dto: UpdateUserDto,
  ): Promise<Partial<UserEntity>> {
    const patch: Partial<UserEntity> = {};

    if (dto.username !== undefined) {
      await this.applyUsernamePatch(user, dto.username, patch);
    }

    if (dto.fullName !== undefined) {
      patch.fullName = this.normalizeFullName(dto.fullName);
    }

    if (dto.email !== undefined) {
      await this.applyEmailPatch(user, dto.email, patch);
    }

    if (dto.isActive !== undefined) {
      patch.isActive = dto.isActive;
    }

    return patch;
  }

  private async applyUsernamePatch(
    user: UserEntity,
    username: string,
    patch: Partial<UserEntity>,
  ): Promise<void> {
    const normalizedUsername = this.normalizeUsername(username);

    if (normalizedUsername === user.username) {
      return;
    }

    await this.assertUsernameAvailable(normalizedUsername, user.id);
    patch.username = normalizedUsername;
  }

  private async applyEmailPatch(
    user: UserEntity,
    email: string | null,
    patch: Partial<UserEntity>,
  ): Promise<void> {
    const nextEmail = this.normalizeEmail(email);

    if (nextEmail === user.email) {
      return;
    }

    if (nextEmail) {
      await this.assertEmailAvailable(nextEmail, user.id);
    }

    patch.email = nextEmail;
    patch.emailVerifiedAt = null;
  }

  private async assertUsernameAvailable(
    username: string,
    excludeUserId?: Uuid,
  ): Promise<void> {
    const existing = await this.findByUsername(username);

    if (existing && existing.id !== excludeUserId) {
      throw new ConflictException('Username already exists');
    }
  }

  private async assertEmailAvailable(
    email: string,
    excludeUserId?: Uuid,
  ): Promise<void> {
    const existing = await this.findByEmail(email);

    if (existing && existing.id !== excludeUserId) {
      throw new ConflictException('Email already exists');
    }
  }

  private normalizeEmail(email: string | null): string | null {
    if (email === null) {
      return null;
    }

    const trimmed = email.trim().toLowerCase();

    return trimmed.length > 0 ? trimmed : null;
  }

  private normalizeUsername(username: string): string {
    return username.trim().toLowerCase();
  }

  private normalizeFullName(fullName: string): string {
    return fullName.trim().replaceAll(/\s+/g, ' ');
  }
}
