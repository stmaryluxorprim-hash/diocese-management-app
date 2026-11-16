'use client';

// ---------- Exam Results module (نتائج الامتحانات) — client data layer ----------
// Plain CRUD on result_exams / result_subjects / grading_systems /
// grading_grades (RLS: module grant + scope + permission keys, migration
// 0038). Results are written through `result_save_bulk` (per-row ok / error
// so the UI can retry failures) and READ through `result_exam_summary`
// (DB-computed totals, grades, pass / fail, rank) + the raw exam_results
// rows. Percentages / grades are NEVER computed client-side for storage —
// `previewPercent` / `gradeFor` exist only for instant feedback while typing.

import type { SupabaseClient } from '@supabase/supabase-js';
import { ALL, type ScopeSelection } from '@/lib/queries';
import { classIdsOf } from '@/lib/class-multi';

// ---------- Types ----------
export type ResultExamStatus = 'draft' | 'open' | 'completed' | 'archived';
export type PassRule = 'overall' | 'subjects' | 'both';
export type ResultRowStatus = 'draft' | 'completed' | 'absent' | 'excused';
export type StudentStatus = 'not_entered' | 'incomplete' | 'draft' | 'absent' | 'passed' | 'failed';

export interface GradingSystem {
  id: string;
  church_id: string | null;
  name: string;
  description: string | null;
  is_default: boolean;
  created_at: string;
  created_by: string | null;
  edited_at: string;
  edited_by: string | null;
}

export interface GradingGrade {
  id: string;
  grading_system_id: string;
  name: string;
  min_percent: number;
  max_percent: number;
  description: string | null;
  color: string | null;
  is_pass: boolean;
  sort_order: number;
}

export interface ResultExam {
  id: string;
  church_id: string;
  service_id: string | null;
  class_id: string | null;
  name: string;
  exam_date: string | null;
  academic_year: string | null;
  description: string | null;
  status: ResultExamStatus;
  grading_system_id: string | null;
  grade_overall: boolean;
  grade_subject: boolean;
  pass_rule: PassRule;
  pass_percent: number;
  absent_as_zero: boolean;
  min_required_subjects: number | null;
  locked: boolean;
  locked_at: string | null;
  locked_by: string | null;
  published_at: string | null;
  created_at: string;
  created_by: string | null;
  edited_at: string;
  edited_by: string | null;
}

export interface ResultSubject {
  id: string;
  exam_id: string;
  name: string;
  code: string | null;
  full_degree: number;
  pass_degree: number;
  weight: number | null;
  is_bonus: boolean;
  sort_order: number;
  created_at: string;
  edited_at: string;
}

export interface ExamResultRow {
  id: string;
  exam_id: string;
  subject_id: string;
  enrollment_id: string;
  person_id: string;
  church_id: string;
  service_id: string;
  class_id: string;
  score: number | null;
  status: ResultRowStatus;
  note: string | null;
  percent: number | null;
  grade_id: string | null;
  passed: boolean | null;
  created_at: string;
  created_by: string | null;
  edited_at: string;
  edited_by: string | null;
}

/** result_exam_summary() row — one per student of the exam scope */
export interface StudentSummary {
  enrollment_id: string;
  person_id: string;
  church_id: string;
  service_id: string;
  class_id: string;
  name: string;
  national_id: string;
  image_url: string | null;
  subjects_total: number;
  subjects_entered: number;
  subjects_absent: number;
  subjects_draft: number;
  total_score: number | null;
  total_full: number;
  percent: number | null;
  grade_id: string | null;
  grade_name: string | null;
  grade_color: string | null;
  passed: boolean | null;
  status: StudentStatus;
  rank: number | null;
  rank_score: number | null;
}

/** result_student_history() row */
export interface HistoryRow {
  exam_id: string;
  exam_name: string;
  exam_date: string | null;
  academic_year: string | null;
  exam_status: ResultExamStatus;
  locked: boolean;
  published_at: string | null;
  enrollment_id: string;
  class_id: string;
  class_name: string;
  service_name: string;
  church_name: string;
  subjects_total: number;
  subjects_entered: number;
  total_score: number | null;
  total_full: number;
  percent: number | null;
  grade_id: string | null;
  grade_name: string | null;
  grade_color: string | null;
  passed: boolean | null;
  status: StudentStatus;
}

