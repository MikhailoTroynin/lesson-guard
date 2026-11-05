import type { Assignment, Attachment, Submission, SubmissionState } from '../../core/types';
import type { ClassroomData, ClassroomProvider } from '../types';

const CLASSROOM = 'https://classroom.googleapis.com/v1';
const DRIVE = 'https://www.googleapis.com/drive/v3';

/** OAuth-скоупи, які потрібні додатку (лише читання). */
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/classroom.courses.readonly',
  'https://www.googleapis.com/auth/classroom.coursework.me.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
];

/** Скільки днів назад дивитися на завдання. */
const LOOKBACK_DAYS = 45;

const GOOGLE_EXPORT: Record<string, string> = {
  'application/vnd.google-apps.document': 'text/plain',
  'application/vnd.google-apps.presentation': 'text/plain',
  'application/vnd.google-apps.spreadsheet': 'text/csv',
};

type FetchFn = typeof fetch;

export class GoogleApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'GoogleApiError';
  }
}

interface GDate {
  year: number;
  month: number;
  day: number;
}

interface GCourse {
  id: string;
  name: string;
  section?: string;
}

interface GCourseWork {
  id: string;
  courseId: string;
  title: string;
  creationTime: string;
  dueDate?: GDate;
  alternateLink?: string;
  state?: string;
}

interface GAttachment {
  driveFile?: { id: string; title?: string; alternateLink?: string };
  link?: { url: string; title?: string };
  youTubeVideo?: { id: string; title?: string; alternateLink?: string };
  form?: { formUrl: string; title?: string };
}

interface GSubmission {
  id: string;
  courseId: string;
  courseWorkId: string;
  state: SubmissionState | 'SUBMISSION_STATE_UNSPECIFIED';
  updateTime: string;
  late?: boolean;
  assignmentSubmission?: { attachments?: GAttachment[] };
  shortAnswerSubmission?: { answer?: string };
  multipleChoiceSubmission?: { answer?: string };
}

function gDate(d?: GDate): string | undefined {
  if (!d?.year) return undefined;
  return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
}

/** У HTML-експорті Google-документа є картинки. */
export function htmlHasImages(html: string): boolean {
  return /<img\b/i.test(html);
}

/** У PPTX (zip) є медіафайли: імена файлів у zip лежать відкритим текстом. */
export function pptxHasMedia(bytes: ArrayBuffer): boolean {
  const b = new Uint8Array(bytes);
  const needle = [...'ppt/media/'].map((c) => c.charCodeAt(0));
  outer: for (let i = 0; i + needle.length <= b.length; i++) {
    for (let k = 0; k < needle.length; k++) if (b[i + k] !== needle[k]) continue outer;
    return true;
  }
  return false;
}

