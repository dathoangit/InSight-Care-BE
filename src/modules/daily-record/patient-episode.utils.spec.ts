import { businessDayStartUtc } from '../../common/vietnam-date';
import { type DailyRecordEntity } from './entities/daily-record.entity';
import {
  buildChartSeries,
  buildDailyRows,
  buildRecordsByDate,
  classifyDay,
  countShiftsWithVitals,
  normalizePatientName,
  parseBloodPressure,
  resolveEpisodeBoundaries,
  shiftHasVitals,
} from './patient-episode.utils';

function record(
  dateYmd: string,
  fields: Partial<DailyRecordEntity> = {},
): DailyRecordEntity {
  return {
    businessDayAt: businessDayStartUtc(dateYmd),
    morningPatientName: null,
    eveningPatientName: null,
    morningPulse: null,
    morningTemp: null,
    morningBp: null,
    morningNote: null,
    eveningPulse: null,
    eveningTemp: null,
    eveningBp: null,
    eveningNote: null,
    isLocked: false,
    ...fields,
  } as DailyRecordEntity;
}

describe('patient-episode.utils', () => {
  describe('normalizePatientName', () => {
    it('trims and lowercases', () => {
      expect(normalizePatientName('  Nguyễn Văn A  ')).toBe('nguyễn văn a');
    });
  });

  describe('parseBloodPressure', () => {
    it('parses valid BP', () => {
      expect(parseBloodPressure('120/80')).toEqual({
        systolic: 120,
        diastolic: 80,
      });
    });

    it('returns null for invalid BP', () => {
      expect(parseBloodPressure('invalid')).toEqual({
        systolic: null,
        diastolic: null,
      });
    });
  });

  describe('classifyDay', () => {
    it('returns match when shift name matches', () => {
      expect(
        classifyDay(
          record('2026-06-01', { morningPatientName: 'Nguyễn Văn A' }),
          normalizePatientName('nguyễn văn a'),
        ),
      ).toBe('match');
    });

    it('returns other when a different patient is recorded', () => {
      expect(
        classifyDay(
          record('2026-06-01', { eveningPatientName: 'Trần Thị B' }),
          normalizePatientName('Nguyễn Văn A'),
        ),
      ).toBe('other');
    });

    it('returns empty when no names are recorded', () => {
      expect(
        classifyDay(record('2026-06-01'), normalizePatientName('Nguyễn Văn A')),
      ).toBe('empty');
    });
  });

  describe('resolveEpisodeBoundaries', () => {
    it('resolves a continuous episode with anchor in the middle', () => {
      const recordsByDate = buildRecordsByDate([
        record('2026-06-01', { morningPatientName: 'Nguyễn Văn A' }),
        record('2026-06-02', { eveningPatientName: 'Nguyễn Văn A' }),
        record('2026-06-03', { morningPatientName: 'Nguyễn Văn A' }),
        record('2026-06-04', { morningPatientName: 'Nguyễn Văn A' }),
        record('2026-06-05', { eveningPatientName: 'Nguyễn Văn A' }),
      ]);

      const boundaries = resolveEpisodeBoundaries(
        recordsByDate,
        normalizePatientName('Nguyễn Văn A'),
        '2026-06-03',
      );

      expect(boundaries).toEqual({
        zoneStart: '2026-06-01',
        zoneEnd: '2026-06-05',
        startDate: '2026-06-01',
        endDate: '2026-06-05',
        displayName: 'Nguyễn Văn A',
      });
    });

    it('keeps one episode when a gap day has no patient name', () => {
      const recordsByDate = buildRecordsByDate([
        record('2026-06-01', { morningPatientName: 'Nguyễn Văn A' }),
        record('2026-06-02'),
        record('2026-06-03', { eveningPatientName: 'Nguyễn Văn A' }),
      ]);

      const boundaries = resolveEpisodeBoundaries(
        recordsByDate,
        normalizePatientName('Nguyễn Văn A'),
        '2026-06-02',
      );

      expect(boundaries?.startDate).toBe('2026-06-01');
      expect(boundaries?.endDate).toBe('2026-06-03');
    });

    it('splits episodes when another patient appears between stays', () => {
      const recordsByDate = buildRecordsByDate([
        record('2026-06-01', { morningPatientName: 'Nguyễn Văn A' }),
        record('2026-06-02', { morningPatientName: 'Trần Thị B' }),
        record('2026-06-03', { morningPatientName: 'Nguyễn Văn A' }),
      ]);

      const firstEpisode = resolveEpisodeBoundaries(
        recordsByDate,
        normalizePatientName('Nguyễn Văn A'),
        '2026-06-01',
      );
      const secondEpisode = resolveEpisodeBoundaries(
        recordsByDate,
        normalizePatientName('Nguyễn Văn A'),
        '2026-06-03',
      );

      expect(firstEpisode?.startDate).toBe('2026-06-01');
      expect(firstEpisode?.endDate).toBe('2026-06-01');
      expect(secondEpisode?.startDate).toBe('2026-06-03');
      expect(secondEpisode?.endDate).toBe('2026-06-03');
    });

    it('returns null when anchor is on another patient day', () => {
      const recordsByDate = buildRecordsByDate([
        record('2026-06-01', { morningPatientName: 'Trần Thị B' }),
      ]);

      expect(
        resolveEpisodeBoundaries(
          recordsByDate,
          normalizePatientName('Nguyễn Văn A'),
          '2026-06-01',
        ),
      ).toBeNull();
    });

    it('returns null when no matching patient exists', () => {
      const recordsByDate = buildRecordsByDate([
        record('2026-06-01', { morningPatientName: 'Trần Thị B' }),
      ]);

      expect(
        resolveEpisodeBoundaries(
          recordsByDate,
          normalizePatientName('Nguyễn Văn A'),
          '2026-06-02',
        ),
      ).toBeNull();
    });
  });

  describe('buildChartSeries', () => {
    it('builds chart points from daily rows', () => {
      const dailyRows = buildDailyRows(
        buildRecordsByDate([
          record('2026-06-01', {
            morningPatientName: 'Nguyễn Văn A',
            morningPulse: 72,
            morningTemp: 36.8,
            morningBp: '120/80',
          }),
        ]),
        '2026-06-01',
        '2026-06-01',
      );

      const chartSeries = buildChartSeries(dailyRows);

      expect(chartSeries.pulse).toEqual([
        { date: '2026-06-01', shift: 'morning', value: 72 },
      ]);
      expect(chartSeries.temperature).toEqual([
        { date: '2026-06-01', shift: 'morning', value: 36.8 },
      ]);
      expect(chartSeries.bpSystolic).toEqual([
        { date: '2026-06-01', shift: 'morning', value: 120 },
      ]);
      expect(chartSeries.bpDiastolic).toEqual([
        { date: '2026-06-01', shift: 'morning', value: 80 },
      ]);
    });
  });

  describe('countShiftsWithVitals', () => {
    it('counts morning and evening separately', () => {
      const dailyRows = buildDailyRows(
        buildRecordsByDate([
          record('2026-06-01', {
            morningPatientName: 'Nguyễn Văn A',
            morningPulse: 72,
            eveningPatientName: 'Nguyễn Văn A',
            eveningPulse: 74,
          }),
          record('2026-06-02', {
            morningPatientName: 'Nguyễn Văn A',
            morningPulse: 70,
            eveningPatientName: 'Nguyễn Văn A',
            eveningPulse: 71,
          }),
        ]),
        '2026-06-01',
        '2026-06-02',
      );

      expect(countShiftsWithVitals(dailyRows)).toBe(4);
    });

    it('counts shifts with note-only data', () => {
      const dailyRows = buildDailyRows(
        buildRecordsByDate([
          record('2026-06-01', {
            morningPatientName: 'Nguyễn Văn A',
            morningNote: 'Theo dõi sốt',
          }),
        ]),
        '2026-06-01',
        '2026-06-01',
      );

      expect(countShiftsWithVitals(dailyRows)).toBe(1);
      expect(shiftHasVitals(dailyRows[0]?.morning ?? null)).toBe(true);
    });
  });
});