export interface ResultPermissions {
  view: boolean; enter: boolean; edit: boolean; import: boolean; export: boolean;
  manage_exams: boolean; manage_subjects: boolean; manage_grading: boolean; lock: boolean; stats: boolean;
}
export const NO_PERMISSIONS: ResultPermissions = {
  view: false, enter: false, edit: false, import: false, export: false,
  manage_exams: false, manage_subjects: false, manage_grading: false, lock: false, stats: false,
};

// ---------- Labels ----------
export const EXAM_STATUS_LABELS: Record<ResultExamStatus, string> = {
  draft: 'مسودة', open: 'مفتوح للنتائج', completed: 'مكتمل', archived: 'مؤرشف',
};
export const EXAM_STATUS_STYLE: Record<ResultExamStatus, string> = {
  draft: 'bg-slate-200 text-slate-600', open: 'bg-emerald-100 text-emerald-700',
  completed: 'bg-sky-100 text-sky-700', archived: 'bg-amber-100 text-amber-700',
};
export const ROW_STATUS_LABELS: Record<ResultRowStatus, string> = {
  draft: 'مسودة', completed: 'مكتمل', absent: 'غائب', excused: 'معذور',
};
export const STUDENT_STATUS_LABELS: Record<StudentStatus, string> = {
  not_entered: 'لم تُدخل', incomplete: 'غير مكتمل', draft: 'مسودة', absent: 'غائب', passed: 'ناجح', failed: 'لم ينجح',
};
export const STUDENT_STATUS_STYLE: Record<StudentStatus, string> = {
  not_entered: 'bg-slate-100 text-slate-500', incomplete: 'bg-amber-100 text-amber-700', draft: 'bg-violet-100 text-violet-700',
  absent: 'bg-slate-200 text-slate-600', passed: 'bg-emerald-100 text-emerald-700', failed: 'bg-red-100 text-red-600',
};
export const PASS_RULE_LABELS: Record<PassRule, string> = {
  overall: 'النسبة الكلية ≥ نسبة النجاح', subjects: 'النجاح في كل مادة', both: 'الاثنان معاً',
};

/** Palette suggested to the admin when he colors a grade */
export const GRADE_COLORS = ['#059669', '#0284c7', '#7c3aed', '#d97706', '#dc2626', '#64748b', '#db2777', '#0d9488'];

// ---------- Error mapping (raise → Arabic) ----------
const ERRORS: [string, string][] = [
  ['module_not_visible', 'وحدة نتائج الامتحانات غير مفعّلة لنطاقك'],
  ['exam_not_found', 'الامتحان غير موجود'],
  ['subject_not_in_exam', 'المادة لا تنتمي لهذا الامتحان'],
  ['enrollment_not_found', 'المخدوم غير موجود أو خارج نطاقك'],
  ['enrollment_out_of_scope', 'المخدوم خارج نطاق هذا الامتحان'],
  ['results_locked', 'النتائج مقفلة — يفتحها المسؤول أولاً'],
  ['exam_archived', 'الامتحان مؤرشف — لا يمكن تعديل نتائجه'],
  ['score_required', 'أدخل الدرجة'],
  ['score_negative', 'الدرجة لا تكون أقل من صفر'],
  ['score_over_full', 'الدرجة أكبر من الدرجة الكاملة'],
  ['use_lock_rpc', 'استخدم زر القفل'],
  ['service_not_in_church', 'الخدمة لا تنتمي لهذه الكنيسة'],
  ['class_not_in_service', 'الفصل لا ينتمي لهذه الخدمة'],
  ['grading_system_out_of_scope', 'نظام التقدير لا يخص هذه الكنيسة'],
  ['grading_system_not_found', 'نظام التقدير غير موجود'],
  ['result_subjects_pass_le_full', 'درجة النجاح يجب ألا تتجاوز الدرجة الكاملة'],
  ['grading_grades_range', 'الحد الأدنى يجب ألا يتجاوز الحد الأقصى'],
  ['exam_results_unique', 'هذه النتيجة مسجلة بالفعل'],
  ['forbidden', 'ليس لديك صلاحية على هذه العملية'],
  ['row-level security', 'ليس لديك صلاحية على هذه العملية'],
];

