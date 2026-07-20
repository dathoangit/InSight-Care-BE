/**
 * Seed patient data end-to-end: patients → patient_admissions → daily_records.
 *
 * Rules:
 * - Clears all daily_records, patient_admissions, and patients before insert
 * - ~50% beds occupied per shift (morning & evening)
 * - Each patient stays 2–5 consecutive days (both shifts)
 * - ~12% patients have 2–3 admissions (same mã NB, different beds, gap 3–6 days)
 * - Remaining patients admitted exactly once
 * - Unique names, every patient has a 10-digit mã NB
 * - History runs from (today - historyDays + 1) through today (VN timezone)
 *
 * Usage:
 *   npm run seed:patients
 *   npm run seed:patients:clear
 */
/* eslint-disable no-await-in-loop -- seed simulation creates patients/admissions day by day */
import { type Repository } from 'typeorm';

import dataSource from '../ormconfig';
import {
  businessDayStartUtc,
  getPreviousYmdVN,
  getTodayYmdVN,
} from '../src/common/vietnam-date';
import { DailyRecordEntity } from '../src/modules/daily-record/entities/daily-record.entity';
import { PatientEntity } from '../src/modules/daily-record/entities/patient.entity';
import {
  PatientAdmissionSource,
  PatientAdmissionStatus,
  PatientIdentityType,
} from '../src/modules/daily-record/entities/patient.enums';
import { PatientAdmissionEntity } from '../src/modules/daily-record/entities/patient-admission.entity';
import { BedEntity } from '../src/modules/layout/entities/bed.entity';
import { sortBedsByLayout } from '../src/modules/layout/utils/sort-beds-by-layout';

const SEED_CONFIG = {
  historyDays: 90,
  targetShiftFillRate: 0.5,
  minStayDays: 2,
  maxStayDays: 5,
  readmissionCohortSize: 48,
  minAdmissionsPerReadmitPatient: 2,
  maxAdmissionsPerReadmitPatient: 3,
  minGapDays: 3,
  maxGapDays: 6,
  readmissionPickRate: 0.38,
  rngSeed: 52_026,
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
  'Dương',
  'Võ',
  'Lý',
  'Đinh',
  'Mai',
];

const DEMO_MIDDLE_NAMES = [
  'Văn',
  'Thị',
  'Minh',
  'Hữu',
  'Quốc',
  'Ngọc',
  'Đức',
  'Thùy',
  'Xuân',
  'Hồng',
  'Anh',
  'Thanh',
];

const DEMO_FIRST_NAMES = [
  'An',
  'Bình',
  'Châu',
  'Dũng',
  'Em',
  'Huy',
  'Lan',
  'Mạnh',
  'Linh',
  'Nam',
  'Oanh',
  'Phúc',
  'Quyên',
  'Tuấn',
  'Vân',
  'Hà',
  'Khánh',
  'Long',
  'Mai',
  'Nhung',
  'Phong',
  'Quân',
  'Sơn',
  'Trang',
  'Uyên',
  'Giang',
  'Hiếu',
  'Kiên',
  'Loan',
  'Minh',
];

interface IPatientTemplate {
  name: string;
  code: string;
}

interface IShiftVitals {
  pulse: number;
  temp: number;
  bp: string;
  note: string | null;
}

interface IActiveStay {
  patient: PatientEntity;
  admission: PatientAdmissionEntity;
  daysLeft: number;
  bedIndex: number;
}

interface IPatientRuntime {
  entity: PatientEntity;
  template: IPatientTemplate;
  admissionCount: number;
  targetAdmissions: number;
  lastDischargedDayIndex: number | null;
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

function buildYmdRange(endYmd: string, dayCount: number): string[] {
  const dates: string[] = [];
  let cursor = endYmd;

  for (let index = 0; index < dayCount; index += 1) {
    dates.unshift(cursor);
    cursor = getPreviousYmdVN(cursor);
  }

  return dates;
}

function buildPatientCatalog(count: number): IPatientTemplate[] {
  const usedNames = new Set<string>();
  const patients: IPatientTemplate[] = [];
  let attempt = 0;

  while (patients.length < count) {
    const last = DEMO_LAST_NAMES[attempt % DEMO_LAST_NAMES.length];
    const middle =
      DEMO_MIDDLE_NAMES[
        Math.floor(attempt / DEMO_LAST_NAMES.length) % DEMO_MIDDLE_NAMES.length
      ];
    const first =
      DEMO_FIRST_NAMES[
        (attempt * 7 + patients.length * 11) % DEMO_FIRST_NAMES.length
      ];
    const name = `${last} ${middle} ${first}`;

    if (!usedNames.has(name)) {
      usedNames.add(name);
      patients.push({
        name,
        code: String(1_000_000_001 + patients.length),
      });
    }

    attempt += 1;
  }

  return patients;
}

function shuffleInPlace<T>(items: T[], rng: SeededRng): void {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }
}

