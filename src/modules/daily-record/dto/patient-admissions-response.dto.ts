import { type IPatientEpisodeSummaryDto } from './patient-episode-response.dto';

export interface IPatientAdmissionItemDto {
  bed: {
    bedId: Uuid;
    bedName: string;
    roomName: string;
    floor: string;
  };
  medicalRecordCode: string | null;
  startDate: string;
  endDate: string;
  totalDays: number;
  shiftsWithVitals: number;
  summary: IPatientEpisodeSummaryDto;
}

export interface IPatientAdmissionsResponseDto {
  patientCode: string | null;
  patientName: string | null;
  totalAdmissions: number;
  admissions: IPatientAdmissionItemDto[];
}
