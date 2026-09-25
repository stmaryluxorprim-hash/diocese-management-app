'use client';

// ---------- Birthdays module (أعياد الميلاد) — client data layer ----------
// The month view is ONE RPC (`birthdays_in_month`, security invoker → RLS)
// returning one row per person with his greetings of that year and the
// gift state. Greetings (call / whatsapp / sms / card) are plain inserts
// into `birthday_greetings`; the points gift is the `birthday_gift` RPC
// (one per person per year, enforced in the DB).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { CardDesign, CardPrintSettings } from '@/lib/card-types';
import { ARABIC_MONTHS } from '@/lib/card-types';
import type { CardPersonData } from '@/components/cards/CardCanvas';
import { ALL, type ScopeSelection } from '@/lib/queries';

// ---------- types ----------
export type GreetingKind = 'call' | 'whatsapp' | 'sms' | 'card_printed' | 'card_shared' | 'gift' | 'note';

export const GREETING_LABELS: Record<GreetingKind, string> = {
  call: 'مكالمة',
  whatsapp: 'واتساب',
  sms: 'رسالة SMS',
  card_printed: 'كارت مطبوع',
  card_shared: 'كارت مُرسَل',
  gift: 'هدية نقاط',
  note: 'ملاحظة',
};

export interface BirthdayGreeting {
  id: string;
  kind: GreetingKind;
  created_at: string;
  points: number | null;
  message: string | null;
  recorded_by: string | null;
  recorded_by_name: string | null;
}

/** one row of `birthdays_in_month` */
export interface BirthdayRow {
  enrollment_id: string;
  person_id: string;
  church_id: string;
  service_id: string;
  class_id: string;
  national_id: string;
  name: string;
  birthdate: string;          // yyyy-mm-dd
  gender: 'male' | 'female' | null;
  phone: string | null;
  address: string | null;
  image_url: string | null;
  points: number;
  attendance_count: number;
  birth_day: number;
  birth_month: number;
  turns_age: number;
  greetings: BirthdayGreeting[];
  gift_points: number | null;
  enrollments_count: number;
}

/** one row of `birthdays_upcoming` */
export interface UpcomingBirthday {
  enrollment_id: string;
  person_id: string;
  church_id: string;
  service_id: string;
  class_id: string;
  name: string;
  phone: string | null;
  image_url: string | null;
  birthdate: string;
  next_birthday: string;
  days_left: number;
  turns_age: number;
}

export interface BirthdayCardTemplate {
  id: string;
  church_id: string;
  service_id: string | null;
  class_id: string | null;
  name: string;
  design: CardDesign;
  print_settings: CardPrintSettings;
  is_default: boolean;
  created_at: string;
  created_by: string | null;
  edited_at: string;
  edited_by: string | null;
}

export interface BirthdaySettings {
  id: string;
  church_id: string | null;   // null = global (owner)
  gift_points: number;
  message_template: string;
  edited_at: string;
  edited_by: string | null;
}

export const DEFAULT_MESSAGE_TEMPLATE =
  'كل سنة وأنت طيب يا [الاسم الأول] 🎂🎉 عيد ميلاد سعيد وربنا يفرّح قلبك — أسرة [اسم الفصل] · [اسم الكنيسة]';
export const DEFAULT_GIFT_POINTS = 10;

// ---------- error mapping ----------
export const MIGRATION_HINT = 'تحتاج تشغيل تحديث قاعدة البيانات 0028_birthdays.sql في Supabase أولاً';

export function isMigrationMissing(err: unknown): boolean {
  const msg = (err as { message?: string } | null)?.message ?? '';
  return /birthday_greetings|birthday_card_templates|birthday_settings|birthdays_in_month|birthdays_upcoming|birthday_gift/.test(msg) &&
    /does not exist|not find|schema cache|relation/i.test(msg);
}

const ERRORS: [string, string][] = [
  ['module_not_visible', 'وحدة أعياد الميلاد غير مفعّلة لنطاقك'],
  ['enrollment_not_found', 'المخدوم غير موجود'],
  ['invalid_points', 'عدد النقاط غير صالح'],
  ['already_gifted', 'هذا المخدوم أخذ هدية عيد ميلاده لهذه السنة بالفعل'],
  ['not_found', 'الهدية غير موجودة'],
  ['forbidden', 'ليس لديك صلاحية على هذه العملية'],
];

export function birthdayErrorMessage(err: unknown, fallback = 'حدث خطأ، حاول مجدداً'): string {
  const msg = (err as { message?: string } | null)?.message ?? '';
  if (!msg) return fallback;
  if (isMigrationMissing(err)) return MIGRATION_HINT;
  if ((err as { code?: string } | null)?.code === '23505') return 'هذا المخدوم أخذ هدية عيد ميلاده لهذه السنة بالفعل';
  for (const [key, label] of ERRORS) if (msg.includes(key)) return label;
  return fallback;
}

