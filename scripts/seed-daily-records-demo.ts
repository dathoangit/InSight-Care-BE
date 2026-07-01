/**
 * Seed realistic demo daily_records for local testing.
 *
 * - Last 10 VN business days (today + 9 days back)
 * - Each patient episode lasts 3–6 consecutive days (inclusive)
 * - Today: full morning shift; evening empty on ~2/3 of occupied beds
 * - Mix of normal / warning (orange) / critical (red) vitals on today's morning
 * - Clears all existing daily_records before insert
 *
 * Usage:
 *   npm run seed:daily-records
 *   npm run seed:daily-records:clear    # remove all daily_records
 */
import dataSource from '../ormconfig';
import {
  businessDayStartUtc,
  getPreviousYmdVN,
  getTodayYmdVN,
} from '../src/common/vietnam-date';
import { DailyRecordEntity } from '../src/modules/daily-record/entities/daily-record.entity';
import { BedEntity } from '../src/modules/layout/entities/bed.entity';

const SEED_CONFIG = {
  dayCount: 10,
  minEpisodeDays: 3,
  maxEpisodeDays: 6,
  /** Target share of bed-days with a patient (0–1) */
  targetFillRate: 0.88,
} as const;

const DEMO_LAST_NAMES = [
  'Nguyễn',
  'Trần',
  'Lê',
  'Phạm',
  'Hoàng',
  'Vũ',
  'Đặng',
  'Bùi',
  'Đỗ',
  'Hồ',
];

const DEMO_FIRST_NAMES = [
  'Văn An',
  'Thị Bình',
  'Minh Châu',
  'Hữu Dũng',
  'Thị Em',
  'Quốc Huy',
  'Ngọc Lan',
  'Đức Mạnh',
  'Thùy Linh',
  'Xuân Nam',
  'Thị Oanh',
  'Văn Phúc',
  'Thị Quyên',
  'Minh Tuấn',
  'Hồng Vân',
];

type VitalProfile = 'normal' | 'warning' | 'critical';

interface IShiftSeed {
  patientName: string | null;
  pulse: number | null;
  temp: number | null;
  bp: string | null;
  note: string | null;
}

interface IDaySeed {
  offset: number;
  morning: IShiftSeed;
  evening: IShiftSeed;
  isLocked: boolean;
}

type SeededRng = () => number;

const UINT32_MAX = 0x1_00_00_00_00;

function toUint32(value: number): number {
  return ((value % UINT32_MAX) + UINT32_MAX) % UINT32_MAX;
}

function createRng(seed: number): SeededRng {
  let state = toUint32(seed);

  return () => {
    state = toUint32(state * 1_664_525 + 1_013_904_223);

    return state / UINT32_MAX;
  };
}

function offsetToYmd(offset: number): string {
  let date = getTodayYmdVN();

  for (let step = 0; step < Math.abs(offset); step += 1) {
    if (offset < 0) {
      date = getPreviousYmdVN(date);
    }
  }

  if (offset > 0) {
    throw new Error('Future offsets are not supported for demo seed');
  }

  return date;
}

function buildPatientName(bedIndex: number, episodeIndex: number): string {
  const last = DEMO_LAST_NAMES[bedIndex % DEMO_LAST_NAMES.length];
  const first =
    DEMO_FIRST_NAMES[
      (bedIndex * 3 + episodeIndex * 7) % DEMO_FIRST_NAMES.length
    ];

  return `${last} ${first}`;
}

function roundTemp(value: number): number {
  return Math.round(value * 10) / 10;
}

function getVitalProfile(bedIndex: number): VitalProfile {
  const tier = bedIndex % 10;

  if (tier < 2) {
    return 'critical';
  }

  if (tier < 5) {
    return 'warning';
  }

  return 'normal';
}

function buildShiftVitals(
  patientName: string,
  pulse: number,
  temp: number,
  systolic: number,
  diastolic: number,
  note: string | null = null,
): IShiftSeed {
  return {
    patientName,
    pulse: Math.round(pulse),
    temp: roundTemp(temp),
    bp: `${Math.round(systolic)}/${Math.round(diastolic)}`,
    note,
  };
}

