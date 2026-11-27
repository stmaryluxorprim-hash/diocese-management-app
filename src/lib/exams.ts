'use client';

// ---------- Exams module (الامتحانات) — client data layer ----------
// Exams / questions are plain CRUD on `exams` / `exam_questions` (RLS gated
// by module_visible('exams') + scope). Attempts are READ-ONLY through the
// API (exam_attempts / exam_answers) — the child writes them only through
// the SECURITY DEFINER child_exam_* RPCs (migration 0027). Servant RPCs:
// exam_attempt_detail, exam_cancel_attempt, exam_duplicate.

import type { SupabaseClient } from '@supabase/supabase-js';
import { ALL, type ScopeSelection } from '@/lib/queries';
import { classIdsOf } from '@/lib/class-multi';

// ---------- Types ----------
export type ExamStatus = 'draft' | 'published' | 'closed';
export type PassMode = 'percent' | 'score';
export type QuestionMode = 'all' | 'random';
export type AttemptStatus = 'in_progress' | 'submitted' | 'cancelled';

export interface Exam {
  id: string;
  church_id: string;
  service_id: string | null;
  class_id: string | null;
  title: string;
  description: string | null;
  image_url: string | null;
  status: ExamStatus;
  opens_at: string | null;
  closes_at: string | null;
  default_seconds: number;
  default_points: number;
  pass_mode: PassMode;
  pass_value: number;
  points_pass: number;
  points_full: number;
  question_mode: QuestionMode;
  random_count: number;
  shuffle_questions: boolean;
  shuffle_options: boolean;
  max_attempts: number;
  show_result: boolean;
  show_answers: boolean;
  created_at: string;
  created_by: string | null;
  edited_at: string;
  edited_by: string | null;
}

export interface ExamQuestion {
  id: string;
  exam_id: string;
  sort_order: number;
  text: string;
  image_url: string | null;
  options: string[];
  correct_index: number;
  points: number;
  seconds: number | null;
  created_at: string;
  edited_at: string;
}

export interface ExamAttempt {
  id: string;
  exam_id: string;
  enrollment_id: string;
  person_id: string;
  church_id: string;
  service_id: string;
  class_id: string;
  status: AttemptStatus;
  attempt_no: number;
  questions_count: number;
  current_index: number;
  started_at: string;
  finished_at: string | null;
  score: number;
  max_score: number;
  percent: number;
  correct_count: number;
  answered_count: number;
  timed_out_count: number;
  passed: boolean | null;
  full_mark: boolean | null;
  points_granted: number;
  points_log_id: string | null;
  refund_points_log_id: string | null;
  cancelled_by: string | null;
  cancelled_at: string | null;
  cancel_note: string | null;
}

export interface ExamAttemptWithPerson extends ExamAttempt {
  person: { id: string; name: string; national_id: string; image_url: string | null } | null;
}

/** One answer inside a result payload (child or servant view). */
export interface ExamAnswerView {
  position: number;
  text: string;
  image_url: string | null;
  options: string[];
  correct_index: number;
  selected_index: number | null;
  is_correct: boolean | null;
  points: number;
  points_earned: number;
  timed_out: boolean;
  time_spent_ms: number | null;
}

/** exam_result_payload() — some keys only when show_result / show_answers. */
export interface ExamResult {
  attempt_id: string;
  exam_id: string;
  exam_title: string;
  status: AttemptStatus;
  attempt_no: number;
  questions_count: number;
  started_at: string;
  finished_at: string | null;
  show_result: boolean;
  show_answers: boolean;
  answered_count: number;
  timed_out_count: number;
  score?: number;
  max_score?: number;
  percent?: number;
  correct_count?: number;
  passed?: boolean;
  full_mark?: boolean;
  points_granted?: number;
  pass_mode?: PassMode;
  pass_value?: number;
  answers?: ExamAnswerView[];
}

