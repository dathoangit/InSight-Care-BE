import { CACHE_MANAGER } from '@nestjs/cache-manager';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { type Cache } from 'cache-manager';
import { Repository } from 'typeorm';

import {
  businessDayEndUtc,
  businessDayStartUtc,
  formatBusinessDayYmd,
  getEditableShift,
  getPreviousYmdVN,
  getTodayYmdVN,
  isValidYmd,
} from '../../common/vietnam-date';
import {
  BEDS_STATUS_TODAY_CACHE_KEY,
  BEDS_STATUS_TODAY_CACHE_TTL_MS,
} from '../../constants/cache-keys';
import { BedEntity } from '../layout/entities/bed.entity';
import { type UserEntity } from '../user/user.entity';
import { type IBedStatusResponseDto } from './dto/bed-status-response.dto';
import { type HistoryQueryDto } from './dto/history-query.dto';
import { type PatientEpisodeQueryDto } from './dto/patient-episode-query.dto';
import {
  type IPatientEpisodeResponseDto,
  type IRecordEnteredByDto,
} from './dto/patient-episode-response.dto';
import { type UpsertDailyRecordDto } from './dto/upsert-daily-record.dto';
import { DailyRecordEntity } from './entities/daily-record.entity';
import {
  buildChartSeries,
  buildDailyRows,
  buildRecordsByDate,
  buildSummary,
  countInclusiveDays,
  countShiftsWithVitals,
  normalizePatientName,
  resolveEpisodeBoundaries,
} from './patient-episode.utils';

const MORNING_UPSERT_KEYS = [
  'morningPatientName',
  'morningPulse',
  'morningTemp',
  'morningBp',
  'morningNote',
] as const satisfies ReadonlyArray<keyof UpsertDailyRecordDto>;

const EVENING_UPSERT_KEYS = [
  'eveningPatientName',
  'eveningPulse',
  'eveningTemp',
  'eveningBp',
  'eveningNote',
] as const satisfies ReadonlyArray<keyof UpsertDailyRecordDto>;

const RECORD_USER_RELATIONS = {
  morningEnteredByUser: true,
  eveningEnteredByUser: true,
} as const;

export interface ITodayRecordDto {
  id: Uuid;
  date: string;
  bedId: Uuid;
  morningPatientName: string | null;
  eveningPatientName: string | null;
  morningPulse: number | null;
  morningTemp: number | null;
  morningBp: string | null;
  morningNote: string | null;
  eveningPulse: number | null;
  eveningTemp: number | null;
  eveningBp: string | null;
  eveningNote: string | null;
  isLocked: boolean;
  morningEnteredBy: IRecordEnteredByDto | null;
  eveningEnteredBy: IRecordEnteredByDto | null;
}

export interface IBedTodayStatusDto {
  bedId: Uuid;
  roomId: Uuid;
  floor: number;
  roomName: string;
  bedName: string;
  todayRecord: ITodayRecordDto | null;
  yesterdayPatientName: string | null;
}

@Injectable()
export class DailyRecordService {
  constructor(
    @InjectRepository(DailyRecordEntity)
    private readonly dailyRecordRepository: Repository<DailyRecordEntity>,
    @InjectRepository(BedEntity)
    private readonly bedRepository: Repository<BedEntity>,
    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache,
  ) {}

  async getStatus(queryDate?: string): Promise<IBedStatusResponseDto> {
    const serverDate = getTodayYmdVN();
    const requestedDate = this.resolveRequestedDate(queryDate);
    const editableShift = getEditableShift();

    const beds =
      requestedDate === serverDate
        ? await this.getTodayStatus()
        : await this.buildBedStatusForDate(requestedDate);

    return {
      serverDate,
      editableShift,
      requestedDate,
      beds,
    };
  }

  private resolveRequestedDate(queryDate?: string): string {
    const serverToday = getTodayYmdVN();
    const normalized = queryDate?.trim();

    if (!normalized || normalized === 'today') {
      return serverToday;
    }

    if (!isValidYmd(normalized)) {
      throw new BadRequestException('Invalid date format');
    }

    if (normalized > serverToday) {
      throw new BadRequestException('Cannot query future dates');
    }

    return normalized;
  }

  async getTodayStatus(): Promise<IBedTodayStatusDto[]> {
    const shouldSkipCache = process.env.NODE_ENV === 'development';

    if (!shouldSkipCache) {
      const cached = await this.cacheManager.get<IBedTodayStatusDto[]>(
        BEDS_STATUS_TODAY_CACHE_KEY,
      );

      if (cached) {
        return cached;
      }
    }

    const result = await this.buildBedStatusForDate(getTodayYmdVN());

    if (!shouldSkipCache) {
      await this.cacheManager.set(
        BEDS_STATUS_TODAY_CACHE_KEY,
        result,
        BEDS_STATUS_TODAY_CACHE_TTL_MS,
      );
    }

    return result;
  }

