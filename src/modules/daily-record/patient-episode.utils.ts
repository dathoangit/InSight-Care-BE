import {
  formatBusinessDayYmd,
  getNextYmdVN,
  getPreviousYmdVN,
  type VitalsShift,
} from '../../common/vietnam-date';
import {
  type IChartPointDto,
  type IPatientEpisodeDailyRowDto,
  type IPatientEpisodeSummaryDto,
  type IRecordEnteredByDto,
  type IVitalsPointDto,
} from './dto/patient-episode-response.dto';
import { type DailyRecordEntity } from './entities/daily-record.entity';

export type DayStatus = 'match' | 'empty' | 'other';

export interface IEpisodeBoundaries {
  zoneStart: string;
  zoneEnd: string;
  startDate: string;
  endDate: string;
  displayName: string;
}

export function normalizePatientName(name: string): string {
  return name.trim().toLowerCase();
}

export function parseBloodPressure(bp: string | null | undefined): {
  systolic: number | null;
  diastolic: number | null;
} {
  if (!bp?.trim()) {
    return { systolic: null, diastolic: null };
  }

  const match = /^(\d+)\s*\/\s*(\d+)$/.exec(bp.trim());

  if (!match) {
    return { systolic: null, diastolic: null };
  }

  return {
    systolic: Number.parseInt(match[1], 10),
    diastolic: Number.parseInt(match[2], 10),
  };
}

export function classifyDay(
  record: DailyRecordEntity | undefined,
  normalizedName: string,
): DayStatus {
  if (!record) {
    return 'empty';
  }

  const morning = record.morningPatientName?.trim();
  const evening = record.eveningPatientName?.trim();

  if (!morning && !evening) {
    return 'empty';
  }

  const morningNorm = morning ? normalizePatientName(morning) : null;
  const eveningNorm = evening ? normalizePatientName(evening) : null;
  const hasMatch =
    morningNorm === normalizedName || eveningNorm === normalizedName;
  const hasOther =
    (morningNorm !== null && morningNorm !== normalizedName) ||
    (eveningNorm !== null && eveningNorm !== normalizedName);

  if (hasOther) {
    return 'other';
  }

  if (hasMatch) {
    return 'match';
  }

  return 'empty';
}

export function buildRecordsByDate(
  records: DailyRecordEntity[],
): Map<string, DailyRecordEntity> {
  const map = new Map<string, DailyRecordEntity>();

  for (const record of records) {
    map.set(formatBusinessDayYmd(record.businessDayAt), record);
  }

  return map;
}

function getSortedDateBounds(
  recordsByDate: Map<string, DailyRecordEntity>,
  anchorDate: string,
): { earliest: string; latest: string; rangeEnd: string } {
  const sortedDates = [...recordsByDate.keys()].sort();
  const earliest = sortedDates[0];
  const latest = sortedDates.at(-1) ?? anchorDate;

  return {
    earliest,
    latest,
    rangeEnd: anchorDate > latest ? anchorDate : latest,
  };
}

function expandZoneStart(
  anchorDate: string,
  earliest: string,
  recordsByDate: Map<string, DailyRecordEntity>,
  normalizedName: string,
): string {
  let zoneStart = anchorDate;

  while (zoneStart > earliest) {
    const previous = getPreviousYmdVN(zoneStart);
    const hasRecord = recordsByDate.has(previous);

    if (!hasRecord && previous < earliest) {
      break;
    }

    if (classifyDay(recordsByDate.get(previous), normalizedName) === 'other') {
      break;
    }

    zoneStart = previous;
  }

  return zoneStart;
}

function expandZoneEnd(
  anchorDate: string,
  rangeEnd: string,
  latest: string,
  recordsByDate: Map<string, DailyRecordEntity>,
  normalizedName: string,
): string {
  let zoneEnd = anchorDate;

  while (zoneEnd < rangeEnd) {
    const next = getNextYmdVN(zoneEnd);
    const hasRecord = recordsByDate.has(next);

    if (!hasRecord && next > latest) {
      break;
    }

    if (classifyDay(recordsByDate.get(next), normalizedName) === 'other') {
      break;
    }

    zoneEnd = next;
  }

  return zoneEnd;
}