// ---------- fetchers ----------
const scopeArgs = (scope: ScopeSelection) => ({
  p_church: scope.church && scope.church !== ALL ? scope.church : null,
  p_service: scope.service && scope.service !== ALL ? scope.service : null,
  p_class: scope.class && scope.class !== ALL ? scope.class : null,
});

export async function fetchBirthdaysInMonth(
  supabase: SupabaseClient, year: number, month: number, scope: ScopeSelection = {}
): Promise<BirthdayRow[]> {
  // Set-returning RPCs are cut at PostgREST `max_rows` (1000) like tables —
  // page through so a big church's month (or the printing tab) gets everyone.
  const out: BirthdayRow[] = [];
  const size = 500;
  for (let from = 0; ; from += size) {
    const { data, error } = await supabase
      .rpc('birthdays_in_month', { p_year: year, p_month: month, ...scopeArgs(scope) })
      .range(from, from + size - 1);
    if (error) throw error;
    const rows = (data ?? []) as BirthdayRow[];
    out.push(...rows);
    if (rows.length < size) break;
  }
  return out.map((r) => ({ ...r, greetings: (r.greetings ?? []) as BirthdayGreeting[] }));
}

export async function fetchUpcomingBirthdays(
  supabase: SupabaseClient, days = 7, today?: string
): Promise<UpcomingBirthday[]> {
  const { data, error } = await supabase.rpc('birthdays_upcoming', { p_days: days, p_today: today ?? null });
  if (error) throw error;
  return (data ?? []) as UpcomingBirthday[];
}

export async function fetchBirthdayTemplates(supabase: SupabaseClient): Promise<BirthdayCardTemplate[]> {
  const { data, error } = await supabase
    .from('birthday_card_templates').select('*')
    .order('is_default', { ascending: false }).order('name');
  if (error) throw error;
  return (data ?? []) as BirthdayCardTemplate[];
}

export async function fetchBirthdaySettings(supabase: SupabaseClient): Promise<BirthdaySettings[]> {
  const { data, error } = await supabase.from('birthday_settings').select('*');
  if (error) throw error;
  return (data ?? []) as BirthdaySettings[];
}

/** effective settings for a church: church row → global row → defaults */
export function effectiveSettings(rows: BirthdaySettings[], churchId: string | null): { gift_points: number; message_template: string } {
  const church = churchId ? rows.find((r) => r.church_id === churchId) : undefined;
  const global = rows.find((r) => r.church_id === null);
  const pick = church ?? global;
  return {
    gift_points: pick?.gift_points ?? DEFAULT_GIFT_POINTS,
    message_template: pick?.message_template ?? DEFAULT_MESSAGE_TEMPLATE,
  };
}

/** Which template applies to this child? most specific scope wins, then default flag */
export function templateFor(
  templates: BirthdayCardTemplate[],
  e: { church_id: string; service_id: string; class_id: string }
): BirthdayCardTemplate | null {
  const fits = templates.filter((t) =>
    t.church_id === e.church_id &&
    (t.service_id === null || t.service_id === e.service_id) &&
    (t.class_id === null || t.class_id === e.class_id));
  fits.sort((a, b) =>
    Number(b.class_id !== null) - Number(a.class_id !== null) ||
    Number(b.service_id !== null) - Number(a.service_id !== null) ||
    Number(b.is_default) - Number(a.is_default) ||
    b.created_at.localeCompare(a.created_at));
  return fits[0] ?? null;
}

// ---------- mutations ----------
export async function logGreeting(
  supabase: SupabaseClient,
  row: { enrollment_id: string },
  year: number,
  kind: Exclude<GreetingKind, 'gift'>,
  message: string | null = null,
  recordedBy?: string
): Promise<void> {
  const { error } = await supabase.from('birthday_greetings').insert({
    enrollment_id: row.enrollment_id, year, kind, message, recorded_by: recordedBy,
  });
  if (error) throw error;
}

export async function deleteGreeting(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from('birthday_greetings').delete().eq('id', id);
  if (error) throw error;
}

export interface GiftResult { greeting_id: string; points_log_id: string; points: number; balance_after: number }

export async function giveBirthdayGift(
  supabase: SupabaseClient, enrollmentId: string, year: number, points: number, note?: string
): Promise<GiftResult> {
  const { data, error } = await supabase.rpc('birthday_gift', {
    p_enrollment: enrollmentId, p_year: year, p_points: points, p_note: note?.trim() || null,
  });
  if (error) throw error;
  return data as GiftResult;
}

export async function cancelBirthdayGift(supabase: SupabaseClient, greetingId: string): Promise<void> {
  const { error } = await supabase.rpc('birthday_gift_cancel', { p_greeting: greetingId });
  if (error) throw error;
}

