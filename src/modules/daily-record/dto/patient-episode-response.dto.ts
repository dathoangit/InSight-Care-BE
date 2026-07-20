import { type VitalsShift } from '../../../common/vietnam-date';

export interface IRecordEnteredByDto {
  userId: Uuid;
  username: string;
}

export interface IVitalsPointDto {
  patientName: string | null;
  pulse: number | null;
  temp: number | null;
  bp: string | null;
  bpSystolic: number | null;
  bpDiastolic: number | null;
  note: string | null;
  enteredBy: IRecordEnteredByDto | null;
}

export interface IChartPointDto {
  date: string;
  shift: VitalsShift;
  value: number;
}

export interface IPatientEpisodeDailyRowDto {
  date: string;
  morning: IVitalsPointDto | null;
  evening: IVitalsPointDto | null;
}

export interface IPatientEpisodeSummaryDto {
  latestPulse: number | null;
  latestTemp: number | null;
  latestBp: string | null;
  avgPulse: number | null;
  avgTemp: number | null;
  maxTemp: number | null;
  minTemp: number | null;
}

export interface IPatientEpisodeResponseDto {
  patientName: string;
  patientCode: string | null;
  bed: {
    bedId: Uuid;
    bedName: string;
    roomName: string;
    floor: string;
  };
  startDate: string;
  endDate: string;
  anchorDate: string;
  totalDays: number;
  shiftsWithVitals: number;
  dailyRows: IPatientEpisodeDailyRowDto[];
  chartSeries: {
    pulse: IChartPointDto[];
    temperature: IChartPointDto[];
    bpSystolic: IChartPointDto[];
    bpDiastolic: IChartPointDto[];
  };
  summary: IPatientEpisodeSummaryDto;
}