function updateDisplayNameFromRecord(
  record: DailyRecordEntity,
  normalizedName: string,
  currentDisplayName: string,
): string {
  const names = [record.morningPatientName, record.eveningPatientName].filter(
    (name): name is string => Boolean(name?.trim()),
  );

  for (const name of names) {
    if (normalizePatientName(name) === normalizedName) {
      return name.trim();
    }
  }

  return currentDisplayName;
}

function findMatchDateRange(
  zoneStart: string,
  zoneEnd: string,
  recordsByDate: Map<string, DailyRecordEntity>,
  normalizedName: string,
): { startDate: string; endDate: string; displayName: string } | null {
  let startDate: string | null = null;
  let endDate: string | null = null;
  let displayName = '';

  for (
    let cursor = zoneStart;
    cursor <= zoneEnd;
    cursor = getNextYmdVN(cursor)
  ) {
    if (classifyDay(recordsByDate.get(cursor), normalizedName) !== 'match') {
      continue;
    }

    if (!startDate) {
      startDate = cursor;
    }

    endDate = cursor;

    const record = recordsByDate.get(cursor);

    if (record) {
      displayName = updateDisplayNameFromRecord(
        record,
        normalizedName,
        displayName,
      );
    }
  }

  if (!startDate || !endDate) {
    return null;
  }

  return { startDate, endDate, displayName };
}

export function resolveEpisodeBoundaries(
  recordsByDate: Map<string, DailyRecordEntity>,
  normalizedName: string,
  anchorDate: string,
): IEpisodeBoundaries | null {
  if (recordsByDate.size === 0) {
    return null;
  }

  const { earliest, latest, rangeEnd } = getSortedDateBounds(
    recordsByDate,
    anchorDate,
  );

  if (classifyDay(recordsByDate.get(anchorDate), normalizedName) === 'other') {
    return null;
  }

  const zoneStart = expandZoneStart(
    anchorDate,
    earliest,
    recordsByDate,
    normalizedName,
  );
  const zoneEnd = expandZoneEnd(
    anchorDate,
    rangeEnd,
    latest,
    recordsByDate,
    normalizedName,
  );
  const matchRange = findMatchDateRange(
    zoneStart,
    zoneEnd,
    recordsByDate,
    normalizedName,
  );

  if (!matchRange) {
    return null;
  }

  if (anchorDate < zoneStart || anchorDate > zoneEnd) {
    return null;
  }

  return {
    zoneStart,
    zoneEnd,
    startDate: matchRange.startDate,
    endDate: matchRange.endDate,
    displayName: matchRange.displayName || normalizedName,
  };
}

function toEnteredByDto(
  user: { id: Uuid; username: string } | null | undefined,
): IRecordEnteredByDto | null {
  if (!user) {
    return null;
  }

  return {
    userId: user.id,
    username: user.username,
  };
}

function toVitalsPoint(
  patientName: string | null,
  pulse: number | null,
  temp: number | null,
  bp: string | null,
  note: string | null,
  enteredBy: IRecordEnteredByDto | null,
): IVitalsPointDto | null {
  const hasData =
    patientName !== null ||
    pulse !== null ||
    temp !== null ||
    (bp !== null && bp.trim() !== '') ||
    (note !== null && note.trim() !== '');

  if (!hasData) {
    return null;
  }

  const parsed = parseBloodPressure(bp);

  return {
    patientName,
    pulse,
    temp,
    bp,
    bpSystolic: parsed.systolic,
    bpDiastolic: parsed.diastolic,
    note,
    enteredBy,
  };
}

export function buildDailyRows(
  recordsByDate: Map<string, DailyRecordEntity>,
  startDate: string,
  endDate: string,
): IPatientEpisodeDailyRowDto[] {
  const rows: IPatientEpisodeDailyRowDto[] = [];

  for (
    let cursor = startDate;
    cursor <= endDate;
    cursor = getNextYmdVN(cursor)
  ) {
    const record = recordsByDate.get(cursor);

    rows.push({
      date: cursor,
      morning: record
        ? toVitalsPoint(
            record.morningPatientName,
            record.morningPulse,
            record.morningTemp,
            record.morningBp,
            record.morningNote,
            toEnteredByDto(record.morningEnteredByUser),
          )
        : null,
      evening: record
        ? toVitalsPoint(
            record.eveningPatientName,
            record.eveningPulse,
            record.eveningTemp,
            record.eveningBp,
            record.eveningNote,
            toEnteredByDto(record.eveningEnteredByUser),
          )
        : null,
    });
  }

  return rows.reverse();
}

