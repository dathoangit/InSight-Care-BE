import { CACHE_MANAGER } from '@nestjs/cache-manager';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { type Cache } from 'cache-manager';
import { DataSource, type EntityManager, Repository } from 'typeorm';

import {
  businessDayEndUtc,
  businessDayStartUtc,
  formatBusinessDayYmd,
  getEditableShift,
  getPreviousYmdVN,
  getTodayYmdVN,
  isValidYmd,
  offsetYmdVN,
} from '../../common/vietnam-date';
import {
  BEDS_STATUS_TODAY_CACHE_KEY,
  BEDS_STATUS_TODAY_CACHE_TTL_MS,
} from '../../constants/cache-keys';
import { BedEntity } from '../layout/entities/bed.entity';
import { sortBedsByLayout } from '../layout/utils/sort-beds-by-layout';
import { type UserEntity } from '../user/user.entity';
import { type IBedStatusResponseDto } from './dto/bed-status-response.dto';
import { type HistoryQueryDto } from './dto/history-query.dto';
import {
  type IHistoryAdmissionItemDto,
  type IHistoryResponseDto,
} from './dto/history-response.dto';
import { type PatientAdmissionsQueryDto } from './dto/patient-admissions-query.dto';
import { type IPatientAdmissionsResponseDto } from './dto/patient-admissions-response.dto';
import { type PatientEpisodeQueryDto } from './dto/patient-episode-query.dto';
import {
  type IPatientEpisodeResponseDto,
  type IRecordEnteredByDto,
} from './dto/patient-episode-response.dto';
import { type UpsertDailyRecordDto } from './dto/upsert-daily-record.dto';
import { DailyRecordEntity } from './entities/daily-record.entity';
import { PatientEntity } from './entities/patient.entity';
import { PatientAdmissionEntity } from './entities/patient-admission.entity';
import {
  PatientAdmissionResolverService,
  type ResolveAdmissionShift,
} from './patient-admission-resolver.service';
import {
  buildChartSeries,
  buildPatientDailyRows,
  buildRecordsByDate,
  buildSummary,
  countInclusiveDays,
  countShiftsWithVitals,
  createCodeMatcher,
  createNameMatcher,
  extractPatientCodeFromEpisode,
  findAllEpisodes,
  type IPatientDailyRowFilter,
  normalizePatientCodeField,
  resolveEpisodeBoundaries,
  shiftMatchesMatcher,
} from './patient-episode.utils';

const MORNING_UPSERT_KEYS = [
  'morningPatientName',
  'morningPatientCode',
  'morningPulse',
  'morningTemp',
  'morningBp',
  'morningNote',
] as const satisfies ReadonlyArray<keyof UpsertDailyRecordDto>;

const EVENING_UPSERT_KEYS = [
  'eveningPatientName',
  'eveningPatientCode',
  'eveningPulse',
  'eveningTemp',
  'eveningBp',
  'eveningNote',
] as const satisfies ReadonlyArray<keyof UpsertDailyRecordDto>;

const RECORD_USER_RELATIONS = {
  morningEnteredByUser: true,
  eveningEnteredByUser: true,
} as const;

const HISTORY_DEFAULT_LIMIT = 200;
const HISTORY_MAX_LIMIT = 500;
const FALLBACK_EPISODE_WINDOW_DAYS = 400;

function minDateYmd(values: string[]): string {
  let min = values[0];

  for (let index = 1; index < values.length; index += 1) {
    if (values[index] < min) {
      min = values[index];
    }
  }

  return min;
}

function maxDateYmd(values: string[]): string {
  let max = values[0];

  for (let index = 1; index < values.length; index += 1) {
    if (values[index] > max) {
      max = values[index];
    }
  }

  return max;
}

function createPatientMatcher(
  patientCode?: string | null,
  patientName?: string | null,
) {
  if (patientCode) {
    return createCodeMatcher(patientCode);
  }

  if (patientName) {
    return createNameMatcher(patientName);
  }

  return null;
}

interface IAdmissionDateBoundsSource {
  startDate: string;
  endDate: string | null;
}

function getAdmissionDateBounds(
  admissions: IAdmissionDateBoundsSource[],
  fallbackEndDate: string,
): { minStartDate: string; maxEndDate: string } {
  return {
    minStartDate: minDateYmd(
      admissions.map((admission) => admission.startDate),
    ),
    maxEndDate: maxDateYmd(
      admissions.map((admission) => admission.endDate ?? fallbackEndDate),
    ),
  };
}

interface IIndexedBedStatusRecords {
  recordByBedId: Map<Uuid, DailyRecordEntity>;
  previousDayPatientByBedId: Map<Uuid, string>;
  previousDayPatientCodeByBedId: Map<Uuid, string>;
}

export interface ITodayRecordDto {
  id: Uuid;
  date: string;
  bedId: Uuid;
  morningPatientName: string | null;
  morningPatientCode: string | null;
  morningPatientAdmissionId: Uuid | null;
  eveningPatientName: string | null;
  eveningPatientCode: string | null;
  eveningPatientAdmissionId: Uuid | null;
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
  floor: string;
  roomName: string;
  bedName: string;
  todayRecord: ITodayRecordDto | null;
  yesterdayPatientName: string | null;
  yesterdayPatientCode: string | null;
}

