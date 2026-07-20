/**
 * Backfill patients + patient_admissions from existing daily_records.
 *
 * Idempotent: skips records that already have admission IDs for occupied shifts.
 *
 * Usage:
 *   npx tsx scripts/backfill-patient-admissions.ts
 *   npx tsx scripts/backfill-patient-admissions.ts --dry-run
 */
/* eslint-disable no-await-in-loop -- admission continuity requires ordered writes per bed */
import { type Repository } from 'typeorm';

import dataSource from '../ormconfig';
import { formatBusinessDayYmd, getNextYmdVN } from '../src/common/vietnam-date';
import {
  PatientAdmissionSource,
  PatientAdmissionStatus,
  PatientIdentityType,
} from '../src/constants';
import { DailyRecordEntity } from '../src/modules/daily-record/entities/daily-record.entity';
import { PatientEntity } from '../src/modules/daily-record/entities/patient.entity';
import { PatientAdmissionEntity } from '../src/modules/daily-record/entities/patient-admission.entity';
import {
  buildRecordsByDate,
  createCodeMatcher,
  createNameMatcher,
  findAllEpisodes,
  normalizePatientCodeField,
} from '../src/modules/daily-record/patient-episode.utils';

type Shift = 'morning' | 'evening';

interface IShiftPatient {
  name: string | null;
  code: string | null;
}

interface IBackfillCounters {
  createdPatients: number;
  createdAdmissions: number;
  linkedShifts: number;
}

interface IBackfillRepos {
  recordRepo: Repository<DailyRecordEntity>;
  patientRepo: Repository<PatientEntity>;
  admissionRepo: Repository<PatientAdmissionEntity>;
}

interface IBackfillBedState {
  bedId: string;
  records: DailyRecordEntity[];
  recordsByDate: Map<string, DailyRecordEntity>;
  processedCodePatients: Map<string, PatientEntity>;
  activeCodeAdmissions: Map<string, PatientAdmissionEntity>;
}

function getShiftPatient(
  record: DailyRecordEntity,
  shift: Shift,
): IShiftPatient {
  if (shift === 'morning') {
    return {
      name: record.morningPatientName?.trim() || null,
      code: normalizePatientCodeField(record.morningPatientCode),
    };
  }

  return {
    name: record.eveningPatientName?.trim() || null,
    code: normalizePatientCodeField(record.eveningPatientCode),
  };
}

function shiftHasPatient(patient: IShiftPatient): boolean {
  return Boolean(patient.name || patient.code);
}

function isContinuousDate(left: string, right: string): boolean {
  return left === right || getNextYmdVN(left) === right;
}

function admissionStatusForEndDate(endDate: string): PatientAdmissionStatus {
  return endDate < formatBusinessDayYmd(new Date())
    ? PatientAdmissionStatus.DISCHARGED
    : PatientAdmissionStatus.ACTIVE;
}

function collectPatientCodes(records: DailyRecordEntity[]): Set<string> {
  const codes = new Set<string>();

  for (const record of records) {
    for (const shift of ['morning', 'evening'] as const) {
      const code = getShiftPatient(record, shift).code;

      if (code) {
        codes.add(code);
      }
    }
  }

  return codes;
}

async function ensureCodePatient(
  repos: IBackfillRepos,
  processedCodePatients: Map<string, PatientEntity>,
  counters: IBackfillCounters,
  code: string,
  displayName: string | null,
  isDryRun: boolean,
): Promise<PatientEntity> {
  const cached = processedCodePatients.get(code);

  if (cached) {
    return cached;
  }

  let patientEntity =
    (await repos.patientRepo.findOne({ where: { patientCode: code } })) ??
    repos.patientRepo.create({
      patientCode: code,
      displayName,
      identityType: PatientIdentityType.CODE,
    });

  if (!patientEntity.id) {
    if (!isDryRun) {
      patientEntity = await repos.patientRepo.save(patientEntity);
    }

    counters.createdPatients += 1;
  } else if (displayName && patientEntity.displayName !== displayName) {
    patientEntity.displayName = displayName;

    if (!isDryRun) {
      patientEntity = await repos.patientRepo.save(patientEntity);
    }
  }

  processedCodePatients.set(code, patientEntity);

  return patientEntity;
}

