import { describe, expect, it } from 'vitest';

import { emptySubmissionReason } from '../src/core/rules';
import { cardState, linkToAttachment } from './classroom';
import { appointmentsToGrades } from './eschool';

describe('appointmentsToGrades', () => {
  it('maps lesson rates from the diary API', () => {
    const grades = appointmentsToGrades([
      {
        Id: 1,
        Subject: 'Математика',
        Date: '2026-11-04T00:00:00',
        Embed: {
          Rates: [
            { Id: 10, RateValue: '5', RateType: 'Самостійна робота', Topic: 'Дроби' },
            { Id: 11, Missing: 1 },
          ],
          Topics: [{ Title: 'Звичайні дроби' }],
        },
      },
      { Id: 2, Subject: 'Історія', Date: '2026-11-03', Embed: { Rates: [{ Id: 12, Rate: 11, Description: 'Молодець' }] } },
      { Id: 3, Subject: 'Фізика', Date: '2026-11-03', Embed: { Rates: [{ Id: 13 }] } },
    ]);
    expect(grades).toEqual([
      { id: 'es:12', subject: 'Історія', raw: '11', date: '2026-11-03', comment: 'Молодець' },
      { id: 'es:10', subject: 'Математика', raw: '5', date: '2026-11-04', lessonTopic: 'Дроби', workType: 'Самостійна робота' },
      { id: 'es:11', subject: 'Математика', raw: 'н', date: '2026-11-04', lessonTopic: 'Звичайні дроби' },
    ]);
  });
});

describe('Classroom "Your work" card', () => {
  it.each([
    ['Ваша робота\nЗдано\nСкасувати здачу', 'TURNED_IN', false],
    ['Your work\nTurned in late\nUnsubmit', 'TURNED_IN', true],
    ['Ваша робота\nПовернуто\n10/12', 'RETURNED', false],
    ['Ваша робота\nПризначено\nДодати або створити\nЗдати', 'CREATED', false],
    ['Ваша робота\nНе здано\nЗдати', 'CREATED', false],
    ['Your work\nMissing\nTurn in', 'CREATED', false],
  ])('%j → %s', (text, state, late) => {
    expect(cardState(text)).toEqual({ state, late });
  });

  it('classifies attachment links', () => {
    expect(linkToAttachment('https://docs.google.com/document/d/abc_1/edit?usp=drive_web', 'Твір')).toMatchObject({
      kind: 'driveFile',
      id: 'abc_1',
      mimeType: 'application/vnd.google-apps.document',
      title: 'Твір',
    });
    expect(linkToAttachment('https://drive.google.com/file/d/XYZ/view', 'photo.jpg')).toMatchObject({
      kind: 'driveFile',
      id: 'XYZ',
    });
    expect(linkToAttachment('https://www.youtube.com/watch?v=1', '').kind).toBe('youtube');
    expect(linkToAttachment('https://docs.google.com/forms/d/e/1/viewform', '').kind).toBe('form');
    expect(linkToAttachment('https://example.com', '').kind).toBe('link');
  });

  it('a placeholder for an unread card never counts as empty', () => {
    expect(
      emptySubmissionReason({
        id: 's',
        assignmentId: 'a',
        courseId: 'c',
        state: 'TURNED_IN',
        updatedAt: '2026-11-05T00:00:00Z',
        attachments: [{ kind: 'link', title: 'не перевірено' }],
      }),
    ).toBeNull();
  });
});

describe('image detection', () => {
  it('finds images in HTML and PPTX', async () => {
    const { htmlHasImages, pptxHasMedia } = await import('../src/providers/classroom/google');
    expect(htmlHasImages('<p></p><img src="x">')).toBe(true);
    expect(htmlHasImages('<p> </p>')).toBe(false);
    const zip = (s: string) => new Uint8Array(Buffer.from(`PK\x03\x04....${s}....`, 'latin1')).buffer;
    expect(pptxHasMedia(zip('ppt/media/image1.png'))).toBe(true);
    expect(pptxHasMedia(zip('ppt/slides/slide1.xml'))).toBe(false);
  });
});
