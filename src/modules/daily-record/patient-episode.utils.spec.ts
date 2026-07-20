import { businessDayStartUtc } from '../../common/vietnam-date';
import { type DailyRecordEntity } from './entities/daily-record.entity';
import {
  buildChartSeries,
  buildDailyRows,
  buildPatientDailyRows,
  buildRecordsByDate,
  classifyDay,
  countShiftsWithVitals,
  createCodeMatcher,
  createNameMatcher,
  findAllEpisodes,
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
    morningPatientCode: null,
    eveningPatientCode: null,
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
          createNameMatcher('nguyễn văn a'),
        ),
      ).toBe('match');
    });

    it('returns other when a different patient is recorded', () => {
      expect(
        classifyDay(
          record('2026-06-01', { eveningPatientName: 'Trần Thị B' }),
          createNameMatcher('Nguyễn Văn A'),
        ),
      ).toBe('other');
    });

    it('returns empty when no names are recorded', () => {
      expect(
        classifyDay(record('2026-06-01'), createNameMatcher('Nguyễn Văn A')),
      ).toBe('empty');
    });

    it('returns match when shift code matches', () => {
      expect(
        classifyDay(
          record('2026-06-01', {
            morningPatientName: 'Nguyễn Văn A',
            morningPatientCode: '1234567890',
          }),
          createCodeMatcher('1234567890'),
        ),
      ).toBe('match');
    });

    it('returns other when a different patient code is recorded', () => {
      expect(
        classifyDay(
          record('2026-06-01', { eveningPatientCode: '9999999999' }),
          createCodeMatcher('1234567890'),
        ),
      ).toBe('other');
    });

    it('returns empty when code is missing on both shifts', () => {
      expect(
        classifyDay(
          record('2026-06-01', { morningPatientName: 'Nguyễn Văn A' }),
          createCodeMatcher('1234567890'),
        ),
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
        createNameMatcher('Nguyễn Văn A'),
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
        createNameMatcher('Nguyễn Văn A'),
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
        createNameMatcher('Nguyễn Văn A'),
        '2026-06-01',
      );
      const secondEpisode = resolveEpisodeBoundaries(
        recordsByDate,
        createNameMatcher('Nguyễn Văn A'),
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
          createNameMatcher('Nguyễn Văn A'),
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
          createNameMatcher('Nguyễn Văn A'),
          '2026-06-02',
        ),
      ).toBeNull();
    });
  });

  describe('findAllEpisodes', () => {
    it('finds multiple admissions for the same patient code', () => {
      const recordsByDate = buildRecordsByDate([
        record('2026-06-01', {
          morningPatientName: 'Nguyễn Văn A',
          morningPatientCode: '1234567890',
        }),
        record('2026-06-02', {
          morningPatientName: 'Trần Thị B',
          morningPatientCode: '9999999999',
        }),
        record('2026-06-03', {
          morningPatientName: 'Nguyễn Văn A',
          morningPatientCode: '1234567890',
        }),
      ]);

      const episodes = findAllEpisodes(
        recordsByDate,
        createCodeMatcher('1234567890'),
      );

      expect(episodes).toHaveLength(2);
      expect(episodes[0]?.startDate).toBe('2026-06-03');
      expect(episodes[1]?.startDate).toBe('2026-06-01');
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

  describe('buildPatientDailyRows', () => {
    it('filters shifts by patient code and admission id', () => {
      const admissionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as Uuid;
      const dailyRows = buildPatientDailyRows(
        buildRecordsByDate([
          record('2026-06-01', {
            morningPatientName: 'Nguyễn Văn A',
            morningPatientCode: '1234567890',
            morningPulse: 72,
            morningPatientAdmissionId: admissionId,
            eveningPatientName: 'Trần Thị B',
            eveningPatientCode: '9999999999',
            eveningPulse: 80,
          }),
        ]),
        '2026-06-01',
        '2026-06-01',
        {
          admissionId,
          matcher: createCodeMatcher('1234567890'),
        },
      );

      expect(dailyRows[0]?.morning?.pulse).toBe(72);
      expect(dailyRows[0]?.evening).toBeNull();
    });
  });
});
