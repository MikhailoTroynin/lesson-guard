import { describe, expect, it } from 'vitest';

import { classroomOpen, tunnelUrlFrom } from './remote-login';

describe('віддалений вхід у Google', () => {
  it('знаходить адресу тунелю в лозі cloudflared', () => {
    const log = '2026 INF |  https://quiet-river-12ab.trycloudflare.com  |\nINF Registered';
    expect(tunnelUrlFrom(log)).toBe('https://quiet-river-12ab.trycloudflare.com');
    expect(tunnelUrlFrom('starting…')).toBeNull();
  });

  it('бачить відкритий Google Клас лише у вкладках-сторінках', () => {
    expect(classroomOpen([{ type: 'page', url: 'https://classroom.google.com/u/0/h' }])).toBe(true);
    expect(classroomOpen([{ type: 'page', url: 'https://accounts.google.com/signin' }])).toBe(false);
    expect(classroomOpen([{ type: 'service_worker', url: 'https://classroom.google.com/sw.js' }])).toBe(false);
    expect(classroomOpen([{ type: 'page', url: 'chrome://newtab/' }, { url: 'bad url' }])).toBe(false);
  });
});