function randomStayDays(rng: SeededRng): number {
  const span = SEED_CONFIG.maxStayDays - SEED_CONFIG.minStayDays + 1;

  return SEED_CONFIG.minStayDays + Math.floor(rng() * span);
}

function randomTargetAdmissions(templateIndex: number, rng: SeededRng): number {
  if (templateIndex >= SEED_CONFIG.readmissionCohortSize) {
    return 1;
  }

  const span =
    SEED_CONFIG.maxAdmissionsPerReadmitPatient -
    SEED_CONFIG.minAdmissionsPerReadmitPatient +
    1;

  return SEED_CONFIG.minAdmissionsPerReadmitPatient + Math.floor(rng() * span);
}

function pickPatientForNewStay(
  dayIndex: number,
  patientRuntimes: IPatientRuntime[],
  nextTemplateIndex: number,
  patientTemplates: IPatientTemplate[],
  rng: SeededRng,
): {
  runtime: IPatientRuntime | null;
  template: IPatientTemplate | null;
  templateIndex: number;
} {
  const eligible = patientRuntimes.filter((runtime) => {
    if (runtime.admissionCount >= runtime.targetAdmissions) {
      return false;
    }

    if (runtime.lastDischargedDayIndex === null) {
      return false;
    }

    const earliestDayIndex =
      runtime.lastDischargedDayIndex + SEED_CONFIG.minGapDays + 1;

    return dayIndex >= earliestDayIndex;
  });

  shuffleInPlace(eligible, rng);

  const hasUnfilledReadmissions = patientRuntimes.some(
    (runtime) =>
      runtime.targetAdmissions > 1 &&
      runtime.admissionCount < runtime.targetAdmissions,
  );
  const underfilledReadmit = eligible.filter(
    (runtime) =>
      runtime.targetAdmissions > 1 &&
      runtime.admissionCount < SEED_CONFIG.minAdmissionsPerReadmitPatient,
  );

  const shouldPreferReadmission =
    underfilledReadmit.length > 0 ||
    (hasUnfilledReadmissions && rng() < SEED_CONFIG.readmissionPickRate);

  if (eligible.length > 0 && shouldPreferReadmission) {
    const runtime =
      underfilledReadmit.length > 0
        ? underfilledReadmit[0]
        : eligible.find((item) => item.targetAdmissions > 1) ?? eligible[0];

    return {
      runtime,
      template: null,
      templateIndex: nextTemplateIndex,
    };
  }

  if (nextTemplateIndex < patientTemplates.length) {
    return {
      runtime: null,
      template: patientTemplates[nextTemplateIndex],
      templateIndex: nextTemplateIndex + 1,
    };
  }

  if (eligible.length > 0) {
    return {
      runtime: eligible[0],
      template: null,
      templateIndex: nextTemplateIndex,
    };
  }

  return { runtime: null, template: null, templateIndex: nextTemplateIndex };
}

function roundTemp(value: number): number {
  return Math.round(value * 10) / 10;
}

function buildShiftVitals(
  bedIndex: number,
  dayIndex: number,
  shift: 'morning' | 'evening',
  rng: SeededRng,
): IShiftVitals {
  const wave = Math.sin(
    (bedIndex + dayIndex) * 0.65 + (shift === 'evening' ? 1.2 : 0),
  );
  const pulse = Math.round(72 + wave * 4 + rng() * 10);
  const temp = roundTemp(36.5 + wave * 0.15 + rng() * 0.5);
  const systolic = Math.round(118 + wave * 5 + rng() * 8);
  const diastolic = Math.round(74 + wave * 2 + rng() * 6);

  return {
    pulse,
    temp,
    bp: `${systolic}/${diastolic}`,
    note: null,
  };
}