export const EXAM_STATUS_LABELS: Record<ExamStatus, string> = {
  draft: 'مسودة',
  published: 'منشور',
  closed: 'مغلق',
};
export const EXAM_STATUS_STYLE: Record<ExamStatus, string> = {
  draft: 'bg-slate-200 text-slate-600',
  published: 'bg-emerald-100 text-emerald-700',
  closed: 'bg-red-100 text-red-600',
};
export const ATTEMPT_STATUS_LABELS: Record<AttemptStatus, string> = {
  in_progress: 'جارٍ الحل',
  submitted: 'مكتمل',
  cancelled: 'ملغي',
};

export const OPTION_LETTERS = ['أ', 'ب', 'ج', 'د', 'هـ', 'و'];
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 6;

// ---------- Error mapping (RPC raise → Arabic) ----------
const ERRORS: [string, string][] = [
  ['module_not_visible', 'وحدة الامتحانات غير مفعّلة لنطاقك'],
  ['exam_not_found', 'الامتحان غير موجود'],
  ['exam_out_of_scope', 'هذا الامتحان ليس لفصلك'],
  ['exam_not_published', 'الامتحان غير منشور بعد'],
  ['exam_not_open_yet', 'لم يبدأ وقت الامتحان بعد'],
  ['exam_closed', 'انتهى وقت الامتحان'],
  ['exam_has_no_questions', 'الامتحان لا يحتوي على أسئلة'],
  ['no_attempts_left', 'استهلكت كل محاولاتك في هذا الامتحان'],
  ['attempt_not_found', 'المحاولة غير موجودة'],
  ['attempt_in_progress', 'المحاولة لم تنته بعد'],
  ['question_not_served', 'السؤال لم يُعرض بعد'],
  ['position_mismatch', 'لا يمكن تخطي الأسئلة'],
  ['invalid_option', 'اختيار غير صالح'],
  ['already_cancelled', 'هذه المحاولة ملغاة بالفعل'],
  ['options_count_out_of_range', 'يجب أن يحتوي السؤال على 2 إلى 6 اختيارات'],
  ['option_blank', 'يوجد اختيار فارغ — اكتب نص كل الاختيارات'],
  ['correct_index_out_of_range', 'حدد الإجابة الصحيحة من بين الاختيارات'],
  ['pass_percent_out_of_range', 'نسبة النجاح يجب أن تكون بين 0 و 100'],
  ['exams_window', 'وقت الإغلاق يجب أن يكون بعد وقت البدء'],
  ['forbidden', 'ليس لديك صلاحية على هذه العملية'],
];

export const MIGRATION_HINT = 'تحتاج تشغيل تحديث قاعدة البيانات 0027_exams.sql في Supabase أولاً';

export function isMigrationMissing(err: unknown): boolean {
  const msg = (err as { message?: string } | null)?.message ?? '';
  return /exams|exam_questions|exam_attempts|exam_answers|child_portal_exams|child_exam_|exam_cancel_attempt|exam_duplicate|exam_attempt_detail/.test(msg) &&
    /does not exist|not find|schema cache|relation/i.test(msg);
}

export function examErrorMessage(err: unknown, fallback = 'حدث خطأ، حاول مجدداً'): string {
  const msg = (err as { message?: string } | null)?.message ?? '';
  if (!msg) return fallback;
  if (isMigrationMissing(err)) return MIGRATION_HINT;
  if ((err as { code?: string } | null)?.code === '42501') return 'ليس لديك صلاحية على هذه العملية';
  for (const [key, label] of ERRORS) {
    if (msg.includes(key)) return label;
  }
  return fallback;
}

// ---------- Exams ----------
export async function fetchExams(supabase: SupabaseClient, scope: ScopeSelection = {}): Promise<Exam[]> {
  let q = supabase.from('exams').select('*');
  if (scope.church && scope.church !== ALL) q = q.eq('church_id', scope.church);
  const { data, error } = await q.order('created_at', { ascending: false });
  if (error) throw error;
  let rows = (data ?? []) as Exam[];
  if (scope.service && scope.service !== ALL) rows = rows.filter((r) => r.service_id === null || r.service_id === scope.service);
  { const ids = classIdsOf(scope); if (ids.length > 0) rows = rows.filter((r) => r.class_id === null || ids.includes(r.class_id)); }
  return rows;
}