@Injectable()
export class DailyRecordService {
  private readonly logger = new Logger(DailyRecordService.name);

  constructor(
    @InjectRepository(DailyRecordEntity)
    private readonly dailyRecordRepository: Repository<DailyRecordEntity>,
    @InjectRepository(BedEntity)
    private readonly bedRepository: Repository<BedEntity>,
    @InjectRepository(PatientEntity)
    private readonly patientRepository: Repository<PatientEntity>,
    @InjectRepository(PatientAdmissionEntity)
    private readonly admissionRepository: Repository<PatientAdmissionEntity>,
    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache,
    private readonly patientAdmissionResolver: PatientAdmissionResolverService,
    private readonly dataSource: DataSource,
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

    const beds = sortBedsByLayout(
      await this.bedRepository
        .createQueryBuilder('bed')
        .leftJoinAndSelect('bed.room', 'room')
        .getMany(),
    );

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

    const indexedRecords = this.indexBedStatusRecords(
      records,
      dateYmd,
      previousDay,
    );

    return beds.map((bed) => {
      const dayRecord = indexedRecords.recordByBedId.get(bed.id);

      return {
        bedId: bed.id,
        roomId: bed.roomId,
        floor: bed.room.floor,
        roomName: bed.room.name,
        bedName: bed.name,
        todayRecord: dayRecord ? this.toTodayRecordDto(dayRecord) : null,
        yesterdayPatientName:
          indexedRecords.previousDayPatientByBedId.get(bed.id) ?? null,
        yesterdayPatientCode:
          indexedRecords.previousDayPatientCodeByBedId.get(bed.id) ?? null,
      };
    });
  }

  private indexBedStatusRecords(
    records: DailyRecordEntity[],
    dateYmd: string,
    previousDay: string,
  ): IIndexedBedStatusRecords {
    const recordByBedId = new Map<Uuid, DailyRecordEntity>();
    const previousDayPatientByBedId = new Map<Uuid, string>();
    const previousDayPatientCodeByBedId = new Map<Uuid, string>();

    for (const record of records) {
      const recordDayYmd = formatBusinessDayYmd(record.businessDayAt);

      if (recordDayYmd === dateYmd) {
        recordByBedId.set(record.bedId, record);
      }

      if (recordDayYmd === previousDay) {
        const previousDayName =
          record.eveningPatientName ?? record.morningPatientName;
        const previousDayCode =
          record.eveningPatientCode ?? record.morningPatientCode;

        if (previousDayName) {
          previousDayPatientByBedId.set(record.bedId, previousDayName);
        }

        if (previousDayCode) {
          previousDayPatientCodeByBedId.set(record.bedId, previousDayCode);
        }
      }
    }

    return {
      recordByBedId,
      previousDayPatientByBedId,
      previousDayPatientCodeByBedId,
    };
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
    const previousDayAt = businessDayStartUtc(
      getPreviousYmdVN(getTodayYmdVN()),
    );

    const preCheck = await this.dailyRecordRepository.findOne({
      where: { bedId: dto.bedId, businessDayAt },
    });

    if (preCheck?.isLocked) {
      throw new ConflictException('Record is locked for today');
    }

    this.patientAdmissionResolver.resetMetrics();

    const saved = await this.dataSource.transaction(async (manager) => {
      const recordRepo = manager.getRepository(DailyRecordEntity);
      const existing = await recordRepo.findOne({
        where: { bedId: dto.bedId, businessDayAt },
      });

      if (existing?.isLocked) {
        throw new ConflictException('Record is locked for today');
      }

      const record =
        existing ??
        this.createDailyRecordForToday(
          dto.bedId,
          businessDayAt,
          dto,
          recordRepo,
        );
      this.applyUpsertFields(record, dto, userId);

      const previousDayRecord = await recordRepo.findOne({
        where: { bedId: dto.bedId, businessDayAt: previousDayAt },
      });

      await this.syncPatientAdmissions(
        record,
        dto,
        businessDayAt,
        existing,
        previousDayRecord,
        manager,
      );

      return recordRepo.save(record);
    });

    this.patientAdmissionResolver.logMetrics('upsert');
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
    recordRepository: Repository<DailyRecordEntity> = this
      .dailyRecordRepository,
  ): DailyRecordEntity {
    return recordRepository.create({
      businessDayAt,
      bedId,
      morningPatientName: dto.morningPatientName ?? null,
      morningPatientCode: normalizePatientCodeField(dto.morningPatientCode),
      eveningPatientName: dto.eveningPatientName ?? null,
      eveningPatientCode: normalizePatientCodeField(dto.eveningPatientCode),
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
      ['morningPatientCode', 'morningPatientCode'],
      ['eveningPatientName', 'eveningPatientName'],
      ['eveningPatientCode', 'eveningPatientCode'],
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
        const value = dto[dtoKey];

        record[entityKey] =
          dtoKey === 'morningPatientCode' || dtoKey === 'eveningPatientCode'
            ? (normalizePatientCodeField(
                value as string | null | undefined,
              ) as never)
            : (value as never);
      }
    }

    if (MORNING_UPSERT_KEYS.some((key) => dto[key] !== undefined)) {
      record.morningEnteredByUserId = userId;
    }

    if (EVENING_UPSERT_KEYS.some((key) => dto[key] !== undefined)) {
      record.eveningEnteredByUserId = userId;
    }
  }