export const MIGRATION_HINT = 'تحتاج تشغيل تحديث قاعدة البيانات 0038_exam_results.sql في Supabase أولاً';

export function isMigrationMissing(err: unknown): boolean {
  const msg = (err as { message?: string } | null)?.message ?? '';
  return /result_exams|result_subjects|exam_results|grading_systems|grading_grades|result_exam_summary|result_permissions|result_save_bulk|result_student_history/.test(msg) &&
    /does not exist|not find|schema cache|relation/i.test(msg);
}

export function resultErrorMessage(err: unknown, fallback = 'حدث خطأ، حاول مجدداً'): string {
  const msg = (err as { message?: string } | null)?.message ?? (typeof err === 'string' ? err : '');
  if (!msg) return fallback;
  if (isMigrationMissing(err)) return MIGRATION_HINT;
  if ((err as { code?: string } | null)?.code === '42501') return 'ليس لديك صلاحية على هذه العملية';
  for (const [key, label] of ERRORS) if (msg.includes(key)) return label;
  return fallback;
}

// ---------- Permissions ----------
export async function fetchResultPermissions(supabase: SupabaseClient): Promise<ResultPermissions> {
  const { data, error } = await supabase.rpc('result_permissions');
  if (error) throw error;
  return { ...NO_PERMISSIONS, ...((data ?? {}) as Partial<ResultPermissions>) };
}

// ---------- Grading systems ----------
export async function fetchGradingSystems(supabase: SupabaseClient): Promise<GradingSystem[]> {
  const { data, error } = await supabase.from('grading_systems').select('*').order('church_id', { nullsFirst: true }).order('name');
  if (error) throw error;
  return (data ?? []) as GradingSystem[];
}

export async function fetchGrades(supabase: SupabaseClient, systemIds?: string[]): Promise<GradingGrade[]> {
  let q = supabase.from('grading_grades').select('*');
  if (systemIds) {
    if (systemIds.length === 0) return [];
    q = q.in('grading_system_id', systemIds);
  }
  const { data, error } = await q.order('min_percent', { ascending: false }).order('sort_order');
  if (error) throw error;
  return ((data ?? []) as GradingGrade[]).map(numGrade);
}
const numGrade = (g: GradingGrade): GradingGrade => ({ ...g, min_percent: Number(g.min_percent), max_percent: Number(g.max_percent) });

export type GradingSystemInput = Pick<GradingSystem, 'church_id' | 'name' | 'description' | 'is_default'>;
export async function saveGradingSystem(supabase: SupabaseClient, id: string | null, input: GradingSystemInput): Promise<GradingSystem> {
  const q = id
    ? supabase.from('grading_systems').update(input).eq('id', id)
    : supabase.from('grading_systems').insert(input);
  const { data, error } = await q.select('*').single();
  if (error) throw error;
  return data as GradingSystem;
}
export async function deleteGradingSystem(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from('grading_systems').delete().eq('id', id);
  if (error) throw error;
}
export async function duplicateGradingSystem(supabase: SupabaseClient, id: string, name?: string): Promise<string> {
  const { data, error } = await supabase.rpc('grading_system_duplicate', { p_system: id, p_name: name ?? null });
  if (error) throw error;
  return data as string;
}

export type GradeInput = Pick<GradingGrade, 'name' | 'min_percent' | 'max_percent' | 'description' | 'color' | 'is_pass' | 'sort_order'>;
/** Replace the whole grade list of a system (delete missing, upsert the rest). */
export async function saveGrades(supabase: SupabaseClient, systemId: string, grades: (GradeInput & { id?: string })[]): Promise<GradingGrade[]> {
  const keep = grades.filter((g) => g.id).map((g) => g.id as string);
  let del = supabase.from('grading_grades').delete().eq('grading_system_id', systemId);
  if (keep.length) del = del.not('id', 'in', `(${keep.join(',')})`);
  const { error: e1 } = await del;
  if (e1) throw e1;
  const rows = grades.map((g, i) => ({ ...g, grading_system_id: systemId, sort_order: i + 1 }));
  const toInsert = rows.filter((r) => !r.id).map(({ id: _i, ...r }) => { void _i; return r; });
  const toUpdate = rows.filter((r) => r.id);
  if (toInsert.length) { const { error } = await supabase.from('grading_grades').insert(toInsert); if (error) throw error; }
  for (const r of toUpdate) { const { error } = await supabase.from('grading_grades').update(r).eq('id', r.id as string); if (error) throw error; }
  return fetchGrades(supabase, [systemId]);
}

