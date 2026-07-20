const VN_TIMEZONE = 'Asia/Ho_Chi_Minh';
const VN_UTC_OFFSET = '+07:00';

export type VitalsShift = 'morning' | 'evening';

export function getTodayYmdVN(reference = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: VN_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(reference);
}

export function getVnHour(reference = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: VN_TIMEZONE,
    hour: 'numeric',
    hour12: false,
  }).formatToParts(reference);

  const hourPart = parts.find((part) => part.type === 'hour');
  const hour = Number.parseInt(hourPart?.value ?? '0', 10);

  return Number.isFinite(hour) ? hour : 0;
}

export function getEditableShift(reference = new Date()): VitalsShift {
  return getVnHour(reference) < 12 ? 'morning' : 'evening';
}

export function getPreviousYmdVN(dateYmd: string): string {
  const [year, month, day] = dateYmd.split('-').map(Number);
  const utcDate = new Date(Date.UTC(year, month - 1, day));
  utcDate.setUTCDate(utcDate.getUTCDate() - 1);

  return utcDate.toISOString().slice(0, 10);
}

export function getNextYmdVN(dateYmd: string): string {
  const [year, month, day] = dateYmd.split('-').map(Number);
  const utcDate = new Date(Date.UTC(year, month - 1, day));
  utcDate.setUTCDate(utcDate.getUTCDate() + 1);

  return utcDate.toISOString().slice(0, 10);
}

export function offsetYmdVN(dateYmd: string, dayOffset: number): string {
  let cursor = dateYmd;

  if (dayOffset > 0) {
    for (let index = 0; index < dayOffset; index += 1) {
      cursor = getNextYmdVN(cursor);
    }
  } else if (dayOffset < 0) {
    for (let index = 0; index < -dayOffset; index += 1) {
      cursor = getPreviousYmdVN(cursor);
    }
  }

  return cursor;
}

export function getYesterdayYmdVN(reference = new Date()): string {
  return getPreviousYmdVN(getTodayYmdVN(reference));
}

/** Midnight at the start of a VN business day, stored as UTC instant. */
export function businessDayStartUtc(dateYmd: string): Date {
  return new Date(`${dateYmd}T00:00:00${VN_UTC_OFFSET}`);
}

/** Exclusive end of a VN business day (start of the next VN day). */
export function businessDayEndUtc(dateYmd: string): Date {
  return businessDayStartUtc(getNextYmdVN(dateYmd));
}

export function formatBusinessDayYmd(instant: Date): string {
  return getTodayYmdVN(instant);
}

export function isValidYmd(dateYmd: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateYmd)) {
    return false;
  }

  const [year, month, day] = dateYmd.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}