  private async buildBedStatusForDate(
    dateYmd: string,
  ): Promise<IBedTodayStatusDto[]> {
    const previousDay = getPreviousYmdVN(dateYmd);
    const dayStart = businessDayStartUtc(dateYmd);
    const dayEnd = businessDayEndUtc(dateYmd);
    const previousStart = businessDayStartUtc(previousDay);
    const previousEnd = businessDayEndUtc(previousDay);

    const beds = await this.bedRepository
      .createQueryBuilder('bed')
      .leftJoinAndSelect('bed.room', 'room')
      .orderBy('room.floor', 'ASC')
      .addOrderBy('room.name', 'ASC')
      .addOrderBy('bed.name', 'ASC')
      .getMany();

    const records = await this.dailyRecordRepository
      .createQueryBuilder('record')
      .leftJoinAndSelect('record.morningEnteredByUser', 'morningEnteredByUser')
      .leftJoinAndSelect('record.eveningEnteredByUser', 'eveningEnteredByUser')
      .where(
        '(record.business_day_at >= :dayStart AND record.business_day_at < :dayEnd)',
        { dayStart, dayEnd },
      )
      .orWhere(
        '(record.business_day_at >= :previousStart AND record.business_day_at < :previousEnd)',
        { previousStart, previousEnd },
      )
      .getMany();

    const recordByBedId = new Map<Uuid, DailyRecordEntity>();
    const previousDayPatientByBedId = new Map<Uuid, string>();

    for (const record of records) {
      const recordDayYmd = formatBusinessDayYmd(record.businessDayAt);

      if (recordDayYmd === dateYmd) {
        recordByBedId.set(record.bedId, record);
      }

      if (recordDayYmd === previousDay) {
        const previousDayName =
          record.eveningPatientName ?? record.morningPatientName;

        if (previousDayName) {
          previousDayPatientByBedId.set(record.bedId, previousDayName);
        }
      }
    }

    return beds.map((bed) => {
      const dayRecord = recordByBedId.get(bed.id);

      return {
        bedId: bed.id,
        roomId: bed.roomId,
        floor: bed.room.floor,
        roomName: bed.room.name,
        bedName: bed.name,
        todayRecord: dayRecord ? this.toTodayRecordDto(dayRecord) : null,
        yesterdayPatientName: previousDayPatientByBedId.get(bed.id) ?? null,
      };
    });
  }

  async upsert(
    dto: UpsertDailyRecordDto,
    userId: Uuid,
  ): Promise<ITodayRecordDto> {
    const bed = await this.bedRepository.findOne({ where: { id: dto.bedId } });

    if (!bed) {
      throw new NotFoundException('Bed not found');
    }

    const businessDayAt = businessDayStartUtc(getTodayYmdVN());
    const existing = await this.dailyRecordRepository.findOne({
      where: { bedId: dto.bedId, businessDayAt },
    });

    if (existing?.isLocked) {
      throw new ConflictException('Record is locked for today');
    }

    const record =
      existing ?? this.createDailyRecordForToday(dto.bedId, businessDayAt, dto);
    this.applyUpsertFields(record, dto, userId);

    const saved = await this.dailyRecordRepository.save(record);
    await this.cacheManager.del(BEDS_STATUS_TODAY_CACHE_KEY);

    const withUsers = await this.dailyRecordRepository.findOne({
      where: { id: saved.id },
      relations: RECORD_USER_RELATIONS,
    });

    return this.toTodayRecordDto(withUsers ?? saved);
  }

  private createDailyRecordForToday(
    bedId: Uuid,
    businessDayAt: Date,
    dto: UpsertDailyRecordDto,
  ): DailyRecordEntity {
    return this.dailyRecordRepository.create({
      businessDayAt,
      bedId,
      morningPatientName: dto.morningPatientName ?? null,
      eveningPatientName: dto.eveningPatientName ?? null,
      morningPulse: dto.morningPulse ?? null,
      morningTemp: dto.morningTemp ?? null,
      morningBp: dto.morningBp ?? null,
      morningNote: dto.morningNote ?? null,
      eveningPulse: dto.eveningPulse ?? null,
      eveningTemp: dto.eveningTemp ?? null,
      eveningBp: dto.eveningBp ?? null,
      eveningNote: dto.eveningNote ?? null,
      isLocked: false,
    });
  }

  private applyUpsertFields(
    record: DailyRecordEntity,
    dto: UpsertDailyRecordDto,
    userId: Uuid,
  ): void {
    const fieldMap: Array<
      [keyof UpsertDailyRecordDto, keyof DailyRecordEntity]
    > = [
      ['morningPatientName', 'morningPatientName'],
      ['eveningPatientName', 'eveningPatientName'],
      ['morningPulse', 'morningPulse'],
      ['morningTemp', 'morningTemp'],
      ['morningBp', 'morningBp'],
      ['morningNote', 'morningNote'],
      ['eveningPulse', 'eveningPulse'],
      ['eveningTemp', 'eveningTemp'],
      ['eveningBp', 'eveningBp'],
      ['eveningNote', 'eveningNote'],
    ];

    for (const [dtoKey, entityKey] of fieldMap) {
      if (dto[dtoKey] !== undefined) {
        record[entityKey] = dto[dtoKey] as never;
      }
    }

    if (MORNING_UPSERT_KEYS.some((key) => dto[key] !== undefined)) {
      record.morningEnteredByUserId = userId;
    }

    if (EVENING_UPSERT_KEYS.some((key) => dto[key] !== undefined)) {
      record.eveningEnteredByUserId = userId;
    }
  }