/** Default grade bands (Grade 1..5) offered when creating a system */
export const DEFAULT_GRADES: GradeInput[] = [
  { name: 'Grade 1', min_percent: 90, max_percent: 100, description: 'ممتاز', color: '#059669', is_pass: true, sort_order: 1 },
  { name: 'Grade 2', min_percent: 80, max_percent: 89.99, description: 'جيد جداً', color: '#0284c7', is_pass: true, sort_order: 2 },
  { name: 'Grade 3', min_percent: 70, max_percent: 79.99, description: 'جيد', color: '#7c3aed', is_pass: true, sort_order: 3 },
  { name: 'Grade 4', min_percent: 60, max_percent: 69.99, description: 'مقبول', color: '#d97706', is_pass: true, sort_order: 4 },
  { name: 'Grade 5', min_percent: 0, max_percent: 59.99, description: 'ضعيف', color: '#dc2626', is_pass: false, sort_order: 5 },
];

/** Client mirror of grade_for_percent — instant feedback while typing. */
export function gradeFor(grades: GradingGrade[], systemId: string | null, pct: number | null): GradingGrade | null {
  if (!systemId || pct === null || Number.isNaN(pct)) return null;
  const p = Math.round(pct * 100) / 100;
  const hits = grades.filter((g) => g.grading_system_id === systemId && p >= g.min_percent && p <= g.max_percent);
  hits.sort((a, b) => b.min_percent - a.min_percent || a.sort_order - b.sort_order);
  return hits[0] ?? null;
}
export const previewPercent = (score: number | null, full: number) =>
  score === null || Number.isNaN(score) || full <= 0 ? null : Math.round((score / full) * 10000) / 100;

/** Normalize Arabic-Indic digits / decimal marks to a JS number string */
export const normalizeNumber = (raw: string) =>
  raw.trim().replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[٫،,]/g, '.');

/** Validate a typed score against the subject — error null = ok */
export function validateScore(raw: string, full: number): { value: number | null; error: string | null } {
  const t = normalizeNumber(raw);
  if (t === '') return { value: null, error: null };
  const n = Number(t);
  if (!Number.isFinite(n)) return { value: null, error: 'رقم غير صالح' };
  if (n < 0) return { value: n, error: 'أقل من صفر' };
  if (n > full) return { value: n, error: `أكبر من ${fmtNum(full)}` };
  return { value: Math.round(n * 100) / 100, error: null };
}

// ---------- Exams ----------
export async function fetchResultExams(supabase: SupabaseClient, scope: ScopeSelection = {}): Promise<ResultExam[]> {
  let q = supabase.from('result_exams').select('*');
  if (scope.church && scope.church !== ALL) q = q.eq('church_id', scope.church);
  const { data, error } = await q.order('exam_date', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false });
  if (error) throw error;
  let rows = ((data ?? []) as ResultExam[]).map(numExam);
  if (scope.service && scope.service !== ALL) rows = rows.filter((r) => r.service_id === null || r.service_id === scope.service);
  { const ids = classIdsOf(scope); if (ids.length > 0) rows = rows.filter((r) => r.class_id === null || ids.includes(r.class_id)); }
  return rows;
}
const numExam = (x: ResultExam): ResultExam => ({ ...x, pass_percent: Number(x.pass_percent) });

export async function fetchResultExam(supabase: SupabaseClient, id: string): Promise<ResultExam | null> {
  const { data, error } = await supabase.from('result_exams').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? numExam(data as ResultExam) : null;
}

export type ResultExamInput = Pick<ResultExam,
  'church_id' | 'service_id' | 'class_id' | 'name' | 'exam_date' | 'academic_year' | 'description' | 'status' |
  'grading_system_id' | 'grade_overall' | 'grade_subject' | 'pass_rule' | 'pass_percent' | 'absent_as_zero' | 'min_required_subjects'>;

export function academicYearOf(d: Date): string {
  const y = d.getMonth() >= 8 ? d.getFullYear() : d.getFullYear() - 1;
  return `${y}/${y + 1}`;
}

