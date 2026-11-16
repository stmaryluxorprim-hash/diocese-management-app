'use client';

// ---------- Online classes module (الفصول الأونلاين) — client data layer ----------
// Classes / questions are plain CRUD on `online_classes` / `online_class_questions`
// (RLS gated by module_visible('online') + scope). Participants, sessions,
// check responses and answers are READ-ONLY through the API — the child
// writes them only through the SECURITY DEFINER child_online_* RPCs
// (migration 0030). Servant RPCs: online_class_start / end / finalize /
// reopen / send_check / set_override / live_stats / messages_list.

import type { SupabaseClient } from '@supabase/supabase-js';
import { ALL, type ScopeSelection } from '@/lib/queries';
import { classIdsOf } from '@/lib/class-multi';

// ---------- Types ----------
export type OnlineClassStatus = 'scheduled' | 'live' | 'ended' | 'cancelled';
export type StreamPlatform = 'youtube' | 'facebook' | 'zoom' | 'meet' | 'other';
export type LiveQuestionStatus = 'draft' | 'open' | 'closed';
export type AttendanceStatus = 'present' | 'absent';

export interface OnlineClass {
  id: string;
  church_id: string;
  service_id: string | null;
  class_id: string | null;
  title: string;
  description: string | null;
  starts_at: string;
  ends_at: string;
  platform: StreamPlatform;
  stream_url: string | null;
  status: OnlineClassStatus;
  started_at: string | null;
  ended_at: string | null;
  chat_enabled: boolean;
  exam_id: string | null;
  event_id: string | null;
  min_time_percent: number;
  checks_required: number;
  checks_min_success: number;
  min_answers: number;
  check_seconds: number;
  attendance_points: number;
  finalized_at: string | null;
  created_at: string;
  created_by: string | null;
  edited_at: string;
  edited_by: string | null;
}

export type OnlineClassInput = Omit<OnlineClass, 'id' | 'status' | 'started_at' | 'ended_at' | 'finalized_at' | 'created_at' | 'created_by' | 'edited_at' | 'edited_by'>;

export interface LiveQuestion {
  id: string;
  class_id: string;
  sort_order: number;
  text: string;
  options: string[] | null;       // null = free text
  correct_index: number | null;
  points: number;
  status: LiveQuestionStatus;
  opened_at: string | null;
  closed_at: string | null;
  created_at: string;
  created_by: string | null;
}
export type LiveQuestionInput = Pick<LiveQuestion, 'text' | 'options' | 'correct_index' | 'points'>;

export interface AttentionCheck {
  id: string;
  class_id: string;
  seq: number;
  prompt: string | null;
  sent_at: string;
  expires_at: string;
  sent_by: string | null;
}

export interface CheckResponse {
  id: string;
  check_id: string;
  class_id: string;
  participant_id: string;
  responded_at: string;
  ok: boolean;
  latency_ms: number | null;
}

export interface LiveAnswer {
  id: string;
  question_id: string;
  class_id: string;
  participant_id: string;
  selected_index: number | null;
  answer_text: string | null;
  is_correct: boolean | null;
  points_granted: number;
  answered_at: string;
}

/** one row of online_class_live_stats().participants */
export interface LiveParticipant {
  participant_id: string;
  enrollment_id: string;
  person_id: string;
  name: string;
  image_url: string | null;
  national_id: string;
  class_name: string;
  first_joined_at: string;
  last_seen_at: string;
  left_at: string | null;
  online: boolean;
  sessions_count: number;
  seconds: number;
  percent: number;
  checks_ok: number;
  checks_late: number;
  checks_total: number;
  answers_count: number;
  correct_count: number;
  messages_count: number;
  rule_present: boolean;
  status: AttendanceStatus;
  override_status: AttendanceStatus | null;
  final_status: AttendanceStatus | null;
  attendance_log_id: string | null;
}

export interface LiveStats {
  class_id: string;
  status: OnlineClassStatus;
  span_from: string;
  span_to: string;
  span_seconds: number;
  checks_sent: number;
  server_now: string;
  participants: LiveParticipant[];
  totals: { entered: number; online: number; present: number; absent: number; eligible: number };
}

