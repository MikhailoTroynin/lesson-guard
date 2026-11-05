const WEEKDAYS = ['нд', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

/** "пн, 03.11" з ISO-дати або YYYY-MM-DD. */
export function formatDay(iso: string): string {
  const d = new Date(iso.length === 10 ? iso + 'T12:00:00' : iso);
  if (Number.isNaN(d.getTime())) return iso;
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${WEEKDAYS[d.getDay()]}, ${dd}.${mm}`;
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${formatDay(iso)} ${hh}:${mi}`;
}
