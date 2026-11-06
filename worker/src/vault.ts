/**
 * Зашифроване сховище в D1 (таблиця vault): AES-256-GCM, ключ =
 * HMAC-SHA256(TELEGRAM_BOT_TOKEN, VAULT_KEY_LABEL). Якщо змінити токен бота,
 * старі записи не розшифруються — get() поверне null, і їх треба ввести заново.
 */
import { VAULT_KEY_LABEL } from './crypto';

export type VaultName =
  | 'eschool_login'
  | 'eschool_password'
  | 'eschool_token'
  | 'google_session'
  | 'google_email'
  | 'google_password'
  | 'google_oauth'
  | 'robot_state'
  | 'robot_snapshot'
  | 'snapshot'
  | 'check_state'
  | 'classroom_cache';

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function unb64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

async function vaultKey(botToken: string): Promise<CryptoKey> {
  const hk = await crypto.subtle.importKey('raw', enc.encode(botToken), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const raw = await crypto.subtle.sign('HMAC', hk, enc.encode(VAULT_KEY_LABEL));
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export class Vault {
  private key: Promise<CryptoKey>;

  constructor(
    private db: D1Database,
    botToken: string,
  ) {
    this.key = vaultKey(botToken);
  }

  async set(name: VaultName, value: string | null): Promise<void> {
    if (value === null) {
      await this.db.prepare('DELETE FROM vault WHERE name = ?').bind(name).run();
      return;
    }
    const iv = crypto.getRandomValues(new Uint8Array(12));
    // Ім'я запису — додаткові автентифіковані дані: запис не можна підмінити іншим.
    const data = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: enc.encode(name) },
      await this.key,
      enc.encode(value),
    );
    await this.db
      .prepare(
        `INSERT INTO vault (name, iv, data, updated_at) VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT (name) DO UPDATE SET iv = excluded.iv, data = excluded.data, updated_at = excluded.updated_at`,
      )
      .bind(name, b64(iv), b64(new Uint8Array(data)))
      .run();
  }

  async get(name: VaultName): Promise<string | null> {
    const row = await this.db
      .prepare('SELECT iv, data FROM vault WHERE name = ?')
      .bind(name)
      .first<{ iv: string; data: string }>();
    if (!row) return null;
    try {
      const plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: unb64(row.iv), additionalData: enc.encode(name) },
        await this.key,
        unb64(row.data),
      );
      return dec.decode(plain);
    } catch {
      console.warn(`vault: запис ${name} не розшифровано (змінився токен бота?)`);
      return null;
    }
  }

  /** Які записи є і коли оновлені (без розшифрування). */
  async list(): Promise<Record<string, string>> {
    const { results } = await this.db.prepare('SELECT name, updated_at FROM vault').all<{ name: string; updated_at: string }>();
    return Object.fromEntries(results.map((r) => [r.name, r.updated_at]));
  }
}