export const defaultExamInput = (scope: { church_id: string; service_id: string | null; class_id: string | null }, gradingSystemId: string | null): ResultExamInput => ({
  ...scope,
  name: '',
  exam_date: new Date().toISOString().slice(0, 10),
  academic_year: academicYearOf(new Date()),
  description: null,
  status: 'draft',
  grading_system_id: gradingSystemId,
  grade_overall: true,
  grade_subject: true,
  pass_rule: 'overall',
  pass_percent: 50,
  absent_as_zero: false,
  min_required_subjects: null,
});

export async function createResultExam(supabase: SupabaseClient, input: ResultExamInput): Promise<ResultExam> {
  const { data, error } = await supabase.from('result_exams').insert(input).select('*').single();
  if (error) throw error;
  return numExam(data as ResultExam);
}
export async function updateResultExam(supabase: SupabaseClient, id: string, patch: Partial<ResultExamInput & { published_at: string | null }>): Promise<ResultExam> {
  const { data, error } = await supabase.from('result_exams').update(patch).eq('id', id).select('*').single();
  if (error) throw error;
  return numExam(data as ResultExam);
}
export async function deleteResultExam(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from('result_exams').delete().eq('id', id);
  if (error) throw error;
}
export async function duplicateResultExam(supabase: SupabaseClient, id: string, name?: string): Promise<string> {
  const { data, error } = await supabase.rpc('result_exam_duplicate', { p_exam: id, p_name: name ?? null });
  if (error) throw error;
  return data as string;
}
export async function setExamLock(supabase: SupabaseClient, id: string, locked: boolean): Promise<ResultExam> {
  const { data, error } = await supabase.rpc('result_exam_set_lock', { p_exam: id, p_locked: locked });
  if (error) throw error;
  return numExam(data as ResultExam);
}

// ---------- Subjects ----------
export async function fetchSubjects(supabase: SupabaseClient, examId: string): Promise<ResultSubject[]> {
  const { data, error } = await supabase.from('result_subjects').select('*').eq('exam_id', examId).order('sort_order').order('created_at');
  if (error) throw error;
  return ((data ?? []) as ResultSubject[]).map(numSubject);
}
export async function fetchSubjectsOf(supabase: SupabaseClient, examIds: string[]): Promise<ResultSubject[]> {
  if (examIds.length === 0) return [];
  const { data, error } = await supabase.from('result_subjects').select('*').in('exam_id', examIds).order('sort_order');
  if (error) throw error;
  return ((data ?? []) as ResultSubject[]).map(numSubject);
}
const numSubject = (s: ResultSubject): ResultSubject => ({
  ...s, full_degree: Number(s.full_degree), pass_degree: Number(s.pass_degree), weight: s.weight === null ? null : Number(s.weight),
});

export type SubjectInput = Pick<ResultSubject, 'name' | 'code' | 'full_degree' | 'pass_degree' | 'weight' | 'is_bonus'>;
export async function createSubject(supabase: SupabaseClient, examId: string, input: SubjectInput, sortOrder: number): Promise<ResultSubject> {
  const { data, error } = await supabase.from('result_subjects').insert({ ...input, exam_id: examId, sort_order: sortOrder }).select('*').single();
  if (error) throw error;
  return numSubject(data as ResultSubject);
}
export async function updateSubject(supabase: SupabaseClient, id: string, patch: Partial<SubjectInput & { sort_order: number }>): Promise<ResultSubject> {
  const { data, error } = await supabase.from('result_subjects').update(patch).eq('id', id).select('*').single();
  if (error) throw error;
  return numSubject(data as ResultSubject);
}
export async function deleteSubject(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from('result_subjects').delete().eq('id', id);
  if (error) throw error;
}
export async function reorderSubjects(supabase: SupabaseClient, ids: string[]): Promise<void> {
  await Promise.all(ids.map((id, i) => supabase.from('result_subjects').update({ sort_order: i + 1 }).eq('id', id)));
}