function estimatePatientCount(bedCount: number, dayCount: number): number {
  const avgStayDays = (SEED_CONFIG.minStayDays + SEED_CONFIG.maxStayDays) / 2;
  const occupiedBedDays =
    dayCount * bedCount * SEED_CONFIG.targetShiftFillRate * 2;
  const admissionsNeeded = occupiedBedDays / (avgStayDays * 2);
  const avgAdmissionsPerReadmitPatient =
    (SEED_CONFIG.minAdmissionsPerReadmitPatient +
      SEED_CONFIG.maxAdmissionsPerReadmitPatient) /
    2;
  const extraAdmissionsFromReadmit =
    SEED_CONFIG.readmissionCohortSize * (avgAdmissionsPerReadmitPatient - 1);

  return (
    Math.ceil(admissionsNeeded - extraAdmissionsFromReadmit * 0.85) + bedCount
  );
}

async function loadAllBeds(): Promise<BedEntity[]> {
  return sortBedsByLayout(
    await dataSource
      .getRepository(BedEntity)
      .createQueryBuilder('bed')
      .leftJoinAndSelect('bed.room', 'room')
      .getMany(),
  );
}

async function clearPatientData(): Promise<{
  dailyRecords: number;
  admissions: number;
  patients: number;
}> {
  const dailyResult = await dataSource
    .getRepository(DailyRecordEntity)
    .createQueryBuilder()
    .delete()
    .execute();
  const admissionResult = await dataSource
    .getRepository(PatientAdmissionEntity)
    .createQueryBuilder()
    .delete()
    .execute();
  const patientResult = await dataSource
    .getRepository(PatientEntity)
    .createQueryBuilder()
    .delete()
    .execute();

  return {
    dailyRecords: dailyResult.affected ?? 0,
    admissions: admissionResult.affected ?? 0,
    patients: patientResult.affected ?? 0,
  };
}

async function summarizeSeed(
  bedCount: number,
  shiftFillStats: Array<{ morning: number; evening: number }>,
): Promise<{
  patientCount: number;
  admissionCount: number;
  avgMorningFill: number;
  avgEveningFill: number;
  minStayDays: number;
  maxStayDays: number;
  avgStayDays: number;
  multiAdmissionPatients: number;
  activeAdmissions: number;
  uniqueNames: number;
  uniqueCodes: number;
  samplePatients: Array<{ name: string; code: string }>;
  sampleReadmissions: Array<{
    name: string;
    code: string;
    admissions: number;
  }>;
}> {
  const patientRepo = dataSource.getRepository(PatientEntity);
  const admissionRepo = dataSource.getRepository(PatientAdmissionEntity);

  const patients = await patientRepo.find();
  const admissions = await admissionRepo.find({ relations: { patient: true } });

  const admissionsByPatient = new Map<string, number>();

  for (const admission of admissions) {
    admissionsByPatient.set(
      admission.patientId,
      (admissionsByPatient.get(admission.patientId) ?? 0) + 1,
    );
  }

  const stayLengths = admissions
    .filter(
      (admission) => admission.status === PatientAdmissionStatus.DISCHARGED,
    )
    .map((admission) => {
      const start = admission.startDate;
      const end = admission.endDate ?? admission.startDate;
      const [sy, sm, sd] = start.split('-').map(Number);
      const [ey, em, ed] = end.split('-').map(Number);
      const startUtc = Date.UTC(sy, sm - 1, sd);
      const endUtc = Date.UTC(ey, em - 1, ed);

      return Math.round((endUtc - startUtc) / 86_400_000) + 1;
    });

  const avgMorningFill =
    shiftFillStats.reduce((sum, row) => sum + row.morning, 0) /
    (shiftFillStats.length * bedCount);
  const avgEveningFill =
    shiftFillStats.reduce((sum, row) => sum + row.evening, 0) /
    (shiftFillStats.length * bedCount);

  const names = new Set(
    patients.map((patient) => patient.displayName).filter(Boolean),
  );
  const codes = new Set(
    patients.map((patient) => patient.patientCode).filter(Boolean),
  );

  const admissionsByPatientId = new Map<
    string,
    { name: string; code: string; count: number }
  >();

  for (const admission of admissions) {
    const existing = admissionsByPatientId.get(admission.patientId);
    const name = admission.patient.displayName ?? '';
    const code = admission.patient.patientCode ?? '';

    if (existing) {
      existing.count += 1;
    } else {
      admissionsByPatientId.set(admission.patientId, {
        name,
        code,
        count: 1,
      });
    }
  }

  const sampleReadmissions = [...admissionsByPatientId.values()]
    .filter((entry) => entry.count >= 2)
    .sort((left, right) => right.count - left.count)
    .slice(0, 5)
    .map((entry) => ({
      name: entry.name,
      code: entry.code,
      admissions: entry.count,
    }));

  return {
    patientCount: patients.length,
    admissionCount: admissions.length,
    avgMorningFill,
    avgEveningFill,
    minStayDays: stayLengths.length > 0 ? Math.min(...stayLengths) : 0,
    maxStayDays: stayLengths.length > 0 ? Math.max(...stayLengths) : 0,
    avgStayDays:
      stayLengths.length > 0
        ? stayLengths.reduce((sum, value) => sum + value, 0) /
          stayLengths.length
        : 0,
    multiAdmissionPatients: [...admissionsByPatient.values()].filter(
      (count) => count > 1,
    ).length,
    activeAdmissions: admissions.filter(
      (admission) => admission.status === PatientAdmissionStatus.ACTIVE,
    ).length,
    uniqueNames: names.size,
    uniqueCodes: codes.size,
    samplePatients: patients.slice(0, 5).map((patient) => ({
      name: patient.displayName ?? '',
      code: patient.patientCode ?? '',
    })),
    sampleReadmissions,
  };
}

