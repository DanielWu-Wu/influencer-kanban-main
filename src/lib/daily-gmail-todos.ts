export const DAILY_GMAIL_LOOKBACK_HOURS = 72;

const HOUR_MS = 60 * 60 * 1000;

export function isWithinDailyGmailWindow(
  dateValue: string,
  now: number = Date.now(),
) {
  const timestamp = Date.parse(dateValue);
  if (Number.isNaN(timestamp)) return false;

  const age = now - timestamp;
  return age >= 0 && age <= DAILY_GMAIL_LOOKBACK_HOURS * HOUR_MS;
}
