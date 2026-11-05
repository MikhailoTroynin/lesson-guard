import type { Grade } from '../../core/types';

/** Оцінка в уроці (Embed.Rates) — як її віддає api.eschool-ua.com. */
export interface EsRate {
  Id: number;
  Subject?: string | null;
  Rate?: number | null;
  RateValue?: string | null;
  RateType?: string | null;
  Missing?: number | null;
  Topic?: string | null;
  Description?: string | null;
  SchoolboyDescription?: string | null;
  Date?: string | null;
  AppointmentDate?: string | null;
  Summary?: boolean | null;
}

/** Урок (Appointment) з розкладу учня. */
export interface EsAppointment {
  Id: number;
  Subject?: string | null;
  Date: string;
  Embed?: {
    Rates?: EsRate[] | null;
    Topics?: { Title?: string | null }[] | null;
  } | null;
}

/** Перетворює уроки з API щоденника на оцінки для перевірки. */
export function appointmentsToGrades(items: EsAppointment[]): Grade[] {
  const out = new Map<string, Grade>();
  for (const a of items) {
    for (const r of a.Embed?.Rates ?? []) {
      if (!r) continue;
      const raw = (r.RateValue ?? (r.Rate != null ? String(r.Rate) : '')).trim() || (r.Missing ? 'н' : '');
      if (!raw) continue;
      const subject = (a.Subject ?? r.Subject ?? '').trim();
      if (!subject) continue;
      const topic = (r.Topic ?? a.Embed?.Topics?.[0]?.Title ?? '').trim();
      const comment = (r.Description ?? r.SchoolboyDescription ?? '').trim();
      out.set(`es:${r.Id}`, {
        id: `es:${r.Id}`,
        subject,
        raw,
        date: (r.AppointmentDate ?? r.Date ?? a.Date).slice(0, 10),
        lessonTopic: topic || undefined,
        workType: (r.RateType ?? '').trim() || (r.Summary ? 'Підсумкова' : undefined),
        comment: comment || undefined,
      });
    }
  }
  return [...out.values()].sort((x, y) => x.date.localeCompare(y.date));
}