interface ISeedDayContext {
  beds: BedEntity[];
  bedStates: Array<IActiveStay | null>;
  patientRuntimes: IPatientRuntime[];
  patientTemplates: IPatientTemplate[];
  patientRepo: Repository<PatientEntity>;
  admissionRepo: Repository<PatientAdmissionEntity>;
  recordRepo: Repository<DailyRecordEntity>;
  recordsToSave: DailyRecordEntity[];
  admissionsToUpdate: Set<PatientAdmissionEntity>;
  shiftFillStats: Array<{ morning: number; evening: number }>;
  rng: SeededRng;
  todayYmd: string;
}

async function assignNewStaysForDay(
  dayIndex: number,
  ymd: string,
  context: ISeedDayContext,
  nextTemplateIndex: number,
  emptyBedIndices: number[],
  needNewStays: number,
): Promise<number> {
  for (
    let slot = 0;
    slot < needNewStays && slot < emptyBedIndices.length;
    slot += 1
  ) {
    const picked = pickPatientForNewStay(
      dayIndex,
      context.patientRuntimes,
      nextTemplateIndex,
      context.patientTemplates,
      context.rng,
    );

    if (!picked.runtime && !picked.template) {
      break;
    }

    nextTemplateIndex = picked.templateIndex;
    const bedIndex = emptyBedIndices[slot];
    let patient: PatientEntity;
    let runtime: IPatientRuntime;

    if (picked.runtime) {
      runtime = picked.runtime;
      patient = runtime.entity;
      runtime.admissionCount += 1;
    } else {
      const template = picked.template as IPatientTemplate;
      patient = await context.patientRepo.save(
        context.patientRepo.create({
          patientCode: template.code,
          displayName: template.name,
          identityType: PatientIdentityType.CODE,
        }),
      );
      runtime = {
        entity: patient,
        template,
        admissionCount: 1,
        targetAdmissions: randomTargetAdmissions(
          nextTemplateIndex - 1,
          context.rng,
        ),
        lastDischargedDayIndex: null,
      };
      context.patientRuntimes.push(runtime);
    }

    const admission = await context.admissionRepo.save(
      context.admissionRepo.create({
        patientId: patient.id,
        bedId: context.beds[bedIndex].id,
        startDate: ymd,
        endDate: ymd,
        status: PatientAdmissionStatus.ACTIVE,
        source: PatientAdmissionSource.WITH_CODE,
      }),
    );

    context.bedStates[bedIndex] = {
      patient,
      admission,
      daysLeft: randomStayDays(context.rng),
      bedIndex,
    };
  }

  return nextTemplateIndex;
}

