import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { businessDayStartUtc } from '../../common/vietnam-date';
import {
  PatientAdmissionSource,
  PatientAdmissionStatus,
  PatientIdentityType,
} from '../../constants';
import { PatientEntity } from './entities/patient.entity';
import { PatientAdmissionEntity } from './entities/patient-admission.entity';
import { PatientAdmissionResolverService } from './patient-admission-resolver.service';

const BED_ID = '11111111-1111-4111-8111-111111111111' as Uuid;

function createRepositoryMock(): {
  findOne: jest.Mock;
  find: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
} {
  return {
    findOne: jest.fn(),
    find: jest.fn(),
    create: jest.fn((value: unknown) => value),
    save: jest.fn((value: Record<string, unknown>) => ({
      id: 'generated-id',
      ...value,
    })),
  };
}

describe('PatientAdmissionResolverService', () => {
  let service: PatientAdmissionResolverService;
  let patientRepository: ReturnType<typeof createRepositoryMock>;
  let admissionRepository: ReturnType<typeof createRepositoryMock>;

  beforeEach(async () => {
    patientRepository = createRepositoryMock();
    admissionRepository = createRepositoryMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PatientAdmissionResolverService,
        {
          provide: getRepositoryToken(PatientEntity),
          useValue: patientRepository,
        },
        {
          provide: getRepositoryToken(PatientAdmissionEntity),
          useValue: admissionRepository,
        },
      ],
    }).compile();

    service = module.get(PatientAdmissionResolverService);
  });

  it('creates coded patient and admission when none exists', async () => {
    patientRepository.findOne.mockResolvedValue(null);
    admissionRepository.findOne.mockResolvedValue(null);
    admissionRepository.find.mockResolvedValue([]);

    const result = await service.resolveAdmission({
      bedId: BED_ID,
      businessDayAt: businessDayStartUtc('2026-07-02'),
      shift: 'morning',
      patientName: 'Nguyễn Văn A',
      patientCode: '1234567890',
      medicalRecordCode: '2622835',
      existingRecord: null,
      previousDayRecord: null,
    });

    expect(patientRepository.create).toHaveBeenCalledWith({
      patientCode: '1234567890',
      displayName: 'Nguyễn Văn A',
      identityType: PatientIdentityType.CODE,
    });
    expect(admissionRepository.create).toHaveBeenCalledWith({
      patientId: 'generated-id',
      bedId: BED_ID,
      startDate: '2026-07-02',
      endDate: '2026-07-02',
      status: PatientAdmissionStatus.ACTIVE,
      source: PatientAdmissionSource.WITH_CODE,
      medicalRecordCode: '2622835',
    });
    expect(result?.source).toBe(PatientAdmissionSource.WITH_CODE);
    expect(service.getMetrics().createdPatients).toBe(1);
    expect(service.getMetrics().createdAdmissions).toBe(1);
  });

  it('reuses active coded admission on consecutive day', async () => {
    patientRepository.findOne.mockResolvedValue({
      id: 'patient-1',
      patientCode: '1234567890',
      displayName: 'Nguyễn Văn A',
      identityType: PatientIdentityType.CODE,
    } as PatientEntity);
    admissionRepository.find.mockResolvedValue([]);
    admissionRepository.findOne.mockResolvedValue({
      id: 'admission-1',
      patientId: 'patient-1',
      bedId: BED_ID,
      startDate: '2026-07-01',
      endDate: '2026-07-01',
      status: PatientAdmissionStatus.ACTIVE,
      source: PatientAdmissionSource.WITH_CODE,
      medicalRecordCode: '2622835',
    } as PatientAdmissionEntity);

    const result = await service.resolveAdmission({
      bedId: BED_ID,
      businessDayAt: businessDayStartUtc('2026-07-02'),
      shift: 'morning',
      patientName: 'Nguyễn Văn A',
      patientCode: '1234567890',
      medicalRecordCode: '2622835',
      existingRecord: null,
      previousDayRecord: null,
    });

    expect(admissionRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'admission-1',
        endDate: '2026-07-02',
        medicalRecordCode: '2622835',
      }),
    );
    expect(result?.id).toBe('admission-1');
    expect(service.getMetrics().reusedAdmissions).toBe(1);
  });

  it('creates new no-code patient and admission for a new stint', async () => {
    const result = await service.resolveAdmission({
      bedId: BED_ID,
      businessDayAt: businessDayStartUtc('2026-07-02'),
      shift: 'morning',
      patientName: 'Trần Thị B',
      patientCode: null,
      medicalRecordCode: null,
      existingRecord: null,
      previousDayRecord: null,
    });

    expect(patientRepository.create).toHaveBeenCalledWith({
      patientCode: null,
      displayName: 'Trần Thị B',
      identityType: PatientIdentityType.NO_CODE,
    });
    expect(admissionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        source: PatientAdmissionSource.NO_CODE,
      }),
    );
    expect(result?.source).toBe(PatientAdmissionSource.NO_CODE);
  });

  it('reuses morning admission for evening same day without code', async () => {
    admissionRepository.findOne.mockResolvedValue({
      id: 'admission-morning',
      patientId: 'patient-1',
      bedId: BED_ID,
      startDate: '2026-07-02',
      endDate: '2026-07-02',
      status: PatientAdmissionStatus.ACTIVE,
      source: PatientAdmissionSource.NO_CODE,
    } as PatientAdmissionEntity);

    const result = await service.resolveAdmission({
      bedId: BED_ID,
      businessDayAt: businessDayStartUtc('2026-07-02'),
      shift: 'evening',
      patientName: 'Trần Thị B',
      patientCode: null,
      medicalRecordCode: '2789012',
      existingRecord: {
        morningPatientName: 'Trần Thị B',
        morningPatientAdmissionId: 'admission-morning',
      } as never,
      previousDayRecord: null,
    });

    expect(admissionRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'admission-morning',
        endDate: '2026-07-02',
        medicalRecordCode: '2789012',
      }),
    );
    expect(result?.id).toBe('admission-morning');
    expect(service.getMetrics().reusedAdmissions).toBe(1);
  });

  it('uses EntityManager repositories when manager is provided', async () => {
    const managerPatientRepo = createRepositoryMock();
    const managerAdmissionRepo = createRepositoryMock();
    const manager = {
      getRepository: jest.fn((entity: unknown) => {
        if (entity === PatientEntity) {
          return managerPatientRepo;
        }

        if (entity === PatientAdmissionEntity) {
          return managerAdmissionRepo;
        }

        throw new Error('Unexpected entity');
      }),
    };

    managerPatientRepo.findOne.mockResolvedValue(null);
    managerAdmissionRepo.findOne.mockResolvedValue(null);
    managerAdmissionRepo.find.mockResolvedValue([]);

    await service.resolveAdmission({
      bedId: BED_ID,
      businessDayAt: businessDayStartUtc('2026-07-02'),
      shift: 'morning',
      patientName: 'Nguyễn Văn A',
      patientCode: '1234567890',
      medicalRecordCode: null,
      existingRecord: null,
      previousDayRecord: null,
      manager: manager as never,
    });

    expect(manager.getRepository).toHaveBeenCalledWith(PatientEntity);
    expect(manager.getRepository).toHaveBeenCalledWith(PatientAdmissionEntity);
    expect(managerPatientRepo.create).toHaveBeenCalled();
    expect(patientRepository.create).not.toHaveBeenCalled();
  });

  it('creates new admission without inheriting medical record code after discharge gap', async () => {
    patientRepository.findOne.mockResolvedValue({
      id: 'patient-1',
      patientCode: '1234567890',
      displayName: 'Nguyễn Văn A',
      identityType: PatientIdentityType.CODE,
    } as PatientEntity);
    admissionRepository.find.mockResolvedValue([]);
    admissionRepository.findOne.mockResolvedValue({
      id: 'admission-old',
      patientId: 'patient-1',
      bedId: BED_ID,
      startDate: '2026-06-20',
      endDate: '2026-06-25',
      status: PatientAdmissionStatus.ACTIVE,
      source: PatientAdmissionSource.WITH_CODE,
      medicalRecordCode: '2622835',
    } as PatientAdmissionEntity);

    const result = await service.resolveAdmission({
      bedId: BED_ID,
      businessDayAt: businessDayStartUtc('2026-07-02'),
      shift: 'morning',
      patientName: 'Nguyễn Văn A',
      patientCode: '1234567890',
      medicalRecordCode: '2789012',
      existingRecord: null,
      previousDayRecord: null,
    });

    expect(admissionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        medicalRecordCode: '2789012',
        source: PatientAdmissionSource.WITH_CODE,
      }),
    );
    expect(result?.medicalRecordCode).toBe('2789012');
    expect(service.getMetrics().createdAdmissions).toBe(1);
    expect(service.getMetrics().dischargedAdmissions).toBe(1);
  });
});