function buildProfiledMorningVitals(
  bedIndex: number,
  patientName: string,
  rng: SeededRng,
  isToday: boolean,
): IShiftSeed {
  const profile = getVitalProfile(bedIndex);

  if (!isToday) {
    const basePulse = 72 + Math.floor(rng() * 12);
    const baseTemp = 36.5 + rng() * 0.6;
    const baseSys = 115 + Math.floor(rng() * 10);
    const baseDia = 72 + Math.floor(rng() * 8);

    return buildShiftVitals(patientName, basePulse, baseTemp, baseSys, baseDia);
  }

  switch (profile) {
    case 'critical': {
      return buildShiftVitals(
        patientName,
        128,
        38.5,
        152,
        94,
        'Sốt cao, cần theo dõi sát',
      );
    }

    case 'warning': {
      return buildShiftVitals(patientName, 108, 37.6, 132, 86, 'Đau ngực nhẹ');
    }

    default: {
      const basePulse = 74 + Math.floor(rng() * 10);
      const baseTemp = 36.4 + rng() * 0.5;
      const baseSys = 118 + Math.floor(rng() * 8);
      const baseDia = 74 + Math.floor(rng() * 6);

      return buildShiftVitals(
        patientName,
        basePulse,
        baseTemp,
        baseSys,
        baseDia,
      );
    }
  }
}

function emptyShiftSeed(): IShiftSeed {
  return {
    patientName: null,
    pulse: null,
    temp: null,
    bp: null,
    note: null,
  };
}

function shouldSkipEveningToday(bedIndex: number): boolean {
  // Leave evening empty on ~2/3 of beds (only 1 in 3 gets evening data today).
  return bedIndex % 3 !== 2;
}

function randomEpisodeLength(rng: SeededRng, maxDays: number): number | null {
  if (maxDays < SEED_CONFIG.minEpisodeDays) {
    return null;
  }

  const cappedMax = Math.min(SEED_CONFIG.maxEpisodeDays, maxDays);
  const span = cappedMax - SEED_CONFIG.minEpisodeDays + 1;

  return SEED_CONFIG.minEpisodeDays + Math.floor(rng() * span);
}

function planEpisodeLengths(targetOccupied: number, rng: SeededRng): number[] {
  const lengths: number[] = [];
  let occupied = 0;

  while (occupied + SEED_CONFIG.minEpisodeDays <= targetOccupied) {
    const remaining = targetOccupied - occupied;
    const length = randomEpisodeLength(rng, remaining);

    if (length === null) {
      break;
    }

    lengths.push(length);
    occupied += length;
  }

  if (lengths.length === 0 && targetOccupied >= SEED_CONFIG.minEpisodeDays) {
    lengths.push(
      randomEpisodeLength(rng, targetOccupied) ?? SEED_CONFIG.minEpisodeDays,
    );
  }

  const shortfall = targetOccupied - lengths.reduce((sum, len) => sum + len, 0);

  if (shortfall > 0 && lengths.length > 0) {
    const lastIndex = lengths.length - 1;
    const extended = lengths[lastIndex] + shortfall;

    if (extended <= SEED_CONFIG.maxEpisodeDays) {
      lengths[lastIndex] = extended;
    }
  }

  return lengths;
}

