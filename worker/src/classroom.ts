/**
 * Google Клас з Worker'а: Classroom API + Drive API за OAuth-токеном дитини.
 *
 * На безкоштовному тарифі Cloudflare один запуск Worker'а може зробити лише 50
 * зовнішніх запитів. Тому курси читаються по черзі (спершу ті, що найдовше не
 * оновлювались), а результат кожного курсу і перевірки файлів кешується між
 * запусками. Якщо ліміт закінчився, решта курсів оновиться наступного разу,
 * а в даних лишаються їхні попередні версії.
 */
import type { Assignment, Attachment, Submission, SubmissionState } from '../../src/core/types';
import { htmlHasImages, meaningfulLength, pptxHasMedia } from '../../src/providers/classroom/google';

const CLASSROOM = 'https://classroom.googleapis.com/v1';
const DRIVE = 'https://www.googleapis.com/drive/v3';
const LOOKBACK_DAYS = 45;
const DAY_MS = 86_400_000;

const GOOGLE_EXPORT: Record<string, string> = {
  'application/vnd.google-apps.document': 'text/plain',
  'application/vnd.google-apps.presentation': 'text/plain',
  'application/vnd.google-apps.spreadsheet': 'text/csv',
};

export class BudgetExceeded extends Error {
  constructor() {
    super('ліміт запитів на один запуск вичерпано');
    this.name = 'BudgetExceeded';
  }
}

/** fetch із лічильником зовнішніх запитів (ліміт Cloudflare на один запуск). */
export class Budget {
  constructor(
    public left: number,
    private base: typeof fetch = (i, init) => fetch(i, init),
  ) {}

  fetch: typeof fetch = (input, init) => {
    if (this.left <= 0) return Promise.reject(new BudgetExceeded());
    this.left--;
    // Worker не підтримує credentials (і cookie-сховища в нього немає) — прибираємо.
    if (init && 'credentials' in init) {
      const { credentials: _ignored, ...rest } = init as RequestInit & { credentials?: unknown };
      init = rest;
    }
    return this.base(input, init);
  };
}

export class GoogleApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'GoogleApiError';
  }
}

interface CachedFile {
  /** updateTime здачі, для якої файл перевірено. */
  key: string;
  mimeType?: string;
  textLength?: number | null;
  sizeBytes?: number | null;
  hasImages?: boolean;
}

export interface ClassroomCache {
  courses: Record<string, { name: string; fetchedAt: string; assignments: Assignment[]; submissions: Submission[] }>;
  files: Record<string, CachedFile>;
}

export const emptyClassroomCache = (): ClassroomCache => ({ courses: {}, files: {} });

export interface ClassroomResult {
  assignments: Assignment[];
  submissions: Submission[];
  cache: ClassroomCache;
  /** Скільки курсів оновлено в цьому запуску і скільки всього. */
  refreshed: number;
  total: number;
}