function writeDailyRecordsForDay(
  dayIndex: number,
  ymd: string,
  context: ISeedDayContext,
  isToday: boolean,
): { morning: number; evening: number } {
  let morningCount = 0;
  let eveningCount = 0;

  for (const [bedIndex, bed] of context.beds.entries()) {
    const stay = context.bedStates[bedIndex];

    if (!stay) {
      continue;
    }

    morningCount += 1;
    eveningCount += 1;

    stay.admission.endDate = ymd;
    context.admissionsToUpdate.add(stay.admission);

    const morningVitals = buildShiftVitals(
      bedIndex,
      dayIndex,
      'morning',
      context.rng,
    );
    const eveningVitals = buildShiftVitals(
      bedIndex,
      dayIndex,
      'evening',
      context.rng,
    );

    context.recordsToSave.push(
      context.recordRepo.create({
        bedId: bed.id,
        businessDayAt: businessDayStartUtc(ymd),
        morningPatientName: stay.patient.displayName,
        morningPatientCode: stay.patient.patientCode,
        morningPatientAdmissionId: stay.admission.id,
        morningPulse: morningVitals.pulse,
        morningTemp: morningVitals.temp,
        morningBp: morningVitals.bp,
        morningNote: morningVitals.note,
        eveningPatientName: stay.patient.displayName,
        eveningPatientCode: stay.patient.patientCode,
        eveningPatientAdmissionId: stay.admission.id,
        eveningPulse: eveningVitals.pulse,
        eveningTemp: eveningVitals.temp,
        eveningBp: eveningVitals.bp,
        eveningNote: eveningVitals.note,
        isLocked: !isToday,
      }),
    );
  }

  return { morning: morningCount, evening: eveningCount };
}

function dischargeCompletedStays(
  dayIndex: number,
  ymd: string,
  context: ISeedDayContext,
): void {
  for (let bedIndex = 0; bedIndex < context.beds.length; bedIndex += 1) {
    const stay = context.bedStates[bedIndex];

    if (!stay) {
      continue;
    }

    stay.daysLeft -= 1;

    if (stay.daysLeft <= 0) {
      stay.admission.endDate = ymd;
      stay.admission.status = PatientAdmissionStatus.DISCHARGED;
      context.admissionsToUpdate.add(stay.admission);

      const runtime = context.patientRuntimes.find(
        (item) => item.entity.id === stay.patient.id,
      );

      if (runtime) {
        runtime.lastDischargedDayIndex = dayIndex;
      }

      context.bedStates[bedIndex] = null;
    }
  }
}

async function seedDay(
  dayIndex: number,
  ymd: string,
  context: ISeedDayContext,
  nextTemplateIndex: number,
): Promise<number> {
  const isToday = ymd === context.todayYmd;
  const targetOccupied = Math.round(
    context.beds.length * SEED_CONFIG.targetShiftFillRate,
  );

  const continuingBedIndices = context.bedStates
    .map((state, bedIndex) => (state ? bedIndex : -1))
    .filter((bedIndex) => bedIndex >= 0);
  const emptyBedIndices = context.bedStates
    .map((state, bedIndex) => (state ? -1 : bedIndex))
    .filter((bedIndex) => bedIndex >= 0);

  const needNewStays = Math.max(
    0,
    targetOccupied - continuingBedIndices.length,
  );
  shuffleInPlace(emptyBedIndices, context.rng);

  nextTemplateIndex = await assignNewStaysForDay(
    dayIndex,
    ymd,
    context,
    nextTemplateIndex,
    emptyBedIndices,
    needNewStays,
  );

  const shiftFill = writeDailyRecordsForDay(dayIndex, ymd, context, isToday);
  context.shiftFillStats.push(shiftFill);
  dischargeCompletedStays(dayIndex, ymd, context);

  return nextTemplateIndex;
}