function pushChartPoint(
  target: IChartPointDto[],
  date: string,
  shift: VitalsShift,
  value: number | null,
): void {
  if (value === null) {
    return;
  }

  target.push({ date, shift, value });
}

export function buildChartSeries(dailyRows: IPatientEpisodeDailyRowDto[]): {
  pulse: IChartPointDto[];
  temperature: IChartPointDto[];
  bpSystolic: IChartPointDto[];
  bpDiastolic: IChartPointDto[];
} {
  const pulse: IChartPointDto[] = [];
  const temperature: IChartPointDto[] = [];
  const bpSystolic: IChartPointDto[] = [];
  const bpDiastolic: IChartPointDto[] = [];

  for (const row of dailyRows) {
    if (row.morning) {
      pushChartPoint(pulse, row.date, 'morning', row.morning.pulse);
      pushChartPoint(temperature, row.date, 'morning', row.morning.temp);
      pushChartPoint(bpSystolic, row.date, 'morning', row.morning.bpSystolic);
      pushChartPoint(bpDiastolic, row.date, 'morning', row.morning.bpDiastolic);
    }

    if (row.evening) {
      pushChartPoint(pulse, row.date, 'evening', row.evening.pulse);
      pushChartPoint(temperature, row.date, 'evening', row.evening.temp);
      pushChartPoint(bpSystolic, row.date, 'evening', row.evening.bpSystolic);
      pushChartPoint(bpDiastolic, row.date, 'evening', row.evening.bpDiastolic);
    }
  }

  return { pulse, temperature, bpSystolic, bpDiastolic };
}

export function countInclusiveDays(startDate: string, endDate: string): number {
  let count = 0;

  for (
    let cursor = startDate;
    cursor <= endDate;
    cursor = getNextYmdVN(cursor)
  ) {
    count += 1;
  }

  return count;
}

export function shiftHasVitals(point: IVitalsPointDto | null): boolean {
  return (
    point !== null &&
    (point.pulse !== null ||
      point.temp !== null ||
      Boolean(point.bp?.trim()) ||
      Boolean(point.note?.trim()))
  );
}

export function countShiftsWithVitals(
  dailyRows: IPatientEpisodeDailyRowDto[],
): number {
  let count = 0;

  for (const row of dailyRows) {
    if (shiftHasVitals(row.morning)) {
      count += 1;
    }

    if (shiftHasVitals(row.evening)) {
      count += 1;
    }
  }

  return count;
}

function averageRounded(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  return (
    Math.round(
      (values.reduce((sum, value) => sum + value, 0) / values.length) * 10,
    ) / 10
  );
}

function accumulateVitalSummary(dailyRows: IPatientEpisodeDailyRowDto[]): {
  pulseValues: number[];
  tempValues: number[];
  latestPulse: number | null;
  latestTemp: number | null;
  latestBp: string | null;
} {
  const pulseValues: number[] = [];
  const tempValues: number[] = [];
  let latestPulse: number | null = null;
  let latestTemp: number | null = null;
  let latestBp: string | null = null;

  for (const row of dailyRows) {
    for (const point of [row.morning, row.evening]) {
      if (!point) {
        continue;
      }

      if (point.pulse !== null) {
        pulseValues.push(point.pulse);
        latestPulse = point.pulse;
      }

      if (point.temp !== null) {
        tempValues.push(point.temp);
        latestTemp = point.temp;
      }

      if (point.bp) {
        latestBp = point.bp;
      }
    }
  }

  return {
    pulseValues,
    tempValues,
    latestPulse,
    latestTemp,
    latestBp,
  };
}

export function buildSummary(
  dailyRows: IPatientEpisodeDailyRowDto[],
): IPatientEpisodeSummaryDto {
  const accumulated = accumulateVitalSummary(dailyRows);

  return {
    latestPulse: accumulated.latestPulse,
    latestTemp: accumulated.latestTemp,
    latestBp: accumulated.latestBp,
    avgPulse: averageRounded(accumulated.pulseValues),
    avgTemp: averageRounded(accumulated.tempValues),
    maxTemp:
      accumulated.tempValues.length > 0
        ? Math.max(...accumulated.tempValues)
        : null,
    minTemp:
      accumulated.tempValues.length > 0
        ? Math.min(...accumulated.tempValues)
        : null,
  };
}
