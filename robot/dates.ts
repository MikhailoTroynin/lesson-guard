/**
 * Розбір дат, як їх показує вебінтерфейс Google Класу українською або англійською:
 * «3 лист.», «3 листопада 2025 р.», «Nov 3», «Nov 3, 2025», «Сьогодні», «Yesterday», «10:15».
 */

const MONTHS: [RegExp, number][] = [
  [/^(січ|jan)/i, 1],
  [/^(лют|feb)/i, 2],
  [/^(бер|mar)/i, 3],
  [/^(кві|apr)/i, 4],
  [/^(тра|may)/i, 5],
  [/^(чер|jun)/i, 6],
  [/^(лип|jul)/i, 7],
  [/^(сер|aug)/i, 8],
  [/^(вер|sep)/i, 9],
  [/^(жов|oct)/i, 10],
  [/^(лис|nov)/i, 11],
  [/^(гру|dec)/i, 12],
];

function month(word: string): number | null {
  for (const [re, n] of MONTHS) if (re.test(word)) return n;
  return null;
}

function ymd(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Дата в часовому поясі Києва (робот працює в UTC). */
export function kyivDay(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' }).format(d);
}

function shift(day: string, days: number): string {
  const t = new Date(`${day}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

export function parseHumanDate(text: string, now: Date): string | undefined {
  const t = text.trim().toLowerCase();
  const today = kyivDay(now);
  if (/^(сьогодні|today)/.test(t)) return today;
  if (/^(вчора|yesterday)/.test(t)) return shift(today, -1);
  if (/^(завтра|tomorrow)/.test(t)) return shift(today, 1);
  if (/^\d{1,2}:\d{2}/.test(t)) return today;

  const [cy, cm] = today.split('-').map(Number);
  let d: number | undefined;
  let m: number | null = null;
  let y: number | undefined;

  // «3 лист.», «3 листопада 2025 р.»
  let r = /^(\d{1,2})\s+([a-zа-яіїєґ]+)\.?(?:,?\s+(\d{4}))?/i.exec(t);
  if (r) {
    d = Number(r[1]);
    m = month(r[2]);
    y = r[3] ? Number(r[3]) : undefined;
  } else {
    // «Nov 3», «Nov 3, 2025»
    r = /^([a-zа-яіїєґ]+)\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?/i.exec(t);
    if (r) {
      m = month(r[1]);
      d = Number(r[2]);
      y = r[3] ? Number(r[3]) : undefined;
    }
  }
  if (!d || !m || d > 31) return undefined;
  if (y === undefined) {
    y = cy;
    // Без року і «у майбутньому» на кілька місяців — це торішня дата.
    if (m > cm + 2) y -= 1;
  }
  return ymd(y, m, d);
}

/** Шукає у тексті сторінки «Опубліковано: …» / «Posted …». */
export function findPostedDate(text: string, now: Date): string | undefined {
  const r = /(?:опубліковано|posted|додано|створено)\s*:?\s*([^\n(·•]+)/i.exec(text);
  return r ? parseHumanDate(r[1], now) : undefined;
}

/** Шукає у тексті сторінки «Термін: …» / «Due …». */
export function findDueDate(text: string, now: Date): string | undefined {
  const r = /(?:термін(?:\s+здачі)?|due)\s*:?\s*([^\n(·•]+)/i.exec(text);
  if (!r || /без терміну|no due/i.test(r[0])) return undefined;
  return parseHumanDate(r[1], now);
}