// ---------- Results ----------
export async function fetchResultRows(supabase: SupabaseClient, examId: string, subjectId?: string): Promise<ExamResultRow[]> {
  const out: ExamResultRow[] = [];
  let from = 0;
  const size = 1000;
  for (;;) {
    let q = supabase.from('exam_results').select('*').eq('exam_id', examId);
    if (subjectId) q = q.eq('subject_id', subjectId);
    const { data, error } = await q.order('id').range(from, from + size - 1);
    if (error) throw error;
    const rows = (data ?? []) as ExamResultRow[];
    out.push(...rows.map((r) => ({ ...r, score: r.score === null ? null : Number(r.score), percent: r.percent === null ? null : Number(r.percent) })));
    if (rows.length < size) break;
    from += size;
  }
  return out;
}

export async function fetchSummary(supabase: SupabaseClient, examId: string): Promise<StudentSummary[]> {
  const { data, error } = await supabase.rpc('result_exam_summary', { p_exam: examId });
  if (error) throw error;
  return ((data ?? []) as StudentSummary[]).map((s) => ({
    ...s,
    total_score: s.total_score === null ? null : Number(s.total_score),
    total_full: Number(s.total_full),
    percent: s.percent === null ? null : Number(s.percent),
  }));
}

export async function fetchStudentHistory(supabase: SupabaseClient, personId: string): Promise<HistoryRow[]> {
  const { data, error } = await supabase.rpc('result_student_history', { p_person: personId });
  if (error) throw error;
  return ((data ?? []) as HistoryRow[]).map((h) => ({
    ...h,
    total_score: h.total_score === null ? null : Number(h.total_score),
    total_full: Number(h.total_full),
    percent: h.percent === null ? null : Number(h.percent),
  }));
}

export interface BulkRow { subject_id: string; enrollment_id: string; score: number | null; status: ResultRowStatus; note?: string | null }
export interface BulkOutcome { subject_id: string; enrollment_id: string; ok: boolean; error?: string }

/** Save in chunks; reports progress; returns every row's outcome. */
export async function saveBulk(
  supabase: SupabaseClient, examId: string, rows: BulkRow[],
  onProgress?: (done: number, total: number) => void, chunk = 100
): Promise<BulkOutcome[]> {
  const out: BulkOutcome[] = [];
  for (let i = 0; i < rows.length; i += chunk) {
    const part = rows.slice(i, i + chunk);
    const { data, error } = await supabase.rpc('result_save_bulk', { p_exam: examId, p_rows: part });
    if (error) {
      part.forEach((r) => out.push({ subject_id: r.subject_id, enrollment_id: r.enrollment_id, ok: false, error: error.message }));
    } else {
      out.push(...((data ?? []) as BulkOutcome[]));
    }
    onProgress?.(Math.min(rows.length, i + chunk), rows.length);
  }
  return out;
}

export async function copyFromExam(supabase: SupabaseClient, from: string, to: string): Promise<number> {
  const { data, error } = await supabase.rpc('result_copy_from_exam', { p_from: from, p_to: to });
  if (error) throw error;
  return (data as number) ?? 0;
}
export async function clearResults(supabase: SupabaseClient, examId: string, subjectId?: string | null, enrollmentIds?: string[] | null): Promise<number> {
  const { data, error } = await supabase.rpc('result_clear', { p_exam: examId, p_subject: subjectId ?? null, p_enrollments: enrollmentIds ?? null });
  if (error) throw error;
  return (data as number) ?? 0;
}

// ---------- Child portal ----------
export interface ChildResultSubject {
  subject_id: string; subject: string; full_degree: number; pass_degree: number; is_bonus: boolean;
  score: number | null; status: ResultRowStatus | null; percent: number | null; passed: boolean | null;
  grade_name: string | null; grade_color: string | null;
}
export interface ChildResult {
  exam_id: string; exam_name: string; exam_date: string | null; academic_year: string | null; published_at: string;
  enrollment_id: string; class_name: string; service_name: string; church_name: string;
  subjects_total: number; subjects_entered: number; total_score: number | null; total_full: number; percent: number | null;
  grade_name: string | null; grade_color: string | null; passed: boolean | null; status: StudentStatus;
  subjects: ChildResultSubject[];
}
export async function fetchChildResults(supabase: SupabaseClient, token: string): Promise<ChildResult[]> {
  const { data, error } = await supabase.rpc('child_portal_results', { p_national_id: token });
  if (error) throw error;
  return ((data ?? []) as ChildResult[]).map((r) => ({
    ...r,
    total_score: r.total_score === null ? null : Number(r.total_score),
    total_full: Number(r.total_full),
    percent: r.percent === null ? null : Number(r.percent),
    subjects: (r.subjects ?? []).map((s) => ({ ...s, full_degree: Number(s.full_degree), pass_degree: Number(s.pass_degree), score: s.score === null ? null : Number(s.score), percent: s.percent === null ? null : Number(s.percent) })),
  }));
}