  private async syncPatientAdmissions(
    record: DailyRecordEntity,
    dto: UpsertDailyRecordDto,
    businessDayAt: Date,
    existing: DailyRecordEntity | null,
    previousDayRecord: DailyRecordEntity | null,
    manager?: EntityManager,
  ): Promise<void> {
    const shifts: ResolveAdmissionShift[] = [];

    if (
      dto.morningPatientName !== undefined ||
      dto.morningPatientCode !== undefined
    ) {
      shifts.push('morning');
    }

    if (
      dto.eveningPatientName !== undefined ||
      dto.eveningPatientCode !== undefined
    ) {
      shifts.push('evening');
    }

    await Promise.all(
      shifts.map(async (shift) => {
        const patientName =
          shift === 'morning'
            ? record.morningPatientName
            : record.eveningPatientName;
        const patientCode =
          shift === 'morning'
            ? record.morningPatientCode
            : record.eveningPatientCode;

        const admission = await this.patientAdmissionResolver.resolveAdmission({
          bedId: record.bedId,
          businessDayAt,
          shift,
          patientName,
          patientCode,
          existingRecord: existing ?? record,
          previousDayRecord,
          manager,
        });

        if (shift === 'morning') {
          record.morningPatientAdmissionId = admission?.id ?? null;
        } else {
          record.eveningPatientAdmissionId = admission?.id ?? null;
        }
      }),
    );
  }

  private async fetchDailyRecordsInRange(
    bedId: Uuid,
    startDate: string,
    endDate: string,
  ): Promise<DailyRecordEntity[]> {
    const rangeStart = businessDayStartUtc(startDate);
    const rangeEnd = businessDayEndUtc(endDate);

    return this.dailyRecordRepository
      .createQueryBuilder('record')
      .leftJoinAndSelect('record.morningEnteredByUser', 'morningEnteredByUser')
      .leftJoinAndSelect('record.eveningEnteredByUser', 'eveningEnteredByUser')
      .where('record.bed_id = :bedId', { bedId })
      .andWhere('record.business_day_at >= :rangeStart', { rangeStart })
      .andWhere('record.business_day_at < :rangeEnd', { rangeEnd })
      .orderBy('record.business_day_at', 'ASC')
      .getMany();
  }

  private async fetchDailyRecordsForBedsInRange(
    bedIds: Uuid[],
    startDate: string,
    endDate: string,
  ): Promise<DailyRecordEntity[]> {
    if (bedIds.length === 0) {
      return [];
    }

    const rangeStart = businessDayStartUtc(startDate);
    const rangeEnd = businessDayEndUtc(endDate);

    return this.dailyRecordRepository
      .createQueryBuilder('record')
      .leftJoinAndSelect('record.morningEnteredByUser', 'morningEnteredByUser')
      .leftJoinAndSelect('record.eveningEnteredByUser', 'eveningEnteredByUser')
      .where('record.bed_id IN (:...bedIds)', { bedIds })
      .andWhere('record.business_day_at >= :rangeStart', { rangeStart })
      .andWhere('record.business_day_at < :rangeEnd', { rangeEnd })
      .orderBy('record.business_day_at', 'ASC')
      .getMany();
  }

  private groupRecordsByBedId(
    records: DailyRecordEntity[],
  ): Map<Uuid, DailyRecordEntity[]> {
    const recordsByBedId = new Map<Uuid, DailyRecordEntity[]>();

    for (const record of records) {
      const list = recordsByBedId.get(record.bedId) ?? [];
      list.push(record);
      recordsByBedId.set(record.bedId, list);
    }

    return recordsByBedId;
  }

  private pickAdmissionIdFromAnchorRecord(
    record: DailyRecordEntity,
    patientCode: string | null,
    patientName: string | null,
  ): Uuid | null {
    const matcher = createPatientMatcher(patientCode, patientName);

    if (matcher) {
      if (
        shiftMatchesMatcher(record, 'evening', matcher) &&
        record.eveningPatientAdmissionId
      ) {
        return record.eveningPatientAdmissionId;
      }

      if (
        shiftMatchesMatcher(record, 'morning', matcher) &&
        record.morningPatientAdmissionId
      ) {
        return record.morningPatientAdmissionId;
      }
    }

    return (
      record.eveningPatientAdmissionId ??
      record.morningPatientAdmissionId ??
      null
    );
  }