function buildEpisodeRows(
  bedIndex: number,
  episodeIndex: number,
  startOffset: number,
  stayLength: number,
  rng: SeededRng,
): IDaySeed[] {
  const rows: IDaySeed[] = [];
  const patientName = buildPatientName(bedIndex, episodeIndex);

  const basePulse = 68 + Math.floor(rng() * 18);
  const baseTemp = 36.4 + rng() * 1.1;
  const baseSys = 112 + Math.floor(rng() * 18);
  const baseDia = 68 + Math.floor(rng() * 12);
  const recoveryTrend = rng() > 0.35 ? -0.8 : 0.5;

  for (let dayInStay = 0; dayInStay < stayLength; dayInStay += 1) {
    const dayOffset = startOffset + dayInStay;
    const isToday = dayOffset === 0;
    const progress = dayInStay / Math.max(stayLength - 1, 1);
    const dailyWave = Math.sin((bedIndex + dayOffset) * 0.7) * 1.5;
    const pulseShift = recoveryTrend * progress * 4 + dailyWave;
    const tempShift = recoveryTrend * progress * 0.25 + dailyWave * 0.08;
    const sysShift = recoveryTrend * progress * 6 + dailyWave;

    const morningPulse = basePulse + pulseShift;
    const eveningPulse = morningPulse + (rng() > 0.5 ? 2 : -2) + rng() * 2;
    const morningTemp = baseTemp + tempShift;
    const eveningTemp = morningTemp + (rng() > 0.55 ? 0.2 : -0.1);
    const morningSys = baseSys + sysShift;
    const eveningSys = morningSys + (rng() > 0.5 ? 2 : -1);
    const morningDia = baseDia + pulseShift * 0.25;
    const eveningDia = baseDia + (eveningPulse - morningPulse) * 0.2;

    const morning = isToday
      ? buildProfiledMorningVitals(bedIndex, patientName, rng, true)
      : buildShiftVitals(
          patientName,
          morningPulse,
          morningTemp,
          morningSys,
          morningDia,
        );

    const isEveningSkippedToday = isToday && shouldSkipEveningToday(bedIndex);

    rows.push({
      offset: dayOffset,
      morning,
      evening: isEveningSkippedToday
        ? emptyShiftSeed()
        : buildShiftVitals(
            patientName,
            eveningPulse,
            eveningTemp,
            eveningSys,
            eveningDia,
          ),
      isLocked: dayOffset < 0,
    });
  }

  return rows;
}

function generateBedTimeline(bedIndex: number): IDaySeed[] {
  const rng = createRng(10_007 + bedIndex * 7919);
  const targetOccupied = Math.round(
    SEED_CONFIG.dayCount * SEED_CONFIG.targetFillRate,
  );
  const episodeLengths = planEpisodeLengths(targetOccupied, rng);
  const occupiedDays = episodeLengths.reduce((sum, len) => sum + len, 0);
  const totalGapDays = Math.max(0, episodeLengths.length - 1);
  const totalSpan = occupiedDays + totalGapDays;
  const windowStart = -(SEED_CONFIG.dayCount - 1);
  let offset = Math.max(windowStart, -(totalSpan - 1));
  const rows: IDaySeed[] = [];

  for (
    let episodeIndex = 0;
    episodeIndex < episodeLengths.length;
    episodeIndex += 1
  ) {
    const stayLength = episodeLengths[episodeIndex];
    const lastDayOffset = offset + stayLength - 1;

    if (lastDayOffset > 0) {
      break;
    }

    rows.push(
      ...buildEpisodeRows(bedIndex, episodeIndex, offset, stayLength, rng),
    );
    offset += stayLength;

    if (episodeIndex < episodeLengths.length - 1 && offset <= 0) {
      offset += 1;
    }
  }

  return rows;
}

function toEntity(bedId: Uuid, day: IDaySeed): DailyRecordEntity {
  const repo = dataSource.getRepository(DailyRecordEntity);

  return repo.create({
    bedId,
    businessDayAt: businessDayStartUtc(offsetToYmd(day.offset)),
    morningPatientName: day.morning.patientName,
    morningPulse: day.morning.pulse,
    morningTemp: day.morning.temp,
    morningBp: day.morning.bp,
    morningNote: day.morning.note,
    eveningPatientName: day.evening.patientName,
    eveningPulse: day.evening.pulse,
    eveningTemp: day.evening.temp,
    eveningBp: day.evening.bp,
    eveningNote: day.evening.note,
    isLocked: day.isLocked,
  });
}

async function loadAllBeds(): Promise<BedEntity[]> {
  return dataSource
    .getRepository(BedEntity)
    .createQueryBuilder('bed')
    .leftJoinAndSelect('bed.room', 'room')
    .orderBy('room.floor', 'ASC')
    .addOrderBy('room.name', 'ASC')
    .addOrderBy('bed.name', 'ASC')
    .getMany();
}