/** Скільки значущих символів у тексті (без пробілів і роздільників CSV). */
export function meaningfulLength(text: string): number {
  return text.replace(/^﻿/, '').replace(/[\s,;"]+/g, '').length;
}

export interface GoogleClassroomOptions {
  getAccessToken: () => Promise<string>;
  /** Викликається при 401: скинути закешований токен перед повторною спробою. */
  invalidateToken?: (token: string) => Promise<void>;
  fetchFn?: FetchFn;
  now?: () => Date;
}

/** Читає курси, завдання та здачі дитини через Classroom API, а вміст файлів — через Drive API. */
export class GoogleClassroomProvider implements ClassroomProvider {
  private fetchFn: FetchFn;
  private now: () => Date;

  constructor(private opts: GoogleClassroomOptions) {
    // Обгортка: у браузері fetch, викликаний як метод іншого об’єкта, падає з «Illegal invocation».
    this.fetchFn = opts.fetchFn ?? ((input, init) => fetch(input, init));
    this.now = opts.now ?? (() => new Date());
  }

  private async request(url: string, as: boolean | 'bytes' = false): Promise<any> {
    const asText = as === true;
    let token = await this.opts.getAccessToken();
    let res = await this.fetchFn(url, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 401 && this.opts.invalidateToken) {
      await this.opts.invalidateToken(token);
      token = await this.opts.getAccessToken();
      res = await this.fetchFn(url, { headers: { Authorization: `Bearer ${token}` } });
    }
    if (!res.ok) {
      let detail = '';
      try {
        detail = (await res.json())?.error?.message ?? '';
      } catch {
        // ignore
      }
      throw new GoogleApiError(res.status, `Google API ${res.status}: ${detail || res.statusText}`);
    }
    return as === 'bytes' ? res.arrayBuffer() : asText ? res.text() : res.json();
  }

  private async paged<T>(url: string, key: string): Promise<T[]> {
    const out: T[] = [];
    let pageToken: string | undefined;
    for (let i = 0; i < 20; i++) {
      const sep = url.includes('?') ? '&' : '?';
      const page = await this.request(pageToken ? `${url}${sep}pageToken=${pageToken}` : url);
      out.push(...((page[key] as T[]) ?? []));
      pageToken = page.nextPageToken;
      if (!pageToken) break;
    }
    return out;
  }

  async fetch(): Promise<ClassroomData> {
    const courses = await this.paged<GCourse>(
      `${CLASSROOM}/courses?studentId=me&courseStates=ACTIVE&pageSize=50`,
      'courses',
    );
    const since = this.now().getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
    const assignments: Assignment[] = [];
    const submissions: Submission[] = [];

    for (const course of courses) {
      const name = course.section ? `${course.name} ${course.section}` : course.name;
      const work = await this.paged<GCourseWork>(
        `${CLASSROOM}/courses/${course.id}/courseWork?orderBy=updateTime%20desc&pageSize=50`,
        'courseWork',
      );
      const recent = work.filter((w) => Date.parse(w.creationTime) >= since);
      for (const w of recent) {
        assignments.push({
          id: w.id,
          courseId: course.id,
          courseName: name,
          title: w.title,
          createdAt: w.creationTime,
          dueDate: gDate(w.dueDate),
          link: w.alternateLink,
        });
      }
      if (recent.length === 0) continue;
      const recentIds = new Set(recent.map((w) => w.id));
      const subs = await this.paged<GSubmission>(
        `${CLASSROOM}/courses/${course.id}/courseWork/-/studentSubmissions?userId=me&pageSize=100`,
        'studentSubmissions',
      );
      for (const s of subs) {
        if (!recentIds.has(s.courseWorkId)) continue;
        submissions.push(await this.toSubmission(s));
      }
    }
    return { assignments, submissions };
  }

  private async toSubmission(s: GSubmission): Promise<Submission> {
    const state: SubmissionState = s.state === 'SUBMISSION_STATE_UNSPECIFIED' ? 'NEW' : s.state;
    const turnedIn = state === 'TURNED_IN' || state === 'RETURNED';
    const attachments: Attachment[] = [];
    for (const a of s.assignmentSubmission?.attachments ?? []) {
      if (a.driveFile) {
        const att: Attachment = {
          kind: 'driveFile',
          id: a.driveFile.id,
          title: a.driveFile.title,
          url: a.driveFile.alternateLink,
        };
        // Вміст читаємо лише для зданих робіт — саме їх перевіряємо на порожнечу.
        if (turnedIn) await this.inspectDriveFile(att);
        attachments.push(att);
      } else if (a.link) {
        attachments.push({ kind: 'link', url: a.link.url, title: a.link.title });
      } else if (a.youTubeVideo) {
        attachments.push({ kind: 'youtube', id: a.youTubeVideo.id, title: a.youTubeVideo.title });
      } else if (a.form) {
        attachments.push({ kind: 'form', url: a.form.formUrl, title: a.form.title });
      }
    }
    return {
      id: s.id,
      assignmentId: s.courseWorkId,
      courseId: s.courseId,
      state,
      updatedAt: s.updateTime,
      late: s.late,
      attachments,
      shortAnswer: s.shortAnswerSubmission?.answer,
      multipleChoiceAnswer: s.multipleChoiceSubmission?.answer,
    };
  }

  /** Тексту немає — перевіряємо, чи є картинки. Помилка тут не робить файл «невідомим». */
  private async checkImages(att: Attachment, mimeType: string): Promise<void> {
    try {
      if (mimeType === 'application/vnd.google-apps.document') {
        const html: string = await this.request(`${DRIVE}/files/${att.id}/export?mimeType=text%2Fhtml`, true);
        att.hasImages = htmlHasImages(html);
      } else if (mimeType === 'application/vnd.google-apps.presentation') {
        const pptx = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
        const bytes: ArrayBuffer = await this.request(
          `${DRIVE}/files/${att.id}/export?mimeType=${encodeURIComponent(pptx)}`,
          'bytes',
        );
        att.hasImages = pptxHasMedia(bytes);
      }
    } catch {
      // лишаємо як є
    }
  }

  /** Заповнює textLength/sizeBytes. Якщо файл прочитати не вдалося — лишає невідомим. */
  private async inspectDriveFile(att: Attachment): Promise<void> {
    try {
      const meta = await this.request(
        `${DRIVE}/files/${att.id}?fields=mimeType,size&supportsAllDrives=true`,
      );
      att.mimeType = meta.mimeType;
      const exportType = GOOGLE_EXPORT[meta.mimeType];
      if (exportType) {
        const text: string = await this.request(
          `${DRIVE}/files/${att.id}/export?mimeType=${encodeURIComponent(exportType)}`,
          true,
        );
        att.textLength = meaningfulLength(text);
        if (att.textLength === 0) await this.checkImages(att, meta.mimeType);
      } else if (meta.size !== undefined) {
        att.sizeBytes = Number(meta.size);
      }
    } catch {
      att.textLength = null;
    }
  }
}