  private async resolveAdmissionContext(
    bedId: Uuid,
    anchorDate: string,
    patientCode?: string,
    patientName?: string,
  ): Promise<{
    admission: PatientAdmissionEntity;
    patient: PatientEntity;
    startDate: string;
    endDate: string;
    displayName: string;
    patientCode: string | null;
  } | null> {
    const normalizedCode = normalizePatientCodeField(patientCode);
    const anchorRecord = await this.dailyRecordRepository.findOne({
      where: {
        bedId,
        businessDayAt: businessDayStartUtc(anchorDate),
      },
    });

    if (anchorRecord) {
      const fromAnchor = await this.resolveContextFromAnchorRecord(
        bedId,
        anchorRecord,
        normalizedCode,
        patientName,
      );

      if (fromAnchor) {
        return fromAnchor;
      }
    }

    if (normalizedCode) {
      return this.resolveContextByPatientCode(
        bedId,
        anchorDate,
        normalizedCode,
        patientName,
      );
    }

    if (!patientName?.trim() || !anchorRecord) {
      return null;
    }

    return this.resolveContextFromAnchorRecord(
      bedId,
      anchorRecord,
      null,
      patientName,
    );
  }

  private async resolveContextFromAnchorRecord(
    bedId: Uuid,
    anchorRecord: DailyRecordEntity,
    normalizedCode: string | null,
    patientName?: string,
  ): Promise<{
    admission: PatientAdmissionEntity;
    patient: PatientEntity;
    startDate: string;
    endDate: string;
    displayName: string;
    patientCode: string | null;
  } | null> {
    const admissionId = this.pickAdmissionIdFromAnchorRecord(
      anchorRecord,
      normalizedCode,
      patientName ?? null,
    );

    if (!admissionId) {
      return null;
    }

    const admission = await this.admissionRepository.findOne({
      where: { id: admissionId, bedId },
      relations: { patient: true },
    });

    if (!admission) {
      return null;
    }

    return this.formatAdmissionContext(admission, patientName, normalizedCode);
  }

  private async resolveContextByPatientCode(
    bedId: Uuid,
    anchorDate: string,
    normalizedCode: string,
    patientName?: string,
  ): Promise<{
    admission: PatientAdmissionEntity;
    patient: PatientEntity;
    startDate: string;
    endDate: string;
    displayName: string;
    patientCode: string | null;
  } | null> {
    const patient = await this.patientRepository.findOne({
      where: { patientCode: normalizedCode },
    });

    if (!patient) {
      return null;
    }

    const admission = await this.admissionRepository
      .createQueryBuilder('admission')
      .innerJoinAndSelect('admission.patient', 'patient')
      .where('admission.patient_id = :patientId', { patientId: patient.id })
      .andWhere('admission.bed_id = :bedId', { bedId })
      .andWhere('admission.start_date <= :anchorDate', { anchorDate })
      .andWhere(
        '(admission.end_date IS NULL OR admission.end_date >= :anchorDate)',
        { anchorDate },
      )
      .orderBy('admission.start_date', 'DESC')
      .getOne();

    if (!admission) {
      return null;
    }

    return this.formatAdmissionContext(admission, patientName, normalizedCode);
  }

  private formatAdmissionContext(
    admission: PatientAdmissionEntity,
    patientName?: string,
    fallbackCode?: string | null,
  ): {
    admission: PatientAdmissionEntity;
    patient: PatientEntity;
    startDate: string;
    endDate: string;
    displayName: string;
    patientCode: string | null;
  } {
    return {
      admission,
      patient: admission.patient,
      startDate: admission.startDate,
      endDate: admission.endDate ?? admission.startDate,
      displayName: admission.patient.displayName ?? patientName?.trim() ?? '',
      patientCode: admission.patient.patientCode ?? fallbackCode ?? null,
    };
  }

  private buildPatientRowFilter(
    admission: PatientAdmissionEntity,
    patientCode: string | null,
    patientName: string | null,
  ): IPatientDailyRowFilter {
    return {
      admissionId: admission.id,
      matcher: createPatientMatcher(patientCode, patientName) ?? undefined,
    };
  }

  private async buildEpisodeResponseFromAdmission(
    bed: BedEntity,
    anchorDate: string,
    context: {
      admission: PatientAdmissionEntity;
      startDate: string;
      endDate: string;
      displayName: string;
      patientCode: string | null;
    },
    patientName: string | null,
  ): Promise<IPatientEpisodeResponseDto> {
    const records = await this.fetchDailyRecordsInRange(
      bed.id,
      context.startDate,
      context.endDate,
    );
    const recordsByDate = buildRecordsByDate(records);
    const dailyRows = buildPatientDailyRows(
      recordsByDate,
      context.startDate,
      context.endDate,
      this.buildPatientRowFilter(
        context.admission,
        context.patientCode,
        patientName,
      ),
    );

    return {
      patientName: context.displayName,
      patientCode: context.patientCode,
      bed: {
        bedId: bed.id,
        bedName: bed.name,
        roomName: bed.room.name,
        floor: bed.room.floor,
      },
      startDate: context.startDate,
      endDate: context.endDate,
      anchorDate,
      totalDays: countInclusiveDays(context.startDate, context.endDate),
      shiftsWithVitals: countShiftsWithVitals(dailyRows),
      dailyRows,
      chartSeries: buildChartSeries(dailyRows),
      summary: buildSummary(dailyRows),
    };
  }

