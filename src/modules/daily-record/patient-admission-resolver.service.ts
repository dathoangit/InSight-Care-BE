import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { type EntityManager, Not, QueryFailedError, Repository } from 'typeorm';

import {
  formatBusinessDayYmd,
  getPreviousYmdVN,
} from '../../common/vietnam-date';
import {
  PatientAdmissionSource,
  PatientAdmissionStatus,
  PatientIdentityType,
} from '../../constants';
import { type DailyRecordEntity } from './entities/daily-record.entity';
import { PatientEntity } from './entities/patient.entity';
import { PatientAdmissionEntity } from './entities/patient-admission.entity';
import { normalizePatientCodeField } from './patient-episode.utils';

export type ResolveAdmissionShift = 'morning' | 'evening';

export interface IResolveAdmissionInput {
  bedId: Uuid;
  businessDayAt: Date;
  shift: ResolveAdmissionShift;
  patientName: string | null;
  patientCode: string | null;
  medicalRecordCode: string | null;
  existingRecord: DailyRecordEntity | null;
  previousDayRecord: DailyRecordEntity | null;
  manager?: EntityManager;
}

export interface IAdmissionResolutionMetrics {
  createdPatients: number;
  createdAdmissions: number;
  reusedAdmissions: number;
  dischargedAdmissions: number;
}

const PG_UNIQUE_VIOLATION = '23505';

@Injectable()
export class PatientAdmissionResolverService {
  private readonly logger = new Logger(PatientAdmissionResolverService.name);

  private metrics: IAdmissionResolutionMetrics = {
    createdPatients: 0,
    createdAdmissions: 0,
    reusedAdmissions: 0,
    dischargedAdmissions: 0,
  };

  constructor(
    @InjectRepository(PatientEntity)
    private readonly patientRepository: Repository<PatientEntity>,
    @InjectRepository(PatientAdmissionEntity)
    private readonly admissionRepository: Repository<PatientAdmissionEntity>,
  ) {}

  resetMetrics(): void {
    this.metrics = {
      createdPatients: 0,
      createdAdmissions: 0,
      reusedAdmissions: 0,
      dischargedAdmissions: 0,
    };
  }

  getMetrics(): IAdmissionResolutionMetrics {
    return { ...this.metrics };
  }

  logMetrics(context: string): void {
    const metrics = this.getMetrics();

    if (
      metrics.createdPatients === 0 &&
      metrics.createdAdmissions === 0 &&
      metrics.reusedAdmissions === 0 &&
      metrics.dischargedAdmissions === 0
    ) {
      return;
    }

    this.logger.log(
      [
        `${context} admission metrics:`,
        `createdPatients=${metrics.createdPatients}`,
        `createdAdmissions=${metrics.createdAdmissions}`,
        `reusedAdmissions=${metrics.reusedAdmissions}`,
        `dischargedAdmissions=${metrics.dischargedAdmissions}`,
      ].join(' '),
    );
  }

  async resolveAdmission(
    input: IResolveAdmissionInput,
  ): Promise<PatientAdmissionEntity | null> {
    const patientName = input.patientName?.trim() || null;
    const patientCode = normalizePatientCodeField(input.patientCode);
    const medicalRecordCode = normalizePatientCodeField(
      input.medicalRecordCode,
    );

    if (!patientName && !patientCode) {
      return null;
    }

    const businessDayYmd = formatBusinessDayYmd(input.businessDayAt);

    if (patientCode) {
      return this.resolveCodedAdmission(
        patientCode,
        patientName,
        medicalRecordCode,
        input.bedId,
        businessDayYmd,
        input.manager,
      );
    }

    return this.resolveNoCodeAdmission(
      input,
      patientName,
      medicalRecordCode,
      businessDayYmd,
      input.manager,
    );
  }

  private patientRepo(manager?: EntityManager): Repository<PatientEntity> {
    return manager?.getRepository(PatientEntity) ?? this.patientRepository;
  }