async function clearAllDailyRecords(): Promise<number> {
  const result = await dataSource
    .getRepository(DailyRecordEntity)
    .createQueryBuilder()
    .delete()
    .execute();

  return result.affected ?? 0;
}

function average(values: number[]): number {
  return values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
}

function summarizeTodayRecords(
  beds: BedEntity[],
  todayRecords: DailyRecordEntity[],
): {
  todayMorningCount: number;
  todayEveningEmptyCount: number;
  todayEveningFilledCount: number;
  criticalMorningToday: number;
  warningMorningToday: number;
} {
  let todayEveningEmptyCount = 0;
  let todayEveningFilledCount = 0;
  let criticalMorningToday = 0;
  let warningMorningToday = 0;

  for (const record of todayRecords) {
    const hasEvening =
      record.eveningPatientName !== null && record.eveningPulse !== null;

    if (hasEvening) {
      todayEveningFilledCount += 1;
    } else if (record.morningPatientName) {
      todayEveningEmptyCount += 1;
    }

    const bedIndex = beds.findIndex((bed) => bed.id === record.bedId);
    const profile = getVitalProfile(bedIndex);

    if (record.morningPatientName && profile === 'critical') {
      criticalMorningToday += 1;
    }

    if (record.morningPatientName && profile === 'warning') {
      warningMorningToday += 1;
    }
  }

  return {
    todayMorningCount: todayRecords.filter(
      (record) => record.morningPatientName,
    ).length,
    todayEveningEmptyCount,
    todayEveningFilledCount,
    criticalMorningToday,
    warningMorningToday,
  };
}

function getRecordPatientName(record: DailyRecordEntity): string | null {
  return (
    record.eveningPatientName?.trim() ||
    record.morningPatientName?.trim() ||
    null
  );
}

function appendRunLength(runLength: number, stayLengths: number[]): void {
  if (runLength > 0) {
    stayLengths.push(runLength);
  }
}

function advanceStayRun(
  name: string | null,
  previousName: string | null,
  runLength: number,
  stayLengths: number[],
): { runLength: number; previousName: string | null } {
  if (name && name === previousName) {
    return { runLength: runLength + 1, previousName };
  }

  appendRunLength(runLength, stayLengths);

  if (name) {
    return { runLength: 1, previousName: name };
  }

  return { runLength: 0, previousName: null };
}

function collectStayLengthsForBed(
  bedRecords: DailyRecordEntity[],
  patients: Set<string>,
): { stayLengths: number[]; longestRun: number } {
  const stayLengths: number[] = [];
  let runLength = 0;
  let previousName: string | null = null;
  let longestRun = 0;

  for (const record of bedRecords) {
    const name = getRecordPatientName(record);

    if (name) {
      patients.add(name);
    }

    const nextRun = advanceStayRun(name, previousName, runLength, stayLengths);
    runLength = nextRun.runLength;
    previousName = nextRun.previousName;
    longestRun = Math.max(longestRun, runLength);
  }

  appendRunLength(runLength, stayLengths);
  longestRun = Math.max(longestRun, runLength);

  return { stayLengths, longestRun };
}

