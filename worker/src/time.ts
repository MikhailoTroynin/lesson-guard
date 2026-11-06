/** Час у форматі SQLite datetime('now'): 'YYYY-MM-DD HH:MM:SS' (UTC). */
export function sqlTime(d: Date): string {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}
