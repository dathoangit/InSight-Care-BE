import { buildBedNames } from './bed-name.utils';

describe('buildBedNames', () => {
  it('returns A/B suffixes for two-bed numeric rooms', () => {
    expect(buildBedNames('1', 2)).toEqual(['1A', '1B']);
    expect(buildBedNames('10', 2)).toEqual(['10A', '10B']);
  });

  it('returns room name for single-bed rooms', () => {
    expect(buildBedNames('6', 1)).toEqual(['6']);
    expect(buildBedNames('16', 1)).toEqual(['16']);
  });

  it('returns cc1-cc4 for CC rooms', () => {
    expect(buildBedNames('CC', 4)).toEqual(['cc1', 'cc2', 'cc3', 'cc4']);
  });

  it('returns A/B suffixes for lettered rooms with two beds', () => {
    expect(buildBedNames('5A', 2)).toEqual(['5AA', '5AB']);
    expect(buildBedNames('12A', 2)).toEqual(['12AA', '12AB']);
  });

  it('returns empty array for zero beds', () => {
    expect(buildBedNames('1', 0)).toEqual([]);
  });
});