// ---------- helpers ----------
export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? '';

/** «5 مارس» */
export const birthdayLabel = (r: { birth_day: number; birth_month: number }) =>
  `${r.birth_day} ${ARABIC_MONTHS[r.birth_month - 1]}`;

/** Arabic day-of-week for (year, month, day) */
export const weekdayLabel = (year: number, month: number, day: number) =>
  new Date(year, month - 1, day).toLocaleDateString('ar-EG', { weekday: 'long' });

/** Egyptian phone → wa.me number (2 + 01xxxxxxxxx) */
export const waNumber = (phone: string) => {
  const digits = phone.replace(/\D/g, '');
  return digits.startsWith('0') ? `2${digits}` : digits;
};

export const MSG_VARS = [
  { token: '[الاسم الأول]', label: 'الاسم الأول' },
  { token: '[الاسم الكامل]', label: 'الاسم الكامل' },
  { token: '[السن]', label: 'السن الجديدة' },
  { token: '[تاريخ العيد]', label: 'يوم وشهر العيد' },
  { token: '[اسم الفصل]', label: 'اسم الفصل' },
  { token: '[اسم الخدمة]', label: 'اسم الخدمة' },
  { token: '[اسم الكنيسة]', label: 'اسم الكنيسة' },
  { token: '[نقاط الهدية]', label: 'نقاط الهدية' },
];

export function fillBirthdayTemplate(
  template: string,
  r: BirthdayRow,
  names: { church: string; service: string; class: string },
  giftPoints: number | null
): string {
  return template
    .replaceAll('[الاسم الأول]', firstName(r.name))
    .replaceAll('[الاسم الكامل]', r.name)
    .replaceAll('[السن]', String(r.turns_age))
    .replaceAll('[تاريخ العيد]', birthdayLabel(r))
    .replaceAll('[اسم الفصل]', names.class)
    .replaceAll('[اسم الخدمة]', names.service)
    .replaceAll('[اسم الكنيسة]', names.church)
    .replaceAll('[نقاط الهدية]', giftPoints != null ? String(giftPoints) : '');
}

/** BirthdayRow → the data the card canvas renders */
export const rowToCardPerson = (r: BirthdayRow, year: number): CardPersonData => ({
  name: r.name,
  national_id: r.national_id,
  birthdate: r.birthdate,
  phone: r.phone,
  address: r.address,
  image_url: r.image_url,
  birthday_year: year,
  gift_points: r.gift_points,
});

/** sample child for the designer preview */
export const SAMPLE_BIRTHDAY_PERSON: CardPersonData = {
  name: 'مينا جرجس عبد المسيح',
  national_id: '30001011234567',
  birthdate: '2015-06-15',
  phone: '01234567890',
  address: 'الأقصر',
  image_url: null,
  birthday_year: new Date().getFullYear(),
  gift_points: DEFAULT_GIFT_POINTS,
};

/** did the row get a greeting of one of these kinds this year? */
export const hasGreeting = (r: BirthdayRow, kinds: GreetingKind[]) =>
  r.greetings.some((g) => kinds.includes(g.kind));

/** was he contacted at all (call / whatsapp / sms)? */
export const wasContacted = (r: BirthdayRow) => hasGreeting(r, ['call', 'whatsapp', 'sms']);

// ---------- ICS export (calendar) ----------
export function buildBirthdaysICS(rows: BirthdayRow[], year: number, calendarName = 'أعياد ميلاد المخدومين'): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Diocese Management//Birthdays//AR',
    `X-WR-CALNAME:${esc(calendarName)}`, 'CALSCALE:GREGORIAN',
  ];
  for (const r of rows) {
    const d = `${year}${pad(r.birth_month)}${pad(r.birth_day)}`;
    const next = new Date(year, r.birth_month - 1, r.birth_day + 1);
    const dEnd = `${next.getFullYear()}${pad(next.getMonth() + 1)}${pad(next.getDate())}`;
    lines.push(
      'BEGIN:VEVENT',
      `UID:birthday-${r.person_id}-${year}@diocese.app`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${d}`,
      `DTEND;VALUE=DATE:${dEnd}`,
      'RRULE:FREQ=YEARLY',
      `SUMMARY:${esc(`🎂 عيد ميلاد ${r.name}`)}`,
      `DESCRIPTION:${esc(`يتم ${r.turns_age} سنة${r.phone ? ` — ${r.phone}` : ''}`)}`,
      'BEGIN:VALARM', 'TRIGGER:-PT9H', 'ACTION:DISPLAY', `DESCRIPTION:${esc(`عيد ميلاد ${r.name}`)}`, 'END:VALARM',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

export function downloadText(filename: string, text: string, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
