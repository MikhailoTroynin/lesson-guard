import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { decryptText, encryptText, fromBase64, toBase64, utf8Decode, utf8Encode, WrongPassphraseError } from './snapshot';

const rnd = (n: number) => new Uint8Array(randomBytes(n));

describe('base64', () => {
  it('round-trips every length and matches Node', () => {
    for (let len = 0; len < 40; len++) {
      const bytes = rnd(len);
      const b64 = toBase64(bytes);
      expect(b64).toBe(Buffer.from(bytes).toString('base64'));
      expect([...fromBase64(b64)]).toEqual([...bytes]);
    }
  });
});

describe('utf8', () => {
  it('matches Node for Cyrillic, emoji and ASCII', () => {
    const s = 'Оцінка 5 — «Дроби» ✅ 😀 abc';
    expect([...utf8Encode(s)]).toEqual([...Buffer.from(s, 'utf8')]);
    expect(utf8Decode(new Uint8Array(Buffer.from(s, 'utf8')))).toBe(s);
  });
});

describe('snapshot encryption', () => {
  it('decrypts with the right passphrase', () => {
    const env = encryptText('{"привіт":"світ"}', 'correct horse', rnd, 1000);
    expect(decryptText(env, 'correct horse')).toBe('{"привіт":"світ"}');
  });

  it('rejects a wrong passphrase', () => {
    const env = encryptText('secret', 'one', rnd, 1000);
    expect(() => decryptText(env, 'two')).toThrow(WrongPassphraseError);
  });

  it('uses a fresh salt and iv each time', () => {
    const a = encryptText('x', 'p', rnd, 1000);
    const b = encryptText('x', 'p', rnd, 1000);
    expect(a.salt).not.toBe(b.salt);
    expect(a.data).not.toBe(b.data);
  });
});