  private admissionRepo(
    manager?: EntityManager,
  ): Repository<PatientAdmissionEntity> {
    return (
      manager?.getRepository(PatientAdmissionEntity) ?? this.admissionRepository
    );
  }

  private async resolveCodedAdmission(
    patientCode: string,
    patientName: string | null,
    medicalRecordCode: string | null,
    bedId: Uuid,
    businessDayYmd: string,
    manager?: EntityManager,
  ): Promise<PatientAdmissionEntity> {
    const patient = await this.findOrCreateCodedPatient(
      patientCode,
      patientName,
      manager,
    );

    await this.dischargeActiveAdmissionsOnOtherBeds(
      patient.id,
      bedId,
      businessDayYmd,
      manager,
    );

    const admissionRepository = this.admissionRepo(manager);
    const activeOnBed = await admissionRepository.findOne({
      where: {
        patientId: patient.id,
        bedId,
        status: PatientAdmissionStatus.ACTIVE,
      },
      order: { startDate: 'DESC' },
    });

    if (activeOnBed && this.isContinuousStay(activeOnBed, businessDayYmd)) {
      activeOnBed.endDate = businessDayYmd;
      this.applyMedicalRecordCodeOnReuse(activeOnBed, medicalRecordCode);
      this.metrics.reusedAdmissions += 1;

      return this.saveAdmission(activeOnBed, manager);
    }

    if (activeOnBed) {
      await this.dischargeAdmission(activeOnBed, businessDayYmd, manager);
    }

    return this.createAdmission(
      patient.id,
      bedId,
      businessDayYmd,
      PatientAdmissionSource.WITH_CODE,
      medicalRecordCode,
      manager,
    );
  }

  private async resolveNoCodeAdmission(
    input: IResolveAdmissionInput,
    patientName: string | null,
    medicalRecordCode: string | null,
    businessDayYmd: string,
    manager?: EntityManager,
  ): Promise<PatientAdmissionEntity> {
    const admissionRepository = this.admissionRepo(manager);
    const continuingAdmissionId = this.findContinuingNoCodeAdmissionId(
      input,
      patientName,
    );

    if (continuingAdmissionId) {
      const admission = await admissionRepository.findOne({
        where: { id: continuingAdmissionId },
      });

      if (
        admission &&
        admission.bedId === input.bedId &&
        admission.source === PatientAdmissionSource.NO_CODE &&
        this.isContinuousStay(admission, businessDayYmd)
      ) {
        admission.endDate = businessDayYmd;
        this.applyMedicalRecordCodeOnReuse(admission, medicalRecordCode);
        this.metrics.reusedAdmissions += 1;

        return this.saveAdmission(admission, manager);
      }
    }

    const patient = await this.createNoCodePatient(patientName, manager);

    return this.createAdmission(
      patient.id,
      input.bedId,
      businessDayYmd,
      PatientAdmissionSource.NO_CODE,
      medicalRecordCode,
      manager,
    );
  }

  private findContinuingNoCodeAdmissionId(
    input: IResolveAdmissionInput,
    patientName: string | null,
  ): Uuid | null {
    if (!patientName) {
      return null;
    }

    const normalizedName = patientName.trim().toLowerCase();

    if (input.shift === 'evening') {
      const morningAdmissionId =
        input.existingRecord?.morningPatientAdmissionId ?? null;
      const morningName =
        input.existingRecord?.morningPatientName?.trim().toLowerCase() ?? null;

      if (morningAdmissionId && morningName && morningName === normalizedName) {
        return morningAdmissionId;
      }
    }

    const previousRecord = input.previousDayRecord;

    if (!previousRecord) {
      return null;
    }

    const previousName = (
      previousRecord.eveningPatientName ?? previousRecord.morningPatientName
    )
      ?.trim()
      .toLowerCase();

    if (!previousName || previousName !== normalizedName) {
      return null;
    }

    return (
      previousRecord.eveningPatientAdmissionId ??
      previousRecord.morningPatientAdmissionId ??
      null
    );
  }