export interface RoomMessage {
  id: string;
  class_id: string;
  body: string;
  created_at: string;
  sender_profile_id: string | null;
  sender_participant_id: string | null;
  sender_name: string | null;
  sender_image: string | null;
  is_servant: boolean;
  mine: boolean;
}

// ---------- Labels ----------
export const CLASS_STATUS_LABELS: Record<OnlineClassStatus, string> = {
  scheduled: 'مجدول',
  live: 'مباشر الآن',
  ended: 'انتهى',
  cancelled: 'ملغي',
};
export const CLASS_STATUS_STYLE: Record<OnlineClassStatus, string> = {
  scheduled: 'bg-sky-100 text-sky-700',
  live: 'bg-red-100 text-red-600',
  ended: 'bg-slate-200 text-slate-600',
  cancelled: 'bg-amber-100 text-amber-700',
};
export const PLATFORM_LABELS: Record<StreamPlatform, string> = {
  youtube: 'YouTube',
  facebook: 'Facebook',
  zoom: 'Zoom',
  meet: 'Google Meet',
  other: 'منصة أخرى',
};
export const PLATFORMS: StreamPlatform[] = ['youtube', 'facebook', 'zoom', 'meet', 'other'];
export const QUESTION_STATUS_LABELS: Record<LiveQuestionStatus, string> = {
  draft: 'غير معروض',
  open: 'مفتوح الآن',
  closed: 'مغلق',
};
export const ATTENDANCE_LABELS: Record<AttendanceStatus, string> = { present: 'حاضر', absent: 'غائب' };
export const OPTION_LETTERS = ['أ', 'ب', 'ج', 'د', 'هـ', 'و'];

// ---------- Error mapping ----------
const ERRORS: [string, string][] = [
  ['module_not_visible', 'وحدة الفصول الأونلاين غير مفعّلة لنطاقك'],
  ['class_not_found', 'الفصل غير موجود'],
  ['class_out_of_scope', 'هذا الفصل ليس لفصلك'],
  ['class_not_live', 'الفصل ليس مباشراً الآن'],
  ['class_not_scheduled', 'لا يمكن بدء هذا الفصل (ليس مجدولاً)'],
  ['class_not_started', 'الفصل لم يبدأ بعد'],
  ['class_not_ended', 'الفصل لم ينته بعد'],
  ['not_joined', 'ادخل الفصل أولاً'],
  ['check_not_found', 'فحص الانتباه غير موجود'],
  ['question_not_found', 'السؤال غير موجود'],
  ['question_closed', 'هذا السؤال غير مفتوح للإجابة'],
  ['already_answered', 'أجبت على هذا السؤال بالفعل'],
  ['invalid_option', 'اختيار غير صالح'],
  ['answer_blank', 'اكتب إجابتك أولاً'],
  ['chat_disabled', 'الدردشة مغلقة في هذا الفصل'],
  ['message_blank', 'اكتب رسالة أولاً'],
  ['rate_limited', 'رسائل كثيرة — انتظر قليلاً'],
  ['invalid_seconds', 'مدة الفحص بين 10 و 600 ثانية'],
  ['invalid_status', 'حالة غير صالحة'],
  ['participant_not_found', 'المشارك غير موجود'],
  ['exam_out_of_scope', 'الامتحان المختار لا يغطي نطاق هذا الفصل'],
  ['event_out_of_scope', 'المناسبة المختارة لا تغطي نطاق هذا الفصل'],
  ['options_count_out_of_range', 'يجب أن يحتوي السؤال على 2 إلى 6 اختيارات'],
  ['option_blank', 'يوجد اختيار فارغ — اكتب نص كل الاختيارات'],
  ['correct_index_out_of_range', 'حدد الإجابة الصحيحة من بين الاختيارات'],
  ['online_classes_window', 'وقت الانتهاء يجب أن يكون بعد وقت البدء'],
  ['online_classes_checks_rule', 'الحد الأدنى للفحوص الناجحة لا يتجاوز عدد الفحوص'],
  ['forbidden', 'ليس لديك صلاحية على هذه العملية'],
];

