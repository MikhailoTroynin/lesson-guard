/**
 * Мінімальна реалізація D1Database поверх node:sqlite для тестів:
 * застосовує справжні міграції з migrations/ і вмикає foreign_keys, як у D1.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

type Value = string | number | bigint | null | Uint8Array;

class Stmt {
  constructor(
    private readonly db: DatabaseSync,
    readonly sql: string,
    readonly params: Value[] = [],
  ) {}

  bind(...values: unknown[]): Stmt {
    for (const v of values) {
      if (v === undefined) throw new Error('D1_TYPE_ERROR: undefined is not supported');
    }
    return new Stmt(this.db, this.sql, values as Value[]);
  }

  exec(): { results: Record<string, unknown>[]; meta: { changes: number } } {
    const results = this.db.prepare(this.sql).all(...this.params) as Record<string, unknown>[];
    const { c } = this.db.prepare('SELECT changes() AS c').get() as { c: number };
    return { results: results.map((r) => ({ ...r })), meta: { changes: c } };
  }

  async all() {
    const r = this.exec();
    return { success: true, ...r };
  }
  async run() {
    return this.all();
  }
  async first(col?: string) {
    const row = this.exec().results[0] ?? null;
    if (row && col) return row[col] ?? null;
    return row;
  }
}

export class FakeD1 {
  readonly sqlite: DatabaseSync;

  constructor() {
    this.sqlite = new DatabaseSync(':memory:');
    this.sqlite.exec('PRAGMA foreign_keys = ON');
    const dir = join(import.meta.dirname, '..', 'migrations');
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) {
      this.sqlite.exec(readFileSync(join(dir, f), 'utf8'));
    }
  }

  prepare(sql: string): Stmt {
    return new Stmt(this.sqlite, sql);
  }

  async batch(stmts: Stmt[]) {
    this.sqlite.exec('BEGIN');
    try {
      const out = stmts.map((s) => ({ success: true, ...s.exec() }));
      this.sqlite.exec('COMMIT');
      return out;
    } catch (e) {
      this.sqlite.exec('ROLLBACK');
      throw e;
    }
  }

  /** Зручний синхронний запит для перевірок у тестах. */
  rows<T = Record<string, unknown>>(sql: string, ...params: Value[]): T[] {
    return this.sqlite.prepare(sql).all(...params) as T[];
  }

  get d1(): D1Database {
    return this as unknown as D1Database;
  }
}