async function resolveCodeShiftAdmission(
  repos: IBackfillRepos,
  state: IBackfillBedState,
  counters: IBackfillCounters,
  patient: IShiftPatient,
  dateYmd: string,
  patientEntity: PatientEntity,
  isDryRun: boolean,
): Promise<PatientAdmissionEntity | null> {
  const activeKey = `${patient.code}:${state.bedId}`;
  const activeAdmission = state.activeCodeAdmissions.get(activeKey);

  if (
    activeAdmission &&
    isContinuousDate(
      activeAdmission.endDate ?? activeAdmission.startDate,
      dateYmd,
    )
  ) {
    activeAdmission.endDate = dateYmd;

    if (isDryRun) {
      return activeAdmission;
    }

    return repos.admissionRepo.save(activeAdmission);
  }

  if (activeAdmission) {
    activeAdmission.status = PatientAdmissionStatus.DISCHARGED;

    if (!isDryRun) {
      await repos.admissionRepo.save(activeAdmission);
    }
  }

  let admission = repos.admissionRepo.create({
    patientId: patientEntity.id,
    bedId: state.bedId,
    startDate: dateYmd,
    endDate: dateYmd,
    status: PatientAdmissionStatus.ACTIVE,
    source: PatientAdmissionSource.WITH_CODE,
    medicalRecordCode: null,
  });

  if (!isDryRun) {
    admission = await repos.admissionRepo.save(admission);
  }

  counters.createdAdmissions += 1;
  state.activeCodeAdmissions.set(activeKey, admission);

  return admission;
}

async function resolveNameShiftAdmission(
  repos: IBackfillRepos,
  state: IBackfillBedState,
  counters: IBackfillCounters,
  patient: IShiftPatient,
  dateYmd: string,
  isDryRun: boolean,
): Promise<PatientAdmissionEntity | null> {
  const matcher = createNameMatcher(patient.name as string);
  const episodes = findAllEpisodes(state.recordsByDate, matcher);
  const episode = episodes.find(
    (item) => dateYmd >= item.startDate && dateYmd <= item.endDate,
  );

  if (episode) {
    const existingAdmission = await repos.admissionRepo
      .createQueryBuilder('admission')
      .innerJoin('admission.patient', 'patient')
      .where('admission.bed_id = :bedId', { bedId: state.bedId })
      .andWhere('admission.source = :source', {
        source: PatientAdmissionSource.NO_CODE,
      })
      .andWhere('patient.identity_type = :identityType', {
        identityType: PatientIdentityType.NO_CODE,
      })
      .andWhere('admission.start_date = :startDate', {
        startDate: episode.startDate,
      })
      .andWhere(
        '(admission.end_date = :endDate OR admission.end_date IS NULL)',
        { endDate: episode.endDate },
      )
      .getOne();

    if (existingAdmission) {
      return existingAdmission;
    }

    const patientEntity = repos.patientRepo.create({
      patientCode: null,
      displayName: episode.displayName || patient.name,
      identityType: PatientIdentityType.NO_CODE,
    });

    if (isDryRun) {
      counters.createdPatients += 1;
      counters.createdAdmissions += 1;

      return repos.admissionRepo.create({
        patientId: patientEntity.id,
        bedId: state.bedId,
        startDate: episode.startDate,
        endDate: episode.endDate,
        status: admissionStatusForEndDate(episode.endDate),
        source: PatientAdmissionSource.NO_CODE,
      });
    }

    const savedPatient = await repos.patientRepo.save(patientEntity);
    const admission = await repos.admissionRepo.save(
      repos.admissionRepo.create({
        patientId: savedPatient.id,
        bedId: state.bedId,
        startDate: episode.startDate,
        endDate: episode.endDate,
        status: admissionStatusForEndDate(episode.endDate),
        source: PatientAdmissionSource.NO_CODE,
      }),
    );

    counters.createdPatients += 1;
    counters.createdAdmissions += 1;

    return admission;
  }

  const patientEntity = repos.patientRepo.create({
    patientCode: null,
    displayName: patient.name,
    identityType: PatientIdentityType.NO_CODE,
  });

  if (isDryRun) {
    counters.createdPatients += 1;
    counters.createdAdmissions += 1;

    return repos.admissionRepo.create({
      patientId: patientEntity.id,
      bedId: state.bedId,
      startDate: dateYmd,
      endDate: dateYmd,
      status: PatientAdmissionStatus.ACTIVE,
      source: PatientAdmissionSource.NO_CODE,
    });
  }

  const savedPatient = await repos.patientRepo.save(patientEntity);
  const admission = await repos.admissionRepo.save(
    repos.admissionRepo.create({
      patientId: savedPatient.id,
      bedId: state.bedId,
      startDate: dateYmd,
      endDate: dateYmd,
      status: PatientAdmissionStatus.ACTIVE,
      source: PatientAdmissionSource.NO_CODE,
    }),
  );

  counters.createdPatients += 1;
  counters.createdAdmissions += 1;

  return admission;
}

