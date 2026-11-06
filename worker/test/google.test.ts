import { describe, expect, it } from 'vitest';
import { loadGoogle, saveGoogle, serverClient } from '../src/google';
import { Vault } from '../src/vault';
import { FakeD1 } from './d1';

describe('OAuth-клієнт Google: секрети Worker’а чи сторінка', () => {
  const vault = () => new Vault(new FakeD1().d1, '123:TEST');

  it('без секретів — клієнт зі сторінки, з секретами — серверний', async () => {
    const v = vault();
    expect(await loadGoogle(v)).toBeNull();
    expect(serverClient({ GOOGLE_CLIENT_ID: 'a', GOOGLE_CLIENT_SECRET: '' })).toBeNull();

    await saveGoogle(v, { client_id: 'page.apps.googleusercontent.com', client_secret: 'ps', refresh_token: 'rt', email: 'kid@x', source: 'page' });
    expect(JSON.parse((await v.get('google_oauth'))!)).not.toHaveProperty('source');
    expect(await loadGoogle(v)).toMatchObject({ client_id: 'page.apps.googleusercontent.com', refresh_token: 'rt', source: 'page' });

    // Серверний клієнт інший — refresh token від старого не береться.
    const env = { GOOGLE_CLIENT_ID: ' srv.apps.googleusercontent.com ', GOOGLE_CLIENT_SECRET: 'ss' };
    expect(await loadGoogle(v, env)).toEqual({
      client_id: 'srv.apps.googleusercontent.com',
      client_secret: 'ss',
      refresh_token: undefined,
      email: null,
      connected_at: undefined,
      source: 'server',
    });

    // Після входу серверним клієнтом refresh token зберігається під його client_id.
    await saveGoogle(v, { ...(await loadGoogle(v, env))!, refresh_token: 'rt2', email: 'kid@y', connected_at: 't' });
    expect(await loadGoogle(v, env)).toMatchObject({ refresh_token: 'rt2', email: 'kid@y', source: 'server' });
    // Секрети прибрали → лишається клієнт зі сховища (він тепер серверний id, без page-секрету це нормально).
    expect((await loadGoogle(v))?.source).toBe('page');
  });
});