export async function fetchExam(supabase: SupabaseClient, id: string): Promise<Exam | null> {
  const { data, error } = await supabase.from('exams').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return (data as Exam | null) ?? null;
}

export type ExamInput = Omit<Exam, 'id' | 'created_at' | 'created_by' | 'edited_at' | 'edited_by'>;

export async function createExam(supabase: SupabaseClient, input: ExamInput, userId: string | undefined): Promise<Exam> {
  const { data, error } = await supabase
    .from('exams')
    .insert({ ...input, created_by: userId ?? null, edited_by: userId ?? null })
    .select('*')
    .single();
  if (error) throw error;
  return data as Exam;
}

export async function updateExam(supabase: SupabaseClient, id: string, patch: Partial<ExamInput>, userId: string | undefined): Promise<Exam> {
  const { data, error } = await supabase
    .from('exams')
    .update({ ...patch, edited_by: userId ?? null })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data as Exam;
}

export async function deleteExam(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from('exams').delete().eq('id', id);
  if (error) throw error;
}

export async function duplicateExam(supabase: SupabaseClient, id: string, title?: string): Promise<string> {
  const { data, error } = await supabase.rpc('exam_duplicate', { p_exam: id, p_title: title ?? null });
  if (error) throw error;
  return data as string;
}

// ---------- Questions ----------
export async function fetchQuestions(supabase: SupabaseClient, examId: string): Promise<ExamQuestion[]> {
  const { data, error } = await supabase
    .from('exam_questions')
    .select('*')
    .eq('exam_id', examId)
    .order('sort_order')
    .order('created_at');
  if (error) throw error;
  return (data ?? []) as ExamQuestion[];
}

export type QuestionInput = Pick<ExamQuestion, 'text' | 'image_url' | 'options' | 'correct_index' | 'points' | 'seconds'>;

export async function createQuestion(
  supabase: SupabaseClient, examId: string, input: QuestionInput, sortOrder: number
): Promise<ExamQuestion> {
  const { data, error } = await supabase
    .from('exam_questions')
    .insert({ ...input, exam_id: examId, sort_order: sortOrder })
    .select('*')
    .single();
  if (error) throw error;
  return data as ExamQuestion;
}

/** Insert many questions in ONE request (atomic: all or none). */
export async function createQuestionsBulk(
  supabase: SupabaseClient, examId: string, inputs: QuestionInput[], startSortOrder: number
): Promise<ExamQuestion[]> {
  if (inputs.length === 0) return [];
  const { data, error } = await supabase
    .from('exam_questions')
    .insert(inputs.map((input, i) => ({ ...input, exam_id: examId, sort_order: startSortOrder + i })))
    .select('*');
  if (error) throw error;
  return ((data ?? []) as ExamQuestion[]).sort((a, b) => a.sort_order - b.sort_order);
}

export async function updateQuestion(supabase: SupabaseClient, id: string, patch: Partial<QuestionInput & { sort_order: number }>): Promise<ExamQuestion> {
  const { data, error } = await supabase.from('exam_questions').update(patch).eq('id', id).select('*').single();
  if (error) throw error;
  return data as ExamQuestion;
}

export async function deleteQuestion(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from('exam_questions').delete().eq('id', id);
  if (error) throw error;
}

/** Persist a new order (array of question ids, top → bottom). */
export async function reorderQuestions(supabase: SupabaseClient, ids: string[]): Promise<void> {
  await Promise.all(ids.map((id, i) => supabase.from('exam_questions').update({ sort_order: i + 1 }).eq('id', id)));
}

