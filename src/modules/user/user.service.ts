import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { generateHash } from '../../common/utils';
import { StaffRole } from '../../constants';
import { UserEntity } from './user.entity';

interface ICreateUserPayload {
  username: string;
  email?: string | null;
  passwordHash: string;
  role?: StaffRole;
  isActive?: boolean;
}

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
    email?: string | null;
    password: string;
    role: StaffRole;
    isActive?: boolean;
  }): Promise<UserEntity> {
    return this.createUser({
      username: payload.username,
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

  findAllUsers(): Promise<UserEntity[]> {
    return this.userRepository.find({ order: { createdAt: 'DESC' } });
  }

  private normalizeUsername(username: string): string {
    return username.trim().toLowerCase();
  }
}
