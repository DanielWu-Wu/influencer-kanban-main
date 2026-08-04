const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function formatLocalDateKey(date: Date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parseLocalDateKey(value: string) {
  const match = value.match(DATE_KEY_PATTERN);
  if (!match) return new Date(value);
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

export function isSameLocalDay(left: Date, right: Date) {
  return formatLocalDateKey(left) === formatLocalDateKey(right);
}