async function seedPatientData(): Promise<void> {
  await dataSource.initialize();

  const shouldClearOnly = process.argv.includes('--clear');
  const beds = await loadAllBeds();

  if (beds.length === 0) {
    throw new Error(
      'No beds in DB. Start the app once to seed hospital layout, then rerun.',
    );
  }

  const todayYmd = getTodayYmdVN();
  const dateRange = buildYmdRange(todayYmd, SEED_CONFIG.historyDays);
  const cleared = await clearPatientData();

  if (shouldClearOnly) {
    console.info(
      `Cleared ${cleared.dailyRecords} daily_records, ${cleared.admissions} patient_admissions, ${cleared.patients} patients.`,
    );

    return;
  }

  const rng = createRng(SEED_CONFIG.rngSeed);
  const patientTemplates = buildPatientCatalog(
    estimatePatientCount(beds.length, dateRange.length),
  );
  const patientRepo = dataSource.getRepository(PatientEntity);
  const admissionRepo = dataSource.getRepository(PatientAdmissionEntity);
  const recordRepo = dataSource.getRepository(DailyRecordEntity);

  const bedStates: Array<IActiveStay | null> = Array.from(
    { length: beds.length },
    () => null,
  );
  const patientRuntimes: IPatientRuntime[] = [];
  let nextTemplateIndex = 0;

  const recordsToSave: DailyRecordEntity[] = [];
  const admissionsToUpdate = new Set<PatientAdmissionEntity>();
  const shiftFillStats: Array<{ morning: number; evening: number }> = [];
  const dayContext: ISeedDayContext = {
    beds,
    bedStates,
    patientRuntimes,
    patientTemplates,
    patientRepo,
    admissionRepo,
    recordRepo,
    recordsToSave,
    admissionsToUpdate,
    shiftFillStats,
    rng,
    todayYmd,
  };

  for (const [dayIndex, ymd] of dateRange.entries()) {
    nextTemplateIndex = await seedDay(
      dayIndex,
      ymd,
      dayContext,
      nextTemplateIndex,
    );
  }

  const activeAdmissions = bedStates.filter(Boolean) as IActiveStay[];

  for (const stay of activeAdmissions) {
    stay.admission.status = PatientAdmissionStatus.ACTIVE;
    stay.admission.endDate = todayYmd;
    admissionsToUpdate.add(stay.admission);
  }

  await admissionRepo.save([...admissionsToUpdate]);
  await recordRepo.save(recordsToSave, { chunk: 200 });

  const stats = await summarizeSeed(beds.length, shiftFillStats);

  console.info('Patient data seed completed.');
  console.info(
    `Window: ${dateRange[0]} → ${todayYmd} (${dateRange.length} days VN)`,
  );
  console.info(`Beds: ${beds.length}`);
  console.info(
    `Cleared: ${cleared.dailyRecords} daily_records, ${cleared.admissions} admissions, ${cleared.patients} patients`,
  );
  console.info(`Inserted patients: ${stats.patientCount}`);
  console.info(`Inserted admissions: ${stats.admissionCount}`);
  console.info(`Inserted daily_records: ${recordsToSave.length}`);
  console.info(
    `Avg shift fill — morning: ${(stats.avgMorningFill * 100).toFixed(
      1,
    )}%, evening: ${(stats.avgEveningFill * 100).toFixed(1)}% (target ${
      SEED_CONFIG.targetShiftFillRate * 100
    }%)`,
  );
  console.info(
    `Stay length (discharged): min ${stats.minStayDays}, max ${
      stats.maxStayDays
    }, avg ${stats.avgStayDays.toFixed(1)}`,
  );
  console.info(`Active admissions today: ${stats.activeAdmissions}`);
  console.info(
    `Patients with ≥2 admissions: ${stats.multiAdmissionPatients} (readmission cohort ${SEED_CONFIG.readmissionCohortSize})`,
  );
  console.info(
    `Unique names: ${stats.uniqueNames}, unique codes: ${stats.uniqueCodes}`,
  );
  console.info('');
  console.info('Sample patients:');

  for (const sample of stats.samplePatients) {
    console.info(`  · ${sample.name} — ${sample.code}`);
  }

  if (stats.sampleReadmissions.length > 0) {
    console.info('');
    console.info('Sample readmissions (same mã NB, multiple stays):');

    for (const sample of stats.sampleReadmissions) {
      console.info(
        `  · ${sample.name} — ${sample.code} (${sample.admissions} lần nằm)`,
      );
    }
  }

  console.info('');
  console.info('Clear all patient data: npm run seed:patients:clear');
}

try {
  await seedPatientData();
} catch (error) {
  console.error('Failed to seed patient data:', error);
  process.exitCode = 1;
} finally {
  if (dataSource.isInitialized) {
    await dataSource.destroy();
  }
}
