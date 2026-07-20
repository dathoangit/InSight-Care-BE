import { type IPatientEpisodeSummaryDto } from './patient-episode-response.dto';

export interface IPatientAdmissionItemDto {
  bed: {
    bedId: Uuid;
    bedName: string;
    roomName: string;
    floor: string;
  };
  startDate: string;
  endDate: string;
  totalDays: number;
  shiftsWithVitals: number;
  summary: IPatientEpisodeSummaryDto;
}

export interface IPatientAdmissionsResponseDto {
  patientCode: string;
  patientName: string | null;
  totalAdmissions: number;
  admissions: IPatientAdmissionItemDto[];
}