export const MIGRATION_HINT = 'تحتاج تشغيل تحديث قاعدة البيانات 0030_online_classes.sql في Supabase أولاً';

export function isMigrationMissing(err: unknown): boolean {
  const msg = (err as { message?: string } | null)?.message ?? '';
  return /online_class|child_online_/.test(msg) && /does not exist|not find|schema cache|relation/i.test(msg);
}

export function onlineErrorMessage(err: unknown, fallback = 'حدث خطأ، حاول مجدداً'): string {
  const msg = (err as { message?: string } | null)?.message ?? '';
  if (!msg) return fallback;
  if (isMigrationMissing(err)) return MIGRATION_HINT;
  if ((err as { code?: string } | null)?.code === '42501') return 'ليس لديك صلاحية على هذه العملية';
  for (const [key, label] of ERRORS) {
    if (msg.includes(key)) return label;
  }
  return fallback;
}

// ---------- Classes CRUD ----------
export async function fetchOnlineClasses(supabase: SupabaseClient, scope: ScopeSelection = {}): Promise<OnlineClass[]> {
  let q = supabase.from('online_classes').select('*');
  if (scope.church && scope.church !== ALL) q = q.eq('church_id', scope.church);
  const { data, error } = await q.order('starts_at', { ascending: false }).limit(500);
  if (error) throw error;
  let rows = (data ?? []) as OnlineClass[];
  if (scope.service && scope.service !== ALL) rows = rows.filter((r) => r.service_id === null || r.service_id === scope.service);
  { const ids = classIdsOf(scope); if (ids.length > 0) rows = rows.filter((r) => r.class_id === null || ids.includes(r.class_id)); }
  return rows;
}

export async function fetchOnlineClass(supabase: SupabaseClient, id: string): Promise<OnlineClass | null> {
  const { data, error } = await supabase.from('online_classes').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return (data as OnlineClass | null) ?? null;
}

export async function createOnlineClass(supabase: SupabaseClient, input: OnlineClassInput, userId: string | undefined): Promise<OnlineClass> {
  const { data, error } = await supabase
    .from('online_classes')
    .insert({ ...input, created_by: userId ?? null, edited_by: userId ?? null })
    .select('*')
    .single();
  if (error) throw error;
  return data as OnlineClass;
}

export async function updateOnlineClass(
  supabase: SupabaseClient, id: string, patch: Partial<OnlineClassInput & { status: OnlineClassStatus }>, userId: string | undefined
): Promise<OnlineClass> {
  const { data, error } = await supabase
    .from('online_classes')
    .update({ ...patch, edited_by: userId ?? null })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data as OnlineClass;
}

export async function deleteOnlineClass(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from('online_classes').delete().eq('id', id);
  if (error) throw error;
}