/** Count of questions per exam (for list badges). */
export async function fetchQuestionCounts(supabase: SupabaseClient, examIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (examIds.length === 0) return out;
  const { data, error } = await supabase.from('exam_questions').select('exam_id').in('exam_id', examIds);
  if (error) return out;
  for (const r of (data ?? []) as { exam_id: string }[]) out.set(r.exam_id, (out.get(r.exam_id) ?? 0) + 1);
  return out;
}

// ---------- Attempts / results ----------
const ATTEMPT_SELECT = '*, person:persons(id, name, national_id, image_url)';

export async function fetchAttempts(supabase: SupabaseClient, examId: string): Promise<ExamAttemptWithPerson[]> {
  const { data, error } = await supabase
    .from('exam_attempts')
    .select(ATTEMPT_SELECT)
    .eq('exam_id', examId)
    .order('started_at', { ascending: false })
    .limit(2000);
  if (error) throw error;
  return (data ?? []) as unknown as ExamAttemptWithPerson[];
}

/** Attempt stats per exam (for list badges / hub KPIs). */
export async function fetchAttemptStats(
  supabase: SupabaseClient, examIds: string[]
): Promise<Map<string, { total: number; passed: number; inProgress: number }>> {
  const out = new Map<string, { total: number; passed: number; inProgress: number }>();
  if (examIds.length === 0) return out;
  const { data, error } = await supabase
    .from('exam_attempts')
    .select('exam_id, status, passed')
    .in('exam_id', examIds)
    .limit(10000);
  if (error) return out;
  for (const r of (data ?? []) as { exam_id: string; status: AttemptStatus; passed: boolean | null }[]) {
    const s = out.get(r.exam_id) ?? { total: 0, passed: 0, inProgress: 0 };
    if (r.status === 'submitted') { s.total++; if (r.passed) s.passed++; }
    if (r.status === 'in_progress') s.inProgress++;
    out.set(r.exam_id, s);
  }
  return out;
}

export async function fetchAttemptDetail(supabase: SupabaseClient, attemptId: string): Promise<ExamResult> {
  const { data, error } = await supabase.rpc('exam_attempt_detail', { p_attempt: attemptId });
  if (error) throw error;
  return data as ExamResult;
}

export async function cancelAttempt(supabase: SupabaseClient, attemptId: string, note?: string): Promise<{ attempt_id: string; refunded: number }> {
  const { data, error } = await supabase.rpc('exam_cancel_attempt', { p_attempt: attemptId, p_note: note?.trim() || null });
  if (error) throw error;
  return data as { attempt_id: string; refunded: number };
}

// ---------- Helpers ----------
export const fmtSeconds = (s: number) => {
  if (s < 60) return `${s} ث`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `${m} د ${r} ث` : `${m} د`;
};

export const passLabel = (x: Pick<Exam, 'pass_mode' | 'pass_value'>) =>
  x.pass_mode === 'percent' ? `${Number(x.pass_value)}٪` : `${Number(x.pass_value)} درجة`;

/** Is the exam open for children right now (client-side mirror). */
export function examIsOpen(x: Exam, now = new Date()): boolean {
  if (x.status !== 'published') return false;
  if (x.opens_at && now < new Date(x.opens_at)) return false;
  if (x.closes_at && now > new Date(x.closes_at)) return false;
  return true;
}

/** datetime-local <input> value (local time) ⇄ ISO */
export const toLocalInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);

export const defaultExamInput = (scope: { church_id: string; service_id: string | null; class_id: string | null }): ExamInput => ({
  ...scope,
  title: '',
  description: null,
  image_url: null,
  status: 'draft',
  opens_at: null,
  closes_at: null,
  default_seconds: 30,
  default_points: 1,
  pass_mode: 'percent',
  pass_value: 50,
  points_pass: 0,
  points_full: 0,
  question_mode: 'all',
  random_count: 10,
  shuffle_questions: true,
  shuffle_options: true,
  max_attempts: 1,
  show_result: true,
  show_answers: false,
});