  private isContinuousStay(
    admission: PatientAdmissionEntity,
    businessDayYmd: string,
  ): boolean {
    const previousDay = getPreviousYmdVN(businessDayYmd);
    const endDate = admission.endDate ?? admission.startDate;

    return (
      endDate === previousDay ||
      endDate === businessDayYmd ||
      admission.startDate === businessDayYmd
    );
  }

  private applyMedicalRecordCodeOnReuse(
    admission: PatientAdmissionEntity,
    medicalRecordCode: string | null,
  ): void {
    if (medicalRecordCode) {
      admission.medicalRecordCode = medicalRecordCode;
    }
  }

  private async findOrCreateCodedPatient(
    patientCode: string,
    patientName: string | null,
    manager?: EntityManager,
  ): Promise<PatientEntity> {
    const patientRepository = this.patientRepo(manager);
    const existing = await patientRepository.findOne({
      where: { patientCode },
    });

    if (existing) {
      if (patientName && existing.displayName !== patientName) {
        existing.displayName = patientName;
        await patientRepository.save(existing);
      }

      return existing;
    }

    const created = patientRepository.create({
      patientCode,
      displayName: patientName,
      identityType: PatientIdentityType.CODE,
    });
    this.metrics.createdPatients += 1;

    return patientRepository.save(created);
  }

  private async createNoCodePatient(
    patientName: string | null,
    manager?: EntityManager,
  ): Promise<PatientEntity> {
    const patientRepository = this.patientRepo(manager);
    const created = patientRepository.create({
      patientCode: null,
      displayName: patientName,
      identityType: PatientIdentityType.NO_CODE,
    });
    this.metrics.createdPatients += 1;

    return patientRepository.save(created);
  }

  private async createAdmission(
    patientId: Uuid,
    bedId: Uuid,
    businessDayYmd: string,
    source: PatientAdmissionSource,
    medicalRecordCode: string | null,
    manager?: EntityManager,
  ): Promise<PatientAdmissionEntity> {
    const admissionRepository = this.admissionRepo(manager);
    const created = admissionRepository.create({
      patientId,
      bedId,
      startDate: businessDayYmd,
      endDate: businessDayYmd,
      status: PatientAdmissionStatus.ACTIVE,
      source,
      medicalRecordCode,
    });
    this.metrics.createdAdmissions += 1;

    return this.saveAdmission(created, manager);
  }

  private async saveAdmission(
    admission: PatientAdmissionEntity,
    manager?: EntityManager,
  ): Promise<PatientAdmissionEntity> {
    try {
      return await this.admissionRepo(manager).save(admission);
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error as QueryFailedError & { driverError?: { code?: string } })
          .driverError.code === PG_UNIQUE_VIOLATION
      ) {
        throw new ConflictException('Medical record code already exists');
      }

      throw error;
    }
  }

  private async dischargeActiveAdmissionsOnOtherBeds(
    patientId: Uuid,
    bedId: Uuid,
    businessDayYmd: string,
    manager?: EntityManager,
  ): Promise<void> {
    const admissionRepository = this.admissionRepo(manager);
    const activeOnOtherBeds = await admissionRepository.find({
      where: {
        patientId,
        bedId: Not(bedId),
        status: PatientAdmissionStatus.ACTIVE,
      },
    });

    await Promise.all(
      activeOnOtherBeds.map((admission) =>
        this.dischargeAdmission(admission, businessDayYmd, manager),
      ),
    );
  }

  private async dischargeAdmission(
    admission: PatientAdmissionEntity,
    businessDayYmd: string,
    manager?: EntityManager,
  ): Promise<void> {
    const previousDay = getPreviousYmdVN(businessDayYmd);

    admission.status = PatientAdmissionStatus.DISCHARGED;

    if (!admission.endDate || admission.endDate >= businessDayYmd) {
      admission.endDate = previousDay;
    }

    if (admission.endDate < admission.startDate) {
      admission.endDate = admission.startDate;
    }

    this.metrics.dischargedAdmissions += 1;
    await this.admissionRepo(manager).save(admission);
  }
}