// ---------- Helpers ----------
export const fmtNum = (n: number | null | undefined) =>
  n === null || n === undefined || Number.isNaN(n) ? '—' : (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));
export const fmtPct = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${fmtNum(n)}٪`);
export const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return '—';
  try { return new Intl.DateTimeFormat('ar-EG', { timeZone: 'Africa/Cairo', dateStyle: 'medium' }).format(new Date(iso)); } catch { return iso; }
};
export const fmtDateTime = (iso: string | null | undefined) => {
  if (!iso) return '—';
  try { return new Intl.DateTimeFormat('ar-EG', { timeZone: 'Africa/Cairo', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)); } catch { return iso; }
};

/** «كنيسة ← خدمة ← فصل» */
export function examScopeLabel(
  x: { church_id: string; service_id: string | null; class_id: string | null },
  churches: { id: string; name: string }[], services: { id: string; name: string }[], classes: { id: string; name: string }[]
) {
  const church = churches.find((c) => c.id === x.church_id)?.name ?? '';
  if (x.service_id === null) return `${church} ← كل الخدمات`;
  const service = services.find((s) => s.id === x.service_id)?.name ?? '';
  if (x.class_id === null) return `${church} ← ${service} ← كل الفصول`;
  return `${church} ← ${service} ← ${classes.find((c) => c.id === x.class_id)?.name ?? ''}`;
}

/** Aggregate statistics for the dashboard / reports */
export interface ExamStats {
  students: number; completed: number; passed: number; failed: number; absent: number; notEntered: number; incomplete: number;
  passRate: number | null; average: number | null; highest: StudentSummary | null; lowest: StudentSummary | null;
  gradeDist: { id: string | null; name: string; color: string | null; count: number }[];
}
export function computeStats(rows: StudentSummary[], grades: GradingGrade[], systemId: string | null): ExamStats {
  const final = rows.filter((r) => r.status === 'passed' || r.status === 'failed');
  const passed = final.filter((r) => r.passed).length;
  const failed = final.length - passed;
  const pcts = final.map((r) => r.percent).filter((p): p is number => p !== null);
  const avg = pcts.length ? Math.round((pcts.reduce((a, b) => a + b, 0) / pcts.length) * 100) / 100 : null;
  const sorted = [...final].filter((r) => r.percent !== null).sort((a, b) => (b.percent ?? 0) - (a.percent ?? 0));
  const bands = grades.filter((g) => g.grading_system_id === systemId).sort((a, b) => b.min_percent - a.min_percent);
  const dist: ExamStats["gradeDist"] = bands.map((g) => ({ id: g.id, name: g.name, color: g.color, count: final.filter((r) => r.grade_id === g.id).length }));
  const none = final.filter((r) => !r.grade_id).length;
  if (none && bands.length) dist.push({ id: null, name: 'بدون تقدير', color: null, count: none });
  return {
    students: rows.length,
    completed: final.length,
    passed, failed,
    absent: rows.filter((r) => r.status === 'absent').length,
    notEntered: rows.filter((r) => r.status === 'not_entered').length,
    incomplete: rows.filter((r) => r.status === 'incomplete' || r.status === 'draft').length,
    passRate: final.length ? Math.round((passed / final.length) * 1000) / 10 : null,
    average: avg,
    highest: sorted[0] ?? null,
    lowest: sorted.length ? sorted[sorted.length - 1] : null,
    gradeDist: dist,
  };
}

export const rankLabel = (r: number | null) => (r === null ? '—' : r === 1 ? 'الأول' : r === 2 ? 'الثاني' : r === 3 ? 'الثالث' : `${r}`);

/** Sanitize a file name for Excel export */
export const safeFile = (s: string) => s.replace(/[\\/:*?"<>|]/g, '_');