async function resolveShiftAdmission(
  repos: IBackfillRepos,
  state: IBackfillBedState,
  counters: IBackfillCounters,
  patient: IShiftPatient,
  dateYmd: string,
  isDryRun: boolean,
): Promise<PatientAdmissionEntity | null> {
  if (patient.code) {
    const patientEntity = await ensureCodePatient(
      repos,
      state.processedCodePatients,
      counters,
      patient.code,
      patient.name,
      isDryRun,
    );

    return resolveCodeShiftAdmission(
      repos,
      state,
      counters,
      patient,
      dateYmd,
      patientEntity,
      isDryRun,
    );
  }

  if (patient.name) {
    return resolveNameShiftAdmission(
      repos,
      state,
      counters,
      patient,
      dateYmd,
      isDryRun,
    );
  }

  return null;
}

async function linkRecordShifts(
  repos: IBackfillRepos,
  state: IBackfillBedState,
  counters: IBackfillCounters,
  record: DailyRecordEntity,
  isDryRun: boolean,
): Promise<void> {
  const dateYmd = formatBusinessDayYmd(record.businessDayAt);
  let isRecordDirty = false;

  for (const shift of ['morning', 'evening'] as const) {
    const patient = getShiftPatient(record, shift);
    const admissionField =
      shift === 'morning'
        ? 'morningPatientAdmissionId'
        : 'eveningPatientAdmissionId';

    if (!shiftHasPatient(patient) || record[admissionField]) {
      continue;
    }

    const admission = await resolveShiftAdmission(
      repos,
      state,
      counters,
      patient,
      dateYmd,
      isDryRun,
    );

    if (!admission) {
      continue;
    }

    record[admissionField] = admission.id;
    isRecordDirty = true;
    counters.linkedShifts += 1;
  }

  if (isRecordDirty && !isDryRun) {
    await repos.recordRepo.save(record);
  }
}

async function backfillUnlinkedEpisodes(
  repos: IBackfillRepos,
  state: IBackfillBedState,
  counters: IBackfillCounters,
  isDryRun: boolean,
): Promise<void> {
  for (const code of collectPatientCodes(state.records)) {
    const matcher = createCodeMatcher(code);
    const episodes = findAllEpisodes(state.recordsByDate, matcher);

    for (const episode of episodes) {
      const hasLinkedRecord = state.records.some((record) => {
        const dateYmd = formatBusinessDayYmd(record.businessDayAt);

        if (dateYmd < episode.startDate || dateYmd > episode.endDate) {
          return false;
        }

        return Boolean(
          record.morningPatientAdmissionId || record.eveningPatientAdmissionId,
        );
      });

      if (hasLinkedRecord) {
        continue;
      }

      const patientEntity = await ensureCodePatient(
        repos,
        state.processedCodePatients,
        counters,
        code,
        episode.displayName,
        isDryRun,
      );

      if (!isDryRun) {
        await repos.admissionRepo.save(
          repos.admissionRepo.create({
            patientId: patientEntity.id,
            bedId: state.bedId,
            startDate: episode.startDate,
            endDate: episode.endDate,
            status: admissionStatusForEndDate(episode.endDate),
            source: PatientAdmissionSource.WITH_CODE,
          }),
        );
      }

      counters.createdAdmissions += 1;
    }
  }
}

async function backfillBed(
  repos: IBackfillRepos,
  bedId: string,
  counters: IBackfillCounters,
  isDryRun: boolean,
): Promise<void> {
  const records = await repos.recordRepo.find({
    where: { bedId },
    order: { businessDayAt: 'ASC' },
  });

  if (records.length === 0) {
    return;
  }

  const state: IBackfillBedState = {
    bedId,
    records,
    recordsByDate: buildRecordsByDate(records),
    processedCodePatients: new Map<string, PatientEntity>(),
    activeCodeAdmissions: new Map<string, PatientAdmissionEntity>(),
  };

  for (const record of records) {
    await linkRecordShifts(repos, state, counters, record, isDryRun);
  }

  await backfillUnlinkedEpisodes(repos, state, counters, isDryRun);
}

async function main(): Promise<void> {
  const isDryRun = process.argv.includes('--dry-run');

  await dataSource.initialize();

  const repos: IBackfillRepos = {
    recordRepo: dataSource.getRepository(DailyRecordEntity),
    patientRepo: dataSource.getRepository(PatientEntity),
    admissionRepo: dataSource.getRepository(PatientAdmissionEntity),
  };

  const beds = await dataSource.query<Array<{ id: string }>>(
    `SELECT id FROM beds ORDER BY id`,
  );

  const counters: IBackfillCounters = {
    createdPatients: 0,
    createdAdmissions: 0,
    linkedShifts: 0,
  };

  for (const bed of beds) {
    await backfillBed(repos, bed.id, counters, isDryRun);
  }

  console.info(
    JSON.stringify(
      {
        isDryRun,
        createdPatients: counters.createdPatients,
        createdAdmissions: counters.createdAdmissions,
        linkedShifts: counters.linkedShifts,
      },
      null,
      2,
    ),
  );

  await dataSource.destroy();
}

try {
  await main();
} catch (error: unknown) {
  console.error(error);
  process.exitCode = 1;
}
