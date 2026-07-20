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

export type PatientMatcher =
  | { mode: 'name'; normalizedName: string }
  | { mode: 'code'; patientCode: string };

export function normalizePatientName(name: string): string {
  return name.trim().toLowerCase();
}

export function normalizePatientCode(code: string): string {
  return code.trim();
}

export function createNameMatcher(patientName: string): PatientMatcher {
  return {
    mode: 'name',
    normalizedName: normalizePatientName(patientName),
  };
}

export function createCodeMatcher(patientCode: string): PatientMatcher {
  return {
    mode: 'code',
    patientCode: normalizePatientCode(patientCode),
  };
}

function classifyShiftByName(
  patientName: string | null | undefined,
  normalizedName: string,
): 'match' | 'other' | 'neutral' {
  const trimmed = patientName?.trim();

  if (!trimmed) {
    return 'neutral';
  }

  return normalizePatientName(trimmed) === normalizedName ? 'match' : 'other';
}

function classifyShiftByCode(
  patientCode: string | null | undefined,
  targetCode: string,
): 'match' | 'other' | 'neutral' {
  const trimmed = patientCode?.trim();

  if (!trimmed) {
    return 'neutral';
  }

  return normalizePatientCode(trimmed) === targetCode ? 'match' : 'other';
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
  matcher: PatientMatcher,
): DayStatus {
  if (!record) {
    return 'empty';
  }

  const morning =
    matcher.mode === 'code'
      ? classifyShiftByCode(record.morningPatientCode, matcher.patientCode)
      : classifyShiftByName(record.morningPatientName, matcher.normalizedName);
  const evening =
    matcher.mode === 'code'
      ? classifyShiftByCode(record.eveningPatientCode, matcher.patientCode)
      : classifyShiftByName(record.eveningPatientName, matcher.normalizedName);

  if (morning === 'neutral' && evening === 'neutral') {
    return 'empty';
  }

  if (morning === 'other' || evening === 'other') {
    return 'other';
  }

  if (morning === 'match' || evening === 'match') {
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
  matcher: PatientMatcher,
): string {
  let zoneStart = anchorDate;

  while (zoneStart > earliest) {
    const previous = getPreviousYmdVN(zoneStart);
    const hasRecord = recordsByDate.has(previous);

    if (!hasRecord && previous < earliest) {
      break;
    }

    if (classifyDay(recordsByDate.get(previous), matcher) === 'other') {
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
  matcher: PatientMatcher,
): string {
  let zoneEnd = anchorDate;

  while (zoneEnd < rangeEnd) {
    const next = getNextYmdVN(zoneEnd);
    const hasRecord = recordsByDate.has(next);

    if (!hasRecord && next > latest) {
      break;
    }

    if (classifyDay(recordsByDate.get(next), matcher) === 'other') {
      break;
    }

    zoneEnd = next;
  }

  return zoneEnd;
}

export function shiftMatchesMatcher(
  record: DailyRecordEntity,
  shift: 'morning' | 'evening',
  matcher: PatientMatcher,
): boolean {
  if (matcher.mode === 'code') {
    const code =
      shift === 'morning'
        ? record.morningPatientCode
        : record.eveningPatientCode;

    return classifyShiftByCode(code, matcher.patientCode) === 'match';
  }

  const name =
    shift === 'morning' ? record.morningPatientName : record.eveningPatientName;

  return classifyShiftByName(name, matcher.normalizedName) === 'match';
}

export interface IPatientDailyRowFilter {
  admissionId?: Uuid | null;
  matcher?: PatientMatcher;
}

export function shiftBelongsToPatient(
  record: DailyRecordEntity,
  shift: 'morning' | 'evening',
  filter: IPatientDailyRowFilter,
): boolean {
  if (filter.admissionId) {
    const linkedAdmissionId =
      shift === 'morning'
        ? record.morningPatientAdmissionId
        : record.eveningPatientAdmissionId;

    if (linkedAdmissionId === filter.admissionId) {
      return true;
    }
  }

  if (filter.matcher) {
    return shiftMatchesMatcher(record, shift, filter.matcher);
  }

  return !filter.admissionId;
}

function updateDisplayNameFromRecord(
  record: DailyRecordEntity,
  matcher: PatientMatcher,
  currentDisplayName: string,
): string {
  if (matcher.mode === 'code') {
    if (shiftMatchesMatcher(record, 'morning', matcher)) {
      const name = record.morningPatientName?.trim();

      if (name) {
        return name;
      }
    }

    if (shiftMatchesMatcher(record, 'evening', matcher)) {
      const name = record.eveningPatientName?.trim();

      if (name) {
        return name;
      }
    }

    return currentDisplayName;
  }

  const names = [record.morningPatientName, record.eveningPatientName].filter(
    (name): name is string => Boolean(name?.trim()),
  );

  for (const name of names) {
    if (normalizePatientName(name) === matcher.normalizedName) {
      return name.trim();
    }
  }

  return currentDisplayName;
}

function findMatchDateRange(
  zoneStart: string,
  zoneEnd: string,
  recordsByDate: Map<string, DailyRecordEntity>,
  matcher: PatientMatcher,
): { startDate: string; endDate: string; displayName: string } | null {
  let startDate: string | null = null;
  let endDate: string | null = null;
  let displayName = '';

  for (
    let cursor = zoneStart;
    cursor <= zoneEnd;
    cursor = getNextYmdVN(cursor)
  ) {
    if (classifyDay(recordsByDate.get(cursor), matcher) !== 'match') {
      continue;
    }

    if (!startDate) {
      startDate = cursor;
    }

    endDate = cursor;

    const record = recordsByDate.get(cursor);

    if (record) {
      displayName = updateDisplayNameFromRecord(record, matcher, displayName);
    }
  }

  if (!startDate || !endDate) {
    return null;
  }

  return {
    startDate,
    endDate,
    displayName:
      displayName || (matcher.mode === 'name' ? matcher.normalizedName : ''),
  };
}

export function resolveEpisodeBoundaries(
  recordsByDate: Map<string, DailyRecordEntity>,
  matcher: PatientMatcher,
  anchorDate: string,
): IEpisodeBoundaries | null {
  if (recordsByDate.size === 0) {
    return null;
  }

  const { earliest, latest, rangeEnd } = getSortedDateBounds(
    recordsByDate,
    anchorDate,
  );

  if (classifyDay(recordsByDate.get(anchorDate), matcher) === 'other') {
    return null;
  }

  const zoneStart = expandZoneStart(
    anchorDate,
    earliest,
    recordsByDate,
    matcher,
  );
  const zoneEnd = expandZoneEnd(
    anchorDate,
    rangeEnd,
    latest,
    recordsByDate,
    matcher,
  );
  const matchRange = findMatchDateRange(
    zoneStart,
    zoneEnd,
    recordsByDate,
    matcher,
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
    displayName: matchRange.displayName,
  };
}

function episodeKey(episode: IEpisodeBoundaries): string {
  return `${episode.startDate}:${episode.endDate}`;
}

export function findAllEpisodes(
  recordsByDate: Map<string, DailyRecordEntity>,
  matcher: PatientMatcher,
): IEpisodeBoundaries[] {
  const sortedDates = [...recordsByDate.keys()].sort();
  const episodes: IEpisodeBoundaries[] = [];
  const seen = new Set<string>();
  let cursor = 0;

  while (cursor < sortedDates.length) {
    const date = sortedDates[cursor];
    const status = classifyDay(recordsByDate.get(date), matcher);

    if (status === 'match') {
      const boundaries = resolveEpisodeBoundaries(recordsByDate, matcher, date);

      if (boundaries) {
        const key = episodeKey(boundaries);

        if (!seen.has(key)) {
          seen.add(key);
          episodes.push(boundaries);
        }

        while (
          cursor < sortedDates.length &&
          sortedDates[cursor] <= boundaries.zoneEnd
        ) {
          cursor += 1;
        }

        continue;
      }
    }

    cursor += 1;
  }

  return episodes.sort((left, right) =>
    right.startDate.localeCompare(left.startDate),
  );
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

export function buildPatientDailyRows(
  recordsByDate: Map<string, DailyRecordEntity>,
  startDate: string,
  endDate: string,
  filter: IPatientDailyRowFilter,
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
      morning:
        record && shiftBelongsToPatient(record, 'morning', filter)
          ? toVitalsPoint(
              record.morningPatientName,
              record.morningPulse,
              record.morningTemp,
              record.morningBp,
              record.morningNote,
              toEnteredByDto(record.morningEnteredByUser),
            )
          : null,
      evening:
        record && shiftBelongsToPatient(record, 'evening', filter)
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
      (accumulated.tempValues.length > 0 &&
        Math.max(...accumulated.tempValues)) ||
      null,
    minTemp:
      (accumulated.tempValues.length > 0 &&
        Math.min(...accumulated.tempValues)) ||
      null,
  };
}

export function normalizePatientCodeField(
  code: string | null | undefined,
): string | null {
  const trimmed = code?.trim();

  return trimmed || null;
}

export function extractPatientCodeFromEpisode(
  recordsByDate: Map<string, DailyRecordEntity>,
  startDate: string,
  endDate: string,
): string | null {
  for (
    let cursor = startDate;
    cursor <= endDate;
    cursor = getNextYmdVN(cursor)
  ) {
    const record = recordsByDate.get(cursor);

    if (!record) {
      continue;
    }

    const code =
      normalizePatientCodeField(record.morningPatientCode) ??
      normalizePatientCodeField(record.eveningPatientCode);

    if (code) {
      return code;
    }
  }

  return null;
}
