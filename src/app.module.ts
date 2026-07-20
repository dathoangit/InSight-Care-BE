import './boilerplate.polyfill';

import { join } from 'node:path';

import { CacheModule } from '@nestjs/cache-manager';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  AcceptLanguageResolver,
  HeaderResolver,
  I18nModule,
  QueryResolver,
} from 'nestjs-i18n';
import { DataSource } from 'typeorm';

import { BEDS_STATUS_TODAY_CACHE_TTL_MS } from './constants/cache-keys';
import { HttpExceptionFilter } from './filters/bad-request.filter';
import { QueryFailedFilter } from './filters/query-failed.filter';
import { ResponseInterceptor } from './interceptors/responseInterceptor.service';
import { AuthModule } from './modules/auth/auth.module';
import { DailyRecordModule } from './modules/daily-record/daily-record.module';
import { HealthCheckerModule } from './modules/health-checker/health-checker.module';
import { LayoutModule } from './modules/layout/layout.module';
import { SeedModule } from './modules/seed/seed.module';
import { UserModule } from './modules/user/user.module';
import { SnakeNamingStrategy } from './snake-naming.strategy';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    CacheModule.register({
      isGlobal: true,
      ttl: BEDS_STATUS_TODAY_CACHE_TTL_MS,
      max: 100,
    }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 60 }],
    }),
    I18nModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        fallbackLanguage: config.get<string>('FALLBACK_LANGUAGE') ?? 'en',
        loaderOptions: {
          path: join(__dirname, 'i18n'),
          watch: config.get<string>('NODE_ENV') === 'development',
        },
        resolvers: [
          { use: QueryResolver, options: ['lang'] },
          AcceptLanguageResolver,
          { use: HeaderResolver, options: ['accept-language'] },
        ],
      }),
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const dbType = (
          configService.get<string>('DB_TYPE') || 'postgres'
        ).toLowerCase();
        const isMysql = dbType === 'mysql';

        return {
          type: isMysql ? 'mysql' : 'postgres',
          host: configService.get<string>('DB_HOST'),
          port: configService.get<number>('DB_PORT'),
          username: configService.get<string>('DB_USERNAME'),
          password: configService.get<string>('DB_PASSWORD'),
          database: configService.get<string>('DB_DATABASE'),
          ...(isMysql
            ? {
                charset: 'utf8mb4_unicode_ci' as const,
              }
            : {
                extra: {
                  options: '-c timezone=UTC',
                  max: configService.get<number>('DB_POOL_MAX') ?? 10,
                  connectionTimeoutMillis:
                    configService.get<number>(
                      'DB_POOL_CONNECTION_TIMEOUT_MS',
                    ) ?? 5000,
                },
              }),
          namingStrategy: new SnakeNamingStrategy(),
          autoLoadEntities: true,
          migrationsRun:
            configService.get<string>('TYPEORM_MIGRATIONS_RUN') === 'true',
          migrations: ['dist/database/migrations/*.js'],
          synchronize: false,
          logging: process.env.NODE_ENV === 'development',
        };
      },
      dataSourceFactory: async (options) => {
        if (!options) {
          throw new Error('TypeORM options are required');
        }
        const dataSource = new DataSource(options);
        await dataSource.initialize();

        return dataSource;
      },
      inject: [ConfigService],
    }),
    AuthModule,
    UserModule,
    LayoutModule,
    DailyRecordModule,
    SeedModule,
    HealthCheckerModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_FILTER, useClass: QueryFailedFilter },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule {}
