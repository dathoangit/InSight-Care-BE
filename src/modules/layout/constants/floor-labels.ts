export const HOSPITAL_FLOOR_LABELS = [
  '1-9',
  'CC-15',
  '16-25',
  '26-31',
] as const;

export type HospitalFloorLabel = (typeof HOSPITAL_FLOOR_LABELS)[number];

/* eslint-disable @typescript-eslint/naming-convention -- legacy floor numbers and display labels */
export const LEGACY_FLOOR_TO_LABEL: Record<number, HospitalFloorLabel> = {
  2: '1-9',
  3: 'CC-15',
  4: '16-25',
  5: '26-31',
};

export const FLOOR_LABEL_TO_LEGACY: Record<HospitalFloorLabel, number> = {
  '1-9': 2,
  'CC-15': 3,
  '16-25': 4,
  '26-31': 5,
};
/* eslint-enable @typescript-eslint/naming-convention */

export function compareFloorLabels(left: string, right: string): number {
  const leftIndex = HOSPITAL_FLOOR_LABELS.indexOf(left as HospitalFloorLabel);
  const rightIndex = HOSPITAL_FLOOR_LABELS.indexOf(right as HospitalFloorLabel);

  if (leftIndex !== -1 && rightIndex !== -1) {
    return leftIndex - rightIndex;
  }

  if (leftIndex !== -1) {
    return -1;
  }

  if (rightIndex !== -1) {
    return 1;
  }

  return left.localeCompare(right, 'vi');
}

export function sortFloorLabels(floors: Iterable<string>): string[] {
  return [...new Set(floors)].sort(compareFloorLabels);
}