  private buildAdmissionSummaryFromRecords(
    admission: PatientAdmissionEntity,
    patientCode: string,
    patientName: string | null,
    bedRecords: DailyRecordEntity[],
  ): IPatientAdmissionsResponseDto['admissions'][number] {
    const endDate = admission.endDate ?? admission.startDate;
    const recordsByDate = buildRecordsByDate(bedRecords);
    const dailyRows = buildPatientDailyRows(
      recordsByDate,
      admission.startDate,
      endDate,
      this.buildPatientRowFilter(admission, patientCode, patientName),
    );

    return {
      bed: {
        bedId: admission.bed.id,
        bedName: admission.bed.name,
        roomName: admission.bed.room.name,
        floor: admission.bed.room.floor,
      },
      startDate: admission.startDate,
      endDate,
      totalDays: countInclusiveDays(admission.startDate, endDate),
      shiftsWithVitals: countShiftsWithVitals(dailyRows),
      summary: buildSummary(dailyRows),
    };
  }

  private buildAdmissionSummariesBatch(
    admissions: PatientAdmissionEntity[],
    patientCode: string,
    patientName: string | null,
    recordsByBedId: Map<Uuid, DailyRecordEntity[]>,
  ): IPatientAdmissionsResponseDto['admissions'] {
    return admissions.map((admission) => {
      const endDate = admission.endDate ?? admission.startDate;
      const bedRecords = (recordsByBedId.get(admission.bedId) ?? []).filter(
        (record) => {
          const ymd = formatBusinessDayYmd(record.businessDayAt);

          return ymd >= admission.startDate && ymd <= endDate;
        },
      );

      return this.buildAdmissionSummaryFromRecords(
        admission,
        patientCode,
        patientName,
        bedRecords,
      );
    });
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

    const admissionContext = await this.resolveAdmissionContext(
      query.bedId,
      query.anchorDate,
      query.patientCode,
      query.patientName,
    );

    if (admissionContext) {
      return this.buildEpisodeResponseFromAdmission(
        bed,
        query.anchorDate,
        admissionContext,
        query.patientName,
      );
    }

    const matcher = query.patientCode
      ? createCodeMatcher(query.patientCode)
      : createNameMatcher(query.patientName);

    this.logger.warn(
      `getPatientEpisode fallback (no admission) bedId=${query.bedId} anchorDate=${query.anchorDate}`,
    );

    const windowStart = offsetYmdVN(
      query.anchorDate,
      -FALLBACK_EPISODE_WINDOW_DAYS,
    );
    const windowEndRaw = offsetYmdVN(
      query.anchorDate,
      FALLBACK_EPISODE_WINDOW_DAYS,
    );
    const boundedEnd = windowEndRaw > serverToday ? serverToday : windowEndRaw;
    const expandedRecords = await this.fetchDailyRecordsInRange(
      query.bedId,
      windowStart,
      boundedEnd,
    );
    const recordsByDate = buildRecordsByDate(expandedRecords);
    const boundaries = resolveEpisodeBoundaries(
      recordsByDate,
      matcher,
      query.anchorDate,
    );

    if (!boundaries) {
      throw new NotFoundException('Patient episode not found');
    }

    const rangedRecords = await this.fetchDailyRecordsInRange(
      query.bedId,
      boundaries.startDate,
      boundaries.endDate,
    );
    const rangedRecordsByDate = buildRecordsByDate(rangedRecords);
    const dailyRows = buildPatientDailyRows(
      rangedRecordsByDate,
      boundaries.startDate,
      boundaries.endDate,
      { matcher },
    );

    return {
      patientName: boundaries.displayName,
      patientCode:
        query.patientCode ??
        extractPatientCodeFromEpisode(
          recordsByDate,
          boundaries.startDate,
          boundaries.endDate,
        ),
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

  async getHistory(query: HistoryQueryDto): Promise<IHistoryResponseDto> {
    if (query.patientName?.trim() || query.patientCode?.trim()) {
      return this.getHistoryByAdmissions(query);
    }

    return this.getHistoryByDailyRecords(query);
  }

  private async getHistoryByDailyRecords(
    query: HistoryQueryDto,
  ): Promise<IHistoryResponseDto> {
    const limit = Math.min(
      query.limit ?? HISTORY_DEFAULT_LIMIT,
      HISTORY_MAX_LIMIT,
    );
    const offset = query.offset ?? 0;
    const rangeStart = businessDayStartUtc(query.startDate);
    const rangeEnd = businessDayEndUtc(query.endDate);

    const applyFilters = (
      builder: ReturnType<typeof this.dailyRecordRepository.createQueryBuilder>,
    ) => {
      builder
        .where('record.business_day_at >= :rangeStart', { rangeStart })
        .andWhere('record.business_day_at < :rangeEnd', { rangeEnd });

      if (query.bedId) {
        builder.andWhere('record.bed_id = :bedId', { bedId: query.bedId });
      }

      return builder;
    };

    const total = await applyFilters(
      this.dailyRecordRepository.createQueryBuilder('record'),
    ).getCount();

    const recordIds = await applyFilters(
      this.dailyRecordRepository.createQueryBuilder('record'),
    )
      .select('record.id', 'id')
      .orderBy('record.business_day_at', 'ASC')
      .addOrderBy('record.bed_id', 'ASC')
      .skip(offset)
      .take(limit)
      .getRawMany<{ id: Uuid }>();

    if (recordIds.length === 0) {
      return {
        view: 'daily',
        items: [],
        admissions: [],
        total,
        limit,
        offset,
      };
    }

    const ids = recordIds.map((row) => row.id);
    const records = await this.dailyRecordRepository
      .createQueryBuilder('record')
      .leftJoinAndSelect('record.morningEnteredByUser', 'morningEnteredByUser')
      .leftJoinAndSelect('record.eveningEnteredByUser', 'eveningEnteredByUser')
      .where('record.id IN (:...ids)', { ids })
      .orderBy('record.business_day_at', 'ASC')
      .addOrderBy('record.bed_id', 'ASC')
      .getMany();

    return {
      view: 'daily',
      items: records.map((record) => this.toTodayRecordDto(record)),
      admissions: [],
      total,
      limit,
      offset,
    };
  }

  private admissionOverlapsRange(
    admissionStart: string,
    admissionEnd: string | null,
    rangeStart: string,
    rangeEnd: string,
    serverToday: string,
  ): boolean {
    const effectiveEnd = admissionEnd ?? serverToday;

    return admissionStart <= rangeEnd && effectiveEnd >= rangeStart;
  }

  private async findHistoryAdmissionsFromDb(
    query: HistoryQueryDto,
    serverToday: string,
    normalizedCode: string | null,
    patientNameFilter: string | null,
  ): Promise<IHistoryAdmissionItemDto[]> {
    const builder = this.admissionRepository
      .createQueryBuilder('admission')
      .innerJoinAndSelect('admission.patient', 'patient')
      .innerJoinAndSelect('admission.bed', 'bed')
      .innerJoinAndSelect('bed.room', 'room');

    if (normalizedCode) {
      builder.andWhere('patient.patient_code = :patientCode', {
        patientCode: normalizedCode,
      });
    }

    if (patientNameFilter) {
      builder.andWhere('patient.display_name ILIKE :patientName', {
        patientName: `%${patientNameFilter}%`,
      });
    }

    if (query.bedId) {
      builder.andWhere('admission.bed_id = :bedId', { bedId: query.bedId });
    }

    const admissions = await builder
      .orderBy('admission.start_date', 'DESC')
      .getMany();

    const filteredAdmissions = admissions.filter((admission) =>
      this.admissionOverlapsRange(
        admission.startDate,
        admission.endDate,
        query.startDate,
        query.endDate,
        serverToday,
      ),
    );

    if (filteredAdmissions.length === 0) {
      return [];
    }

    const bedIds = [
      ...new Set(filteredAdmissions.map((admission) => admission.bedId)),
    ];
    const { minStartDate, maxEndDate } = getAdmissionDateBounds(
      filteredAdmissions,
      serverToday,
    );
    const allRecords = await this.fetchDailyRecordsForBedsInRange(
      bedIds,
      minStartDate,
      maxEndDate,
    );
    const recordsByBedId = this.groupRecordsByBedId(allRecords);

    return filteredAdmissions.map((admission) => {
      const summary = this.buildAdmissionSummaryFromRecords(
        admission,
        admission.patient.patientCode ?? normalizedCode ?? '',
        admission.patient.displayName ?? patientNameFilter,
        recordsByBedId.get(admission.bedId) ?? [],
      );

      return {
        patientName: admission.patient.displayName ?? patientNameFilter,
        patientCode: admission.patient.patientCode ?? normalizedCode,
        ...summary,
      };
    });
  }

  private applyHistoryPatientRecordFilters(
    builder: ReturnType<typeof this.dailyRecordRepository.createQueryBuilder>,
    query: HistoryQueryDto,
    normalizedCode: string | null,
    patientNameFilter: string | null,
    rangeStart: Date,
    rangeEnd: Date,
  ) {
    builder
      .where('record.business_day_at >= :rangeStart', { rangeStart })
      .andWhere('record.business_day_at < :rangeEnd', { rangeEnd });

    if (query.bedId) {
      builder.andWhere('record.bed_id = :bedId', { bedId: query.bedId });
    }

    if (normalizedCode) {
      builder.andWhere(
        '(record.morning_patient_code = :patientCode OR record.evening_patient_code = :patientCode)',
        { patientCode: normalizedCode },
      );
    }

    if (patientNameFilter) {
      builder.andWhere(
        '(record.morning_patient_name ILIKE :patientName OR record.evening_patient_name ILIKE :patientName)',
        { patientName: `%${patientNameFilter}%` },
      );
    }

    return builder;
  }

  private async findHistoryAdmissionsFromRecords(
    query: HistoryQueryDto,
    serverToday: string,
    normalizedCode: string | null,
    patientNameFilter: string | null,
  ): Promise<IHistoryAdmissionItemDto[]> {
    const rangeStart = businessDayStartUtc(query.startDate);
    const rangeEnd = businessDayEndUtc(query.endDate);
    const matcher = createPatientMatcher(normalizedCode, patientNameFilter);

    if (!matcher) {
      return [];
    }

    const matchingBeds = await this.applyHistoryPatientRecordFilters(
      this.dailyRecordRepository.createQueryBuilder('record'),
      query,
      normalizedCode,
      patientNameFilter,
      rangeStart,
      rangeEnd,
    )
      .select('DISTINCT record.bed_id', 'bedId')
      .getRawMany<{ bedId: Uuid }>();

    const bedIds = matchingBeds.map((row) => row.bedId);

    if (bedIds.length === 0) {
      return [];
    }

    const beds = await this.bedRepository.find({
      where: bedIds.map((bedId) => ({ id: bedId })),
      relations: { room: true },
    });
    const bedById = new Map(beds.map((bed) => [bed.id, bed]));
    const admissionsByBed = await Promise.all(
      bedIds.map(async (bedId) => {
        const bed = bedById.get(bedId);

        if (!bed) {
          return [] as IHistoryAdmissionItemDto[];
        }

        const records = await this.fetchDailyRecordsInRange(
          bedId,
          query.startDate,
          query.endDate,
        );
        const recordsByDate = buildRecordsByDate(records);
        const episodes = findAllEpisodes(recordsByDate, matcher);
        const bedAdmissions: IHistoryAdmissionItemDto[] = [];

        for (const episode of episodes) {
          if (
            !this.admissionOverlapsRange(
              episode.startDate,
              episode.endDate,
              query.startDate,
              query.endDate,
              serverToday,
            )
          ) {
            continue;
          }

          const dailyRows = buildPatientDailyRows(
            recordsByDate,
            episode.startDate,
            episode.endDate,
            { matcher },
          );
          const patientCode =
            normalizedCode ??
            extractPatientCodeFromEpisode(
              recordsByDate,
              episode.startDate,
              episode.endDate,
            ) ??
            null;

          bedAdmissions.push({
            patientName: episode.displayName,
            patientCode,
            bed: {
              bedId: bed.id,
              bedName: bed.name,
              roomName: bed.room.name,
              floor: bed.room.floor,
            },
            startDate: episode.startDate,
            endDate: episode.endDate,
            totalDays: countInclusiveDays(episode.startDate, episode.endDate),
            shiftsWithVitals: countShiftsWithVitals(dailyRows),
            summary: buildSummary(dailyRows),
          });
        }

        return bedAdmissions;
      }),
    );
    const admissions = admissionsByBed.flat();

    admissions.sort((left, right) =>
      right.startDate.localeCompare(left.startDate),
    );

    return admissions;
  }

  private async getHistoryByAdmissions(
    query: HistoryQueryDto,
  ): Promise<IHistoryResponseDto> {
    const limit = Math.min(
      query.limit ?? HISTORY_DEFAULT_LIMIT,
      HISTORY_MAX_LIMIT,
    );
    const offset = query.offset ?? 0;
    const serverToday = getTodayYmdVN();
    const normalizedCode = query.patientCode
      ? normalizePatientCodeField(query.patientCode)
      : null;
    const patientNameFilter = query.patientName?.trim() || null;

    const dbAdmissions = await this.findHistoryAdmissionsFromDb(
      query,
      serverToday,
      normalizedCode,
      patientNameFilter,
    );
    const admissions =
      dbAdmissions.length > 0
        ? dbAdmissions
        : await this.findHistoryAdmissionsFromRecords(
            query,
            serverToday,
            normalizedCode,
            patientNameFilter,
          );

    const total = admissions.length;

    return {
      view: 'admission',
      items: [],
      admissions: admissions.slice(offset, offset + limit),
      total,
      limit,
      offset,
    };
  }

  async getPatientAdmissions(
    query: PatientAdmissionsQueryDto,
  ): Promise<IPatientAdmissionsResponseDto> {
    const patientCode = normalizePatientCodeField(query.patientCode);

    if (!patientCode) {
      throw new BadRequestException('Invalid patient code');
    }

    const patient = await this.patientRepository.findOne({
      where: { patientCode },
    });

    if (patient) {
      const storedResponse = await this.buildStoredPatientAdmissionsResponse(
        patient,
        patientCode,
      );

      if (storedResponse) {
        return storedResponse;
      }
    }

    this.logger.warn(
      `getPatientAdmissions fallback for patientCode=${patientCode}`,
    );

    return this.buildFallbackPatientAdmissionsResponse(patientCode);
  }

  private async buildStoredPatientAdmissionsResponse(
    patient: PatientEntity,
    patientCode: string,
  ): Promise<IPatientAdmissionsResponseDto | null> {
    const admissions = await this.admissionRepository.find({
      where: { patientId: patient.id },
      relations: { bed: { room: true } },
      order: { startDate: 'DESC' },
    });

    if (admissions.length === 0) {
      return null;
    }

    const bedIds = [...new Set(admissions.map((admission) => admission.bedId))];
    const { minStartDate, maxEndDate } = getAdmissionDateBounds(
      admissions,
      admissions[0].endDate ?? admissions[0].startDate,
    );
    const allRecords = await this.fetchDailyRecordsForBedsInRange(
      bedIds,
      minStartDate,
      maxEndDate,
    );
    const recordsByBedId = this.groupRecordsByBedId(allRecords);
    const admissionItems = this.buildAdmissionSummariesBatch(
      admissions,
      patientCode,
      patient.displayName,
      recordsByBedId,
    );

    return {
      patientCode,
      patientName: patient.displayName,
      totalAdmissions: admissionItems.length,
      admissions: admissionItems,
    };
  }

  private async loadFallbackBedAdmissions(
    bed: BedEntity,
    patientCode: string,
    matcher: ReturnType<typeof createCodeMatcher>,
    serverToday: string,
  ): Promise<{
    admissions: IPatientAdmissionsResponseDto['admissions'];
    patientName: string | null;
  }> {
    const bounds = await this.dailyRecordRepository
      .createQueryBuilder('record')
      .select('MIN(record.business_day_at)', 'minDay')
      .addSelect('MAX(record.business_day_at)', 'maxDay')
      .where('record.bed_id = :bedId', { bedId: bed.id })
      .andWhere(
        '(record.morning_patient_code = :patientCode OR record.evening_patient_code = :patientCode)',
        { patientCode },
      )
      .getRawOne<{ minDay: Date | null; maxDay: Date | null }>();

    if (!bounds?.minDay || !bounds.maxDay) {
      return { admissions: [], patientName: null };
    }

    const minYmd = formatBusinessDayYmd(bounds.minDay);
    const maxYmd = formatBusinessDayYmd(bounds.maxDay);
    const windowStart = offsetYmdVN(minYmd, -FALLBACK_EPISODE_WINDOW_DAYS);
    const windowEndRaw = offsetYmdVN(maxYmd, FALLBACK_EPISODE_WINDOW_DAYS);
    const windowEnd = windowEndRaw > serverToday ? serverToday : windowEndRaw;
    const records = await this.fetchDailyRecordsInRange(
      bed.id,
      windowStart,
      windowEnd,
    );
    const recordsByDate = buildRecordsByDate(records);
    const episodes = findAllEpisodes(recordsByDate, matcher);
    const bedAdmissions: IPatientAdmissionsResponseDto['admissions'] = [];
    let bedPatientName: string | null = null;

    for (const episode of episodes) {
      const dailyRows = buildPatientDailyRows(
        recordsByDate,
        episode.startDate,
        episode.endDate,
        { matcher },
      );

      if (!bedPatientName && episode.displayName) {
        bedPatientName = episode.displayName;
      }

      bedAdmissions.push({
        bed: {
          bedId: bed.id,
          bedName: bed.name,
          roomName: bed.room.name,
          floor: bed.room.floor,
        },
        startDate: episode.startDate,
        endDate: episode.endDate,
        totalDays: countInclusiveDays(episode.startDate, episode.endDate),
        shiftsWithVitals: countShiftsWithVitals(dailyRows),
        summary: buildSummary(dailyRows),
      });
    }

    return { admissions: bedAdmissions, patientName: bedPatientName };
  }

  private async buildFallbackPatientAdmissionsResponse(
    patientCode: string,
  ): Promise<IPatientAdmissionsResponseDto> {
    const matchingRecords = await this.dailyRecordRepository
      .createQueryBuilder('record')
      .select('DISTINCT record.bed_id', 'bedId')
      .where(
        '(record.morning_patient_code = :patientCode OR record.evening_patient_code = :patientCode)',
        { patientCode },
      )
      .getRawMany<{ bedId: Uuid }>();

    const bedIds = matchingRecords.map((row) => row.bedId);

    if (bedIds.length === 0) {
      return {
        patientCode,
        patientName: null,
        totalAdmissions: 0,
        admissions: [],
      };
    }

    const beds = await this.bedRepository.find({
      where: bedIds.map((bedId) => ({ id: bedId })),
      relations: { room: true },
    });
    const bedById = new Map(beds.map((bed) => [bed.id, bed]));
    const matcher = createCodeMatcher(patientCode);
    const serverToday = getTodayYmdVN();
    const admissionsByBed = await Promise.all(
      bedIds.map(async (bedId) => {
        const bed = bedById.get(bedId);

        if (!bed) {
          return {
            admissions: [] as IPatientAdmissionsResponseDto['admissions'],
            patientName: null as string | null,
          };
        }

        return this.loadFallbackBedAdmissions(
          bed,
          patientCode,
          matcher,
          serverToday,
        );
      }),
    );
    const admissions = admissionsByBed.flatMap((result) => result.admissions);
    let patientName: string | null = null;

    for (const result of admissionsByBed) {
      if (!patientName && result.patientName) {
        patientName = result.patientName;
      }
    }

    admissions.sort((left, right) =>
      right.startDate.localeCompare(left.startDate),
    );

    return {
      patientCode,
      patientName,
      totalAdmissions: admissions.length,
      admissions,
    };
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
      morningPatientCode: record.morningPatientCode,
      morningPatientAdmissionId: record.morningPatientAdmissionId,
      eveningPatientName: record.eveningPatientName,
      eveningPatientCode: record.eveningPatientCode,
      eveningPatientAdmissionId: record.eveningPatientAdmissionId,
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
