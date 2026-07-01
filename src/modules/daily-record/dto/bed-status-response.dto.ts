import { type VitalsShift } from '../../../common/vietnam-date';
import { type IBedTodayStatusDto } from '../daily-record.service';

export interface IBedStatusResponseDto {
  serverDate: string;
  editableShift: VitalsShift;
  requestedDate: string;
  beds: IBedTodayStatusDto[];
}

export { type ITodayRecordDto } from '../daily-record.service';
