import { describe, expect, it } from 'vitest';
import { parseCommand } from '../src/commands';

describe('parseCommand', () => {
  it('розбирає просту команду', () => {
    expect(parseCommand('/start')).toEqual({ name: 'start', args: '' });
  });
  it('розбирає аргументи й обрізає пробіли', () => {
    expect(parseCommand('  /link   ABCDE-FGHJK  ')).toEqual({ name: 'link', args: 'ABCDE-FGHJK' });
  });
  it('прибирає @бот і нижній регістр', () => {
    expect(parseCommand('/Unlink@LessonGuardBot Олена Петренко')).toEqual({
      name: 'unlink',
      args: 'Олена Петренко',
      botUsername: 'LessonGuardBot',
    });
  });
  it('аргументи на новому рядку', () => {
    expect(parseCommand('/link\nABCDE')).toEqual({ name: 'link', args: 'ABCDE' });
  });
  it('не команда', () => {
    expect(parseCommand('привіт')).toBeNull();
    expect(parseCommand('')).toBeNull();
    expect(parseCommand(undefined)).toBeNull();
    expect(parseCommand('/')).toBeNull();
    expect(parseCommand('/старт')).toBeNull();
    expect(parseCommand('/linkABC-')).toBeNull();
  });
});