interface GDate {
  year: number;
  month: number;
  day: number;
}
interface GAttachment {
  driveFile?: { id: string; title?: string; alternateLink?: string };
  link?: { url: string; title?: string };
  youTubeVideo?: { id: string; title?: string };
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

const gDate = (d?: GDate) =>
  d?.year ? `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}` : undefined;

export async function collectClassroom(opts: {
  token: string;
  budget: Budget;
  cache: ClassroomCache;
  now: Date;
  /** Скільки запитів лишити для інших справ (Telegram). */
  reserve: number;
}): Promise<ClassroomResult> {
  const { token, budget, now, reserve } = opts;
  const cache: ClassroomCache = { courses: { ...opts.cache.courses }, files: { ...opts.cache.files } };
  const since = now.getTime() - LOOKBACK_DAYS * DAY_MS;

  async function get(url: string, as: 'json' | 'text' | 'bytes' = 'json'): Promise<any> {
    const res = await budget.fetch(url, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const detail = ((await res.json().catch(() => null)) as { error?: { message?: string } } | null)?.error?.message;
      throw new GoogleApiError(res.status, `Google API ${res.status}: ${detail || res.statusText}`);
    }
    return as === 'bytes' ? res.arrayBuffer() : as === 'text' ? res.text() : res.json();
  }

  async function paged<T>(url: string, key: string, maxPages = 5): Promise<T[]> {
    const out: T[] = [];
    let pageToken: string | undefined;
    for (let i = 0; i < maxPages; i++) {
      const sep = url.includes('?') ? '&' : '?';
      const page = await get(pageToken ? `${url}${sep}pageToken=${encodeURIComponent(pageToken)}` : url);
      out.push(...((page[key] as T[]) ?? []));
      pageToken = page.nextPageToken;
      if (!pageToken) break;
    }
    return out;
  }

  async function inspect(att: Attachment): Promise<void> {
    const meta = await get(`${DRIVE}/files/${att.id}?fields=mimeType,size&supportsAllDrives=true`);
    att.mimeType = meta.mimeType;
    const exportType = GOOGLE_EXPORT[meta.mimeType];
    if (exportType) {
      const text: string = await get(`${DRIVE}/files/${att.id}/export?mimeType=${encodeURIComponent(exportType)}`, 'text');
      att.textLength = meaningfulLength(text);
      if (att.textLength === 0 && budget.left > reserve) {
        try {
          if (meta.mimeType === 'application/vnd.google-apps.document') {
            att.hasImages = htmlHasImages(await get(`${DRIVE}/files/${att.id}/export?mimeType=text%2Fhtml`, 'text'));
          } else if (meta.mimeType === 'application/vnd.google-apps.presentation') {
            const pptx = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
            att.hasImages = pptxHasMedia(await get(`${DRIVE}/files/${att.id}/export?mimeType=${encodeURIComponent(pptx)}`, 'bytes'));
          }
        } catch (e) {
          if (e instanceof BudgetExceeded) throw e;
        }
      }
    } else if (meta.size !== undefined) {
      att.sizeBytes = Number(meta.size);
    }
  }

  async function toSubmission(s: GSubmission): Promise<Submission> {
    const state: SubmissionState = s.state === 'SUBMISSION_STATE_UNSPECIFIED' ? 'NEW' : s.state;
    const turnedIn = state === 'TURNED_IN' || state === 'RETURNED';
    const attachments: Attachment[] = [];
    for (const a of s.assignmentSubmission?.attachments ?? []) {
      if (a.driveFile) {
        const att: Attachment = { kind: 'driveFile', id: a.driveFile.id, title: a.driveFile.title, url: a.driveFile.alternateLink };
        if (turnedIn) {
          const hit = cache.files[a.driveFile.id];
          if (hit && hit.key === s.updateTime) {
            Object.assign(att, { mimeType: hit.mimeType, textLength: hit.textLength, sizeBytes: hit.sizeBytes, hasImages: hit.hasImages });
          } else if (budget.left > reserve + 1) {
            try {
              await inspect(att);
              cache.files[a.driveFile.id] = {
                key: s.updateTime,
                mimeType: att.mimeType,
                textLength: att.textLength,
                sizeBytes: att.sizeBytes,
                hasImages: att.hasImages,
              };
            } catch (e) {
              if (e instanceof BudgetExceeded) throw e;
              att.textLength = null; // не прочитали — не вважаємо порожнім
            }
          }
          // Інакше лишаємо невідомим: перевіримо наступного запуску.
        }
        attachments.push(att);
      } else if (a.link) attachments.push({ kind: 'link', url: a.link.url, title: a.link.title });
      else if (a.youTubeVideo) attachments.push({ kind: 'youtube', id: a.youTubeVideo.id, title: a.youTubeVideo.title });
      else if (a.form) attachments.push({ kind: 'form', url: a.form.formUrl, title: a.form.title });
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

  const courses = await paged<{ id: string; name: string; section?: string }>(
    `${CLASSROOM}/courses?studentId=me&courseStates=ACTIVE&pageSize=100`,
    'courses',
  );
  const active = new Set(courses.map((c) => c.id));
  for (const id of Object.keys(cache.courses)) if (!active.has(id)) delete cache.courses[id];

  const order = [...courses].sort((a, b) =>
    (cache.courses[a.id]?.fetchedAt ?? '').localeCompare(cache.courses[b.id]?.fetchedAt ?? ''),
  );
  let refreshed = 0;
  for (const course of order) {
    if (budget.left < reserve + 2) break;
    const name = course.section ? `${course.name} ${course.section}` : course.name;
    try {
      const work = await paged<{
        id: string;
        title: string;
        creationTime: string;
        dueDate?: GDate;
        alternateLink?: string;
      }>(`${CLASSROOM}/courses/${course.id}/courseWork?orderBy=updateTime%20desc&pageSize=50`, 'courseWork', 2);
      const recent = work.filter((w) => Date.parse(w.creationTime) >= since);
      const assignments: Assignment[] = recent.map((w) => ({
        id: w.id,
        courseId: course.id,
        courseName: name,
        title: w.title,
        createdAt: w.creationTime,
        dueDate: gDate(w.dueDate),
        link: w.alternateLink,
      }));
      const submissions: Submission[] = [];
      if (recent.length) {
        const ids = new Set(recent.map((w) => w.id));
        const subs = await paged<GSubmission>(
          `${CLASSROOM}/courses/${course.id}/courseWork/-/studentSubmissions?userId=me&pageSize=100`,
          'studentSubmissions',
          3,
        );
        for (const s of subs) if (ids.has(s.courseWorkId)) submissions.push(await toSubmission(s));
      }
      cache.courses[course.id] = { name, fetchedAt: now.toISOString(), assignments, submissions };
      refreshed++;
    } catch (e) {
      if (e instanceof BudgetExceeded) break;
      // Окремий курс може бути недоступний (наприклад, архівується) — решту читаємо далі.
      console.warn(`Classroom: курс ${course.id}: ${e instanceof Error ? e.message : e}`);
      if (e instanceof GoogleApiError && e.status === 401) throw e;
    }
  }

  // Прибираємо з кешу файли, яких уже немає в жодній здачі.
  const all = Object.values(cache.courses);
  const usedFiles = new Set(all.flatMap((c) => c.submissions.flatMap((s) => s.attachments.map((a) => a.id ?? ''))));
  for (const id of Object.keys(cache.files)) if (!usedFiles.has(id)) delete cache.files[id];

  const assignments = all.flatMap((c) => c.assignments).filter((a) => Date.parse(a.createdAt) >= since);
  const keep = new Set(assignments.map((a) => a.id));
  return {
    assignments,
    submissions: all.flatMap((c) => c.submissions).filter((s) => keep.has(s.assignmentId)),
    cache,
    refreshed,
    total: courses.length,
  };
}