  async getPatientEpisode(
    query: PatientEpisodeQueryDto,
  ): Promise<IPatientEpisodeResponseDto> {
    if (!isValidYmd(query.anchorDate)) {
      throw new BadRequestException('Invalid anchor date format');
    }

    const serverToday = getTodayYmdVN();

    if (query.anchorDate > serverToday) {
      throw new BadRequestException('Cannot query future dates');
    }

    const bed = await this.bedRepository.findOne({
      where: { id: query.bedId },
      relations: { room: true },
    });

    if (!bed) {
      throw new NotFoundException('Bed not found');
    }

    const records = await this.dailyRecordRepository.find({
      where: { bedId: query.bedId },
      order: { businessDayAt: 'ASC' },
      relations: RECORD_USER_RELATIONS,
    });

    const normalizedName = normalizePatientName(query.patientName);
    const recordsByDate = buildRecordsByDate(records);
    const boundaries = resolveEpisodeBoundaries(
      recordsByDate,
      normalizedName,
      query.anchorDate,
    );

    if (!boundaries) {
      throw new NotFoundException('Patient episode not found');
    }

    const dailyRows = buildDailyRows(
      recordsByDate,
      boundaries.startDate,
      boundaries.endDate,
    );

    return {
      patientName: boundaries.displayName,
      bed: {
        bedId: bed.id,
        bedName: bed.name,
        roomName: bed.room.name,
        floor: bed.room.floor,
      },
      startDate: boundaries.startDate,
      endDate: boundaries.endDate,
      anchorDate: query.anchorDate,
      totalDays: countInclusiveDays(boundaries.startDate, boundaries.endDate),
      shiftsWithVitals: countShiftsWithVitals(dailyRows),
      dailyRows,
      chartSeries: buildChartSeries(dailyRows),
      summary: buildSummary(dailyRows),
    };
  }

  async getHistory(query: HistoryQueryDto): Promise<ITodayRecordDto[]> {
    const rangeStart = businessDayStartUtc(query.startDate);
    const rangeEnd = businessDayEndUtc(query.endDate);

    const qb = this.dailyRecordRepository
      .createQueryBuilder('record')
      .leftJoinAndSelect('record.morningEnteredByUser', 'morningEnteredByUser')
      .leftJoinAndSelect('record.eveningEnteredByUser', 'eveningEnteredByUser')
      .where('record.business_day_at >= :rangeStart', { rangeStart })
      .andWhere('record.business_day_at < :rangeEnd', { rangeEnd });

    if (query.bedId) {
      qb.andWhere('record.bed_id = :bedId', { bedId: query.bedId });
    }

    if (query.patientName) {
      qb.andWhere(
        '(record.morning_patient_name ILIKE :name OR record.evening_patient_name ILIKE :name)',
        { name: `%${query.patientName}%` },
      );
    }

    qb.orderBy('record.business_day_at', 'ASC').addOrderBy(
      'record.bed_id',
      'ASC',
    );

    const records = await qb.getMany();

    return records.map((record) => this.toTodayRecordDto(record));
  }

  async lockTodayRecords(): Promise<void> {
    const today = getTodayYmdVN();
    const dayStart = businessDayStartUtc(today);
    const dayEnd = businessDayEndUtc(today);

    await this.dailyRecordRepository
      .createQueryBuilder()
      .update(DailyRecordEntity)
      .set({ isLocked: true })
      .where('business_day_at >= :dayStart', { dayStart })
      .andWhere('business_day_at < :dayEnd', { dayEnd })
      .andWhere('is_locked = :locked', { locked: false })
      .execute();

    await this.cacheManager.del(BEDS_STATUS_TODAY_CACHE_KEY);
  }

  private toEnteredByDto(
    user: UserEntity | null | undefined,
  ): IRecordEnteredByDto | null {
    if (!user) {
      return null;
    }

    return {
      userId: user.id,
      username: user.username,
    };
  }

  private toTodayRecordDto(record: DailyRecordEntity): ITodayRecordDto {
    return {
      id: record.id,
      date: formatBusinessDayYmd(record.businessDayAt),
      bedId: record.bedId,
      morningPatientName: record.morningPatientName,
      eveningPatientName: record.eveningPatientName,
      morningPulse: record.morningPulse,
      morningTemp: record.morningTemp,
      morningBp: record.morningBp,
      morningNote: record.morningNote,
      eveningPulse: record.eveningPulse,
      eveningTemp: record.eveningTemp,
      eveningBp: record.eveningBp,
      eveningNote: record.eveningNote,
      isLocked: record.isLocked,
      morningEnteredBy: this.toEnteredByDto(record.morningEnteredByUser),
      eveningEnteredBy: this.toEnteredByDto(record.eveningEnteredByUser),
    };
  }
}
