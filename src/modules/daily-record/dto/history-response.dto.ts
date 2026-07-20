import { type ITodayRecordDto } from '../daily-record.service';
import { type IPatientAdmissionItemDto } from './patient-admissions-response.dto';

export interface IHistoryAdmissionItemDto extends IPatientAdmissionItemDto {
  patientName: string | null;
  patientCode: string | null;
}

export interface IHistoryResponseDto {
  view: 'daily' | 'admission';
  items: ITodayRecordDto[];
  admissions: IHistoryAdmissionItemDto[];
  total: number;
  limit: number;
  offset: number;
}