// ---------- Servant RPCs ----------
export async function startClass(supabase: SupabaseClient, id: string): Promise<OnlineClass> {
  const { data, error } = await supabase.rpc('online_class_start', { p_class: id });
  if (error) throw error;
  return data as OnlineClass;
}
export interface FinalizeResult { class_id: string; present: number; absent: number; ended_at: string }
export async function endClass(supabase: SupabaseClient, id: string): Promise<FinalizeResult> {
  const { data, error } = await supabase.rpc('online_class_end', { p_class: id });
  if (error) throw error;
  return data as FinalizeResult;
}
export async function finalizeClass(supabase: SupabaseClient, id: string): Promise<FinalizeResult> {
  const { data, error } = await supabase.rpc('online_class_finalize', { p_class: id });
  if (error) throw error;
  return data as FinalizeResult;
}
export async function reopenClass(supabase: SupabaseClient, id: string): Promise<OnlineClass> {
  const { data, error } = await supabase.rpc('online_class_reopen', { p_class: id });
  if (error) throw error;
  return data as OnlineClass;
}
export async function sendCheck(supabase: SupabaseClient, id: string, prompt?: string, seconds?: number): Promise<AttentionCheck> {
  const { data, error } = await supabase.rpc('online_class_send_check', { p_class: id, p_prompt: prompt?.trim() || null, p_seconds: seconds ?? null });
  if (error) throw error;
  return data as AttentionCheck;
}
export async function setOverride(supabase: SupabaseClient, participantId: string, status: AttendanceStatus | null): Promise<void> {
  const { error } = await supabase.rpc('online_class_set_override', { p_participant: participantId, p_status: status });
  if (error) throw error;
}
export async function fetchLiveStats(supabase: SupabaseClient, id: string): Promise<LiveStats> {
  const { data, error } = await supabase.rpc('online_class_live_stats', { p_class: id });
  if (error) throw error;
  return data as LiveStats;
}
export async function fetchRoomMessages(supabase: SupabaseClient, id: string, before?: string, limit = 100): Promise<RoomMessage[]> {
  const { data, error } = await supabase.rpc('online_class_messages_list', { p_class: id, p_before: before ?? null, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as RoomMessage[];
}
export async function sendServantMessage(supabase: SupabaseClient, id: string, body: string, userId: string): Promise<void> {
  const { error } = await supabase.from('online_class_messages').insert({ class_id: id, sender_profile_id: userId, body: body.trim() });
  if (error) throw error;
}
export async function deleteRoomMessage(supabase: SupabaseClient, messageId: string): Promise<void> {
  const { error } = await supabase.from('online_class_messages').delete().eq('id', messageId);
  if (error) throw error;
}

// ---------- Checks / questions / answers (servant reads) ----------
export async function fetchChecks(supabase: SupabaseClient, id: string): Promise<AttentionCheck[]> {
  const { data, error } = await supabase.from('online_class_checks').select('*').eq('class_id', id).order('seq');
  if (error) throw error;
  return (data ?? []) as AttentionCheck[];
}
export async function fetchCheckResponses(supabase: SupabaseClient, id: string): Promise<CheckResponse[]> {
  const { data, error } = await supabase.from('online_class_check_responses').select('*').eq('class_id', id).limit(5000);
  if (error) throw error;
  return (data ?? []) as CheckResponse[];
}
export async function fetchLiveQuestions(supabase: SupabaseClient, id: string): Promise<LiveQuestion[]> {
  const { data, error } = await supabase.from('online_class_questions').select('*').eq('class_id', id).order('sort_order').order('created_at');
  if (error) throw error;
  return (data ?? []) as LiveQuestion[];
}
export async function createLiveQuestion(supabase: SupabaseClient, classId: string, input: LiveQuestionInput, sortOrder: number, userId: string | undefined): Promise<LiveQuestion> {
  const { data, error } = await supabase
    .from('online_class_questions')
    .insert({ ...input, class_id: classId, sort_order: sortOrder, created_by: userId ?? null })
    .select('*')
    .single();
  if (error) throw error;
  return data as LiveQuestion;
}
export async function updateLiveQuestion(supabase: SupabaseClient, id: string, patch: Partial<LiveQuestionInput & { status: LiveQuestionStatus; sort_order: number }>): Promise<LiveQuestion> {
  const { data, error } = await supabase.from('online_class_questions').update(patch).eq('id', id).select('*').single();
  if (error) throw error;
  return data as LiveQuestion;
}
export async function deleteLiveQuestion(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from('online_class_questions').delete().eq('id', id);
  if (error) throw error;
}
export async function fetchLiveAnswers(supabase: SupabaseClient, id: string): Promise<LiveAnswer[]> {
  const { data, error } = await supabase.from('online_class_answers').select('*').eq('class_id', id).order('answered_at').limit(5000);
  if (error) throw error;
  return (data ?? []) as LiveAnswer[];
}

/** participants count per class (for list badges) */
export async function fetchParticipantCounts(supabase: SupabaseClient, ids: string[]): Promise<Map<string, { entered: number; present: number }>> {
  const out = new Map<string, { entered: number; present: number }>();
  if (ids.length === 0) return out;
  const { data, error } = await supabase.from('online_class_participants').select('class_id, final_status').in('class_id', ids).limit(20000);
  if (error) return out;
  for (const r of (data ?? []) as { class_id: string; final_status: AttendanceStatus | null }[]) {
    const s = out.get(r.class_id) ?? { entered: 0, present: 0 };
    s.entered++;
    if (r.final_status === 'present') s.present++;
    out.set(r.class_id, s);
  }
  return out;
}

// ---------- Stream URL → embed ----------
export interface StreamEmbed {
  kind: 'iframe' | 'link';
  src: string;          // iframe src or the original link
  label: string;
}

/** Detect the platform from a pasted URL (helps pre-select the dropdown). */
export function detectPlatform(url: string): StreamPlatform | null {
  const u = url.toLowerCase();
  if (/youtu\.?be/.test(u)) return 'youtube';
  if (/facebook\.com|fb\.watch/.test(u)) return 'facebook';
  if (/zoom\.us/.test(u)) return 'zoom';
  if (/meet\.google\.com/.test(u)) return 'meet';
  return url.trim() ? 'other' : null;
}

/**
 * YouTube & Facebook can be embedded; Zoom / Meet open in their own app
 * (they refuse iframes), so the room shows a big «افتح البث» button and
 * the child keeps this tab open for attendance.
 */
export function streamEmbed(platform: StreamPlatform, url: string | null): StreamEmbed | null {
  if (!url) return null;
  const clean = url.trim();
  if (platform === 'youtube') {
    const id = youtubeId(clean);
    if (id) return { kind: 'iframe', src: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&playsinline=1&rel=0`, label: 'YouTube' };
    return { kind: 'link', src: clean, label: 'YouTube' };
  }
  if (platform === 'facebook') {
    return { kind: 'iframe', src: `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(clean)}&show_text=false&autoplay=true`, label: 'Facebook' };
  }
  return { kind: 'link', src: clean, label: PLATFORM_LABELS[platform] };
}

export function youtubeId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtu.be')) return u.pathname.slice(1).split('/')[0] || null;
    if (u.searchParams.get('v')) return u.searchParams.get('v');
    const m = u.pathname.match(/\/(embed|live|shorts|v)\/([A-Za-z0-9_-]{6,})/);
    if (m) return m[2];
  } catch { /* not a url */ }
  return null;
}

// ---------- Helpers ----------
export const fmtPercent = (p: number | null | undefined) => (p === null || p === undefined ? '—' : `${Math.round(Number(p))}٪`);

export const fmtSpan = (seconds: number) => {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) return `${h} س ${m} د`;
  if (m) return `${m} د`;
  return `${s} ث`;
};

export const toLocalInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);

/** «60٪ من الوقت · 2 من 3 فحوص انتباه · 1 إجابة» */
export function rulesLabel(c: Pick<OnlineClass, 'min_time_percent' | 'checks_required' | 'checks_min_success' | 'min_answers'>): string {
  const parts = [`${c.min_time_percent}٪ من الوقت`];
  if (c.checks_required > 0) parts.push(`${c.checks_min_success} من ${c.checks_required} فحوص انتباه`);
  if (c.min_answers > 0) parts.push(`${c.min_answers} إجابة`);
  return parts.join(' · ');
}

export const defaultClassInput = (scope: { church_id: string; service_id: string | null; class_id: string | null }): OnlineClassInput => {
  const start = new Date();
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 1);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return {
    ...scope,
    title: '',
    description: null,
    starts_at: start.toISOString(),
    ends_at: end.toISOString(),
    platform: 'youtube',
    stream_url: null,
    chat_enabled: true,
    exam_id: null,
    event_id: null,
    min_time_percent: 60,
    checks_required: 3,
    checks_min_success: 2,
    min_answers: 0,
    check_seconds: 60,
    attendance_points: 0,
  };
};

/** Phase for badges: live / starting soon / upcoming / overdue (scheduled but start passed) / ended */
export function classPhase(c: OnlineClass, now = new Date()): 'live' | 'soon' | 'upcoming' | 'overdue' | 'ended' | 'cancelled' {
  if (c.status === 'live') return 'live';
  if (c.status === 'ended') return 'ended';
  if (c.status === 'cancelled') return 'cancelled';
  const diff = new Date(c.starts_at).getTime() - now.getTime();
  if (diff < 0) return 'overdue';
  if (diff <= 30 * 60 * 1000) return 'soon';
  return 'upcoming';
}
