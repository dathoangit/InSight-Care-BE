import { CACHE_MANAGER } from '@nestjs/cache-manager';
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { type Cache } from 'cache-manager';
import { Repository } from 'typeorm';

import { getTodayYmdVN, getYesterdayYmdVN } from '../../common/vietnam-date';
import {
  BEDS_STATUS_TODAY_CACHE_KEY,
  BEDS_STATUS_TODAY_CACHE_TTL_MS,
} from '../../constants/cache-keys';
import { BedEntity } from '../layout/entities/bed.entity';
import { type HistoryQueryDto } from './dto/history-query.dto';
import { type UpsertDailyRecordDto } from './dto/upsert-daily-record.dto';
import { DailyRecordEntity } from './entities/daily-record.entity';

export interface ITodayRecordDto {
  id: Uuid;
  date: string;
  bedId: Uuid;
  morningPatientName: string | null;
  eveningPatientName: string | null;
  morningPulse: number | null;
  morningTemp: number | null;
  morningBp: string | null;
  eveningPulse: number | null;
  eveningTemp: number | null;
  eveningBp: string | null;
  isLocked: boolean;
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

  async getTodayStatus(): Promise<IBedTodayStatusDto[]> {
    const cached = await this.cacheManager.get<IBedTodayStatusDto[]>(
      BEDS_STATUS_TODAY_CACHE_KEY,
    );

    if (cached) {
      return cached;
    }

    const today = getTodayYmdVN();
    const yesterday = getYesterdayYmdVN();
    const beds = await this.bedRepository
      .createQueryBuilder('bed')
      .leftJoinAndSelect('bed.room', 'room')
      .orderBy('room.floor', 'ASC')
      .addOrderBy('room.name', 'ASC')
      .addOrderBy('bed.name', 'ASC')
      .getMany();
    const records = await this.dailyRecordRepository.find({
      where: [{ date: today }, { date: yesterday }],
    });

    const todayByBedId = new Map<Uuid, DailyRecordEntity>();
    const yesterdayPatientByBedId = new Map<Uuid, string>();

    for (const record of records) {
      if (record.date === today) {
        todayByBedId.set(record.bedId, record);
      }

      if (record.date === yesterday) {
        const yesterdayName =
          record.eveningPatientName ?? record.morningPatientName;

        if (yesterdayName) {
          yesterdayPatientByBedId.set(record.bedId, yesterdayName);
        }
      }
    }

    const result = beds.map((bed) => {
      const todayRecord = todayByBedId.get(bed.id);

      return {
        bedId: bed.id,
        roomId: bed.roomId,
        floor: bed.room.floor,
        roomName: bed.room.name,
        bedName: bed.name,
        todayRecord: todayRecord ? this.toTodayRecordDto(todayRecord) : null,
        yesterdayPatientName: yesterdayPatientByBedId.get(bed.id) ?? null,
      };
    });

    await this.cacheManager.set(
      BEDS_STATUS_TODAY_CACHE_KEY,
      result,
      BEDS_STATUS_TODAY_CACHE_TTL_MS,
    );

    return result;
  }

  async upsert(dto: UpsertDailyRecordDto): Promise<ITodayRecordDto> {
    const bed = await this.bedRepository.findOne({ where: { id: dto.bedId } });

    if (!bed) {
      throw new NotFoundException('Bed not found');
    }

    const today = getTodayYmdVN();
    const existing = await this.dailyRecordRepository.findOne({
      where: { bedId: dto.bedId, date: today },
    });

    if (existing?.isLocked) {
      throw new ConflictException('Record is locked for today');
    }

    const record =
      existing ?? this.createDailyRecordForToday(dto.bedId, today, dto);
    this.applyUpsertFields(record, dto);

    const saved = await this.dailyRecordRepository.save(record);
    await this.cacheManager.del(BEDS_STATUS_TODAY_CACHE_KEY);

    return this.toTodayRecordDto(saved);
  }

  private createDailyRecordForToday(
    bedId: Uuid,
    today: string,
    dto: UpsertDailyRecordDto,
  ): DailyRecordEntity {
    return this.dailyRecordRepository.create({
      date: today,
      bedId,
      morningPatientName: dto.morningPatientName ?? null,
      eveningPatientName: dto.eveningPatientName ?? null,
      morningPulse: dto.morningPulse ?? null,
      morningTemp: dto.morningTemp ?? null,
      morningBp: dto.morningBp ?? null,
      eveningPulse: dto.eveningPulse ?? null,
      eveningTemp: dto.eveningTemp ?? null,
      eveningBp: dto.eveningBp ?? null,
      isLocked: false,
    });
  }

  private applyUpsertFields(
    record: DailyRecordEntity,
    dto: UpsertDailyRecordDto,
  ): void {
    const fieldMap: Array<
      [keyof UpsertDailyRecordDto, keyof DailyRecordEntity]
    > = [
      ['morningPatientName', 'morningPatientName'],
      ['eveningPatientName', 'eveningPatientName'],
      ['morningPulse', 'morningPulse'],
      ['morningTemp', 'morningTemp'],
      ['morningBp', 'morningBp'],
      ['eveningPulse', 'eveningPulse'],
      ['eveningTemp', 'eveningTemp'],
      ['eveningBp', 'eveningBp'],
    ];

    for (const [dtoKey, entityKey] of fieldMap) {
      if (dto[dtoKey] !== undefined) {
        record[entityKey] = dto[dtoKey] as never;
      }
    }
  }

  async getHistory(query: HistoryQueryDto): Promise<ITodayRecordDto[]> {
    const qb = this.dailyRecordRepository
      .createQueryBuilder('record')
      .where('record.date BETWEEN :startDate AND :endDate', {
        startDate: query.startDate,
        endDate: query.endDate,
      });

    if (query.bedId) {
      qb.andWhere('record.bed_id = :bedId', { bedId: query.bedId });
    }

    if (query.patientName) {
      qb.andWhere(
        '(record.morning_patient_name ILIKE :name OR record.evening_patient_name ILIKE :name)',
        { name: `%${query.patientName}%` },
      );
    }

    qb.orderBy('record.date', 'ASC').addOrderBy('record.bed_id', 'ASC');

    const records = await qb.getMany();

    return records.map((record) => this.toTodayRecordDto(record));
  }

  async lockTodayRecords(): Promise<void> {
    const today = getTodayYmdVN();

    await this.dailyRecordRepository.update(
      { date: today, isLocked: false },
      { isLocked: true },
    );
    await this.cacheManager.del(BEDS_STATUS_TODAY_CACHE_KEY);
  }

  private toTodayRecordDto(record: DailyRecordEntity): ITodayRecordDto {
    return {
      id: record.id,
      date: record.date,
      bedId: record.bedId,
      morningPatientName: record.morningPatientName,
      eveningPatientName: record.eveningPatientName,
      morningPulse: record.morningPulse,
      morningTemp: record.morningTemp,
      morningBp: record.morningBp,
      eveningPulse: record.eveningPulse,
      eveningTemp: record.eveningTemp,
      eveningBp: record.eveningBp,
      isLocked: record.isLocked,
    };
  }
}