function summarizeFillRate(
  beds: BedEntity[],
  records: DailyRecordEntity[],
): {
  fillRate: number;
  avgStayDays: number;
  primaryEpisodeAvgDays: number;
  minEpisodeDays: number;
  maxEpisodeDays: number;
  todayMorningCount: number;
  todayEveningEmptyCount: number;
  todayEveningFilledCount: number;
  criticalMorningToday: number;
  warningMorningToday: number;
  samplePatients: string[];
} {
  const totalBedDays = beds.length * SEED_CONFIG.dayCount;
  const occupiedBedDays = records.length;
  const fillRate = occupiedBedDays / totalBedDays;

  const stayLengths: number[] = [];
  const primaryEpisodeLengths: number[] = [];
  const patients = new Set<string>();

  const todayStart = businessDayStartUtc(getTodayYmdVN());
  const todayRecords = records.filter(
    (record) => record.businessDayAt.getTime() === todayStart.getTime(),
  );
  const todayStats = summarizeTodayRecords(beds, todayRecords);

  for (const bed of beds) {
    const bedId = bed.id;
    const bedRecords = records
      .filter((record) => record.bedId === bedId)
      .sort((a, b) => a.businessDayAt.getTime() - b.businessDayAt.getTime());
    const { stayLengths: bedStayLengths, longestRun } =
      collectStayLengthsForBed(bedRecords, patients);

    stayLengths.push(...bedStayLengths);

    if (longestRun > 0) {
      primaryEpisodeLengths.push(longestRun);
    }
  }

  return {
    fillRate,
    avgStayDays: average(stayLengths),
    primaryEpisodeAvgDays: average(primaryEpisodeLengths),
    minEpisodeDays: stayLengths.length > 0 ? Math.min(...stayLengths) : 0,
    maxEpisodeDays: stayLengths.length > 0 ? Math.max(...stayLengths) : 0,
    todayMorningCount: todayStats.todayMorningCount,
    todayEveningEmptyCount: todayStats.todayEveningEmptyCount,
    todayEveningFilledCount: todayStats.todayEveningFilledCount,
    criticalMorningToday: todayStats.criticalMorningToday,
    warningMorningToday: todayStats.warningMorningToday,
    samplePatients: [...patients].slice(0, 5),
  };
}

async function seedDailyRecordsDemo(): Promise<void> {
  await dataSource.initialize();

  const shouldClearOnly = process.argv.includes('--clear');
  const beds = await loadAllBeds();

  if (beds.length === 0) {
    throw new Error(
      'No beds in DB. Start the app once to seed hospital layout, then rerun.',
    );
  }

  const startYmd = offsetToYmd(-(SEED_CONFIG.dayCount - 1));
  const endYmd = offsetToYmd(0);
  const clearedAll = await clearAllDailyRecords();

  if (shouldClearOnly) {
    console.info(`Cleared ${clearedAll} daily_records.`);

    return;
  }

  const records = beds.flatMap((bed, bedIndex) =>
    generateBedTimeline(bedIndex).map((day) => toEntity(bed.id, day)),
  );

  await dataSource.getRepository(DailyRecordEntity).save(records);

  const stats = summarizeFillRate(beds, records);

  console.info('Daily records demo seed completed.');
  console.info(
    `Window: ${startYmd} → ${endYmd} (${SEED_CONFIG.dayCount} days VN)`,
  );
  console.info(`Beds: ${beds.length}`);
  console.info(`Cleared all existing rows: ${clearedAll}`);
  console.info(`Inserted daily_records: ${records.length}`);
  console.info(
    `Fill rate: ${(stats.fillRate * 100).toFixed(1)}% (target ${
      SEED_CONFIG.targetFillRate * 100
    }%)`,
  );
  console.info(
    `Episode length: min ${stats.minEpisodeDays}, max ${
      stats.maxEpisodeDays
    }, avg ${stats.avgStayDays.toFixed(1)} (target ${
      SEED_CONFIG.minEpisodeDays
    }–${SEED_CONFIG.maxEpisodeDays})`,
  );
  console.info(
    `Primary episode avg: ${stats.primaryEpisodeAvgDays.toFixed(1)} days`,
  );
  console.info(
    `Today morning filled: ${stats.todayMorningCount}; evening empty: ${stats.todayEveningEmptyCount}, filled: ${stats.todayEveningFilledCount}`,
  );
  console.info(
    `Today morning alerts — critical (red): ${stats.criticalMorningToday}, warning (orange): ${stats.warningMorningToday}`,
  );
  console.info('');
  console.info('Sample patients (click name on vitals table):');

  for (const name of stats.samplePatients) {
    console.info(`  · ${name}`);
  }

  console.info('');
  console.info('Login: admin / 0123456789');
  console.info('Clear demo data: npm run seed:daily-records:clear');
}

try {
  await seedDailyRecordsDemo();
} catch (error) {
  console.error('Failed to seed daily records demo:', error);
  process.exitCode = 1;
} finally {
  if (dataSource.isInitialized) {
    await dataSource.destroy();
  }
}
