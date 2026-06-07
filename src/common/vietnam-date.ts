const VN_TIMEZONE = 'Asia/Ho_Chi_Minh';

export function getTodayYmdVN(reference = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: VN_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(reference);
}

export function getYesterdayYmdVN(reference = new Date()): string {
  const todayYmd = getTodayYmdVN(reference);
  const [year, month, day] = todayYmd.split('-').map(Number);
  const utcDate = new Date(Date.UTC(year, month - 1, day));
  utcDate.setUTCDate(utcDate.getUTCDate() - 1);

  return utcDate.toISOString().slice(0, 10);
}
