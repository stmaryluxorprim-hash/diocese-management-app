// ---------- Backup & Restore — النسخ الاحتياطي والاسترجاع (migration 0044) ----------
//
// One engine, two callers:
//   • the browser (owner, /settings/backup) — manual backup downloaded to the
//     device, restore from a file on the device;
//   • the server (/api/backup/cron, service role) — scheduled backups saved
//     in the private `backups` bucket.
// Both talk to the same security-definer RPCs, so the code below only needs
// a SupabaseClient.
//
// FILE FORMAT (.json — a single JSON document, readable, diff-able):
// {
//   format: 'dma-backup', version: 1, created_at, app_version,
//   tables: { [name]: { columns: string[], rows: object[] } },
//   auth_users?: [{ id, email, encrypted_password, ... }],   // servants' login accounts
//   counts: { [name]: n }
// }

import type { SupabaseClient } from '@supabase/supabase-js';

export const BACKUP_FORMAT = 'dma-backup';
export const BACKUP_VERSION = 1;
export const AUTH_USERS_KEY = '__auth_users';   // pseudo-table in the selector

/** page size for dumping / staging (rows per RPC call) */
export const DUMP_PAGE = 1000;
export const STAGE_CHUNK = 500;

// ---------- catalogue (from the DB) ----------
export interface BackupTableInfo {
  name: string;
  rows: number;
  pk: string[];
  columns: string[];
  parents: string[];
}

// ---------- Arabic labels + groups ----------
// Every table known to the app. Tables that appear in the DB but are not
// listed here (a future migration) still show up — under «أخرى» with their
// raw name — so a backup is never silently incomplete.
export interface BackupGroup { key: string; label: string; desc: string }

export const BACKUP_GROUPS: BackupGroup[] = [
  { key: 'structure',     label: 'الهيكل',                 desc: 'الكنائس والخدمات والفصول والمناسبات' },
  { key: 'people',        label: 'الأشخاص والتسجيلات',      desc: 'المخدومون وتسجيلاتهم وكلمات المرور وطلبات الانضمام' },
  { key: 'servants',      label: 'الخدام والصلاحيات',       desc: 'حسابات الخدام · ملفات الصلاحيات · الوحدات' },
  { key: 'activity',      label: 'الحضور والنقاط والافتقاد', desc: 'سجلات الحضور والنقاط والمكالمات والأسباب' },
  { key: 'messages',      label: 'الرسائل والإشعارات',      desc: 'المحادثات · الإشعارات · الأتمتة · أجهزة الدفع' },
  { key: 'modules',       label: 'الوحدات',                desc: 'المتجر · الامتحانات · النتائج · المكتبة · الفصول الأونلاين · الإنجازات · الفعاليات · أعياد الميلاد · الأشابين' },
  { key: 'cards',         label: 'الكروت والطباعة',         desc: 'قوالب الكروت وطلبات الطباعة' },
  { key: 'settings',      label: 'الإعدادات والتخصيص',      desc: 'تخصيص التطبيق وسجل النسخ' },
  { key: 'other',         label: 'أخرى',                   desc: 'جداول غير مصنّفة' },
];

export const TABLE_META: Record<string, { label: string; group: string }> = {
  // structure
  churches:                 { label: 'الكنائس', group: 'structure' },
  services:                 { label: 'الخدمات', group: 'structure' },
  classes:                  { label: 'الفصول', group: 'structure' },
  events:                   { label: 'المناسبات (المستوى الرابع)', group: 'structure' },
  // people
  persons:                  { label: 'الأشخاص (بيانات المخدومين والخدام)', group: 'people' },
  enrollments:              { label: 'تسجيلات المخدومين', group: 'people' },
  person_credentials:       { label: 'كلمات مرور بوابة المخدوم', group: 'people' },
  child_sessions:           { label: 'جلسات بوابة المخدوم', group: 'people' },
  account_switch_tickets:   { label: 'تذاكر تبديل الحساب', group: 'people' },
  child_join_requests:      { label: 'طلبات تسجيل المخدومين', group: 'people' },
  priests:                  { label: 'الكهنة', group: 'people' },
  priest_requests:          { label: 'طلبات حسابات الكهنة', group: 'people' },
  priest_confessors:        { label: 'المعترفون (الكهنة)', group: 'people' },
  confessions:              { label: 'سجل الاعترافات', group: 'activity' },
  confession_appointments:  { label: 'مواعيد الاعتراف', group: 'activity' },
  priest_contacts:          { label: 'افتقاد الكهنة', group: 'activity' },
  data_change_requests:     { label: 'طلبات تعديل البيانات', group: 'people' },
  // servants
  servant_enrollments:      { label: 'تسجيلات الخدام (الأدوار والنطاق)', group: 'servants' },
  permission_profiles:      { label: 'ملفات الصلاحيات', group: 'servants' },
  permissions:              { label: 'صلاحيات الخدام', group: 'servants' },
  module_access:            { label: 'صلاحيات الوحدات (نطاقات)', group: 'servants' },
  // activity
  attendance_log:           { label: 'سجل الحضور', group: 'activity' },
  points_log:               { label: 'سجل النقاط', group: 'activity' },
  causes:                   { label: 'أسباب النقاط', group: 'activity' },
  contact_log:              { label: 'سجل الافتقاد (مكالمات ورسائل)', group: 'activity' },
  call_feedbacks:           { label: 'نتائج الافتقاد', group: 'activity' },
  // messages
  chat_messages:            { label: 'الرسائل', group: 'messages' },
  chat_read_state:          { label: 'حالة قراءة الرسائل', group: 'messages' },
  notifications:            { label: 'الإشعارات', group: 'messages' },
  notification_recipients:  { label: 'مستلمو الإشعارات', group: 'messages' },
  notification_automations: { label: 'أتمتة الإشعارات', group: 'messages' },
  notification_automation_runs: { label: 'سجل تشغيل الأتمتة', group: 'messages' },
  push_subscriptions:       { label: 'أجهزة الإشعارات (Push)', group: 'messages' },
  // modules
  store_items:              { label: 'المتجر — الأصناف', group: 'modules' },
  store_orders:             { label: 'المتجر — الطلبات', group: 'modules' },
  store_order_items:        { label: 'المتجر — بنود الطلبات', group: 'modules' },
  exams:                    { label: 'الامتحانات', group: 'modules' },
  exam_questions:           { label: 'الامتحانات — الأسئلة', group: 'modules' },
  exam_attempts:            { label: 'الامتحانات — المحاولات', group: 'modules' },
  exam_answers:             { label: 'الامتحانات — الإجابات', group: 'modules' },
  grading_systems:          { label: 'النتائج — أنظمة التقدير', group: 'modules' },
  grading_grades:           { label: 'النتائج — التقديرات', group: 'modules' },
  result_exams:             { label: 'النتائج — الامتحانات', group: 'modules' },
  result_subjects:          { label: 'النتائج — المواد', group: 'modules' },
  exam_results:             { label: 'النتائج — درجات الطلاب', group: 'modules' },
  library_subjects:         { label: 'المكتبة — الأقسام', group: 'modules' },
  library_books:            { label: 'المكتبة — الكتب', group: 'modules' },
  library_lectures:         { label: 'المكتبة — المحاضرات', group: 'modules' },
  library_favorites:        { label: 'المكتبة — المفضلة', group: 'modules' },
  online_classes:           { label: 'الفصول الأونلاين', group: 'modules' },
  online_class_participants:{ label: 'الفصول الأونلاين — المشاركون', group: 'modules' },
  online_class_sessions:    { label: 'الفصول الأونلاين — الجلسات', group: 'modules' },
  online_class_questions:   { label: 'الفصول الأونلاين — الأسئلة', group: 'modules' },
  online_class_answers:     { label: 'الفصول الأونلاين — الإجابات', group: 'modules' },
  online_class_checks:      { label: 'الفصول الأونلاين — فحص الحضور', group: 'modules' },
  online_class_check_responses: { label: 'الفصول الأونلاين — ردود الفحص', group: 'modules' },
  online_class_messages:    { label: 'الفصول الأونلاين — المحادثة', group: 'modules' },
  achievements:             { label: 'الإنجازات', group: 'modules' },
  user_achievements:        { label: 'الإنجازات — الحاصلون', group: 'modules' },
  occasions:                { label: 'الفعاليات', group: 'modules' },
  occasion_registrations:   { label: 'الفعاليات — المسجّلون', group: 'modules' },
  occasion_checklist_items: { label: 'الفعاليات — قوائم التحقق', group: 'modules' },
  occasion_checklist_marks: { label: 'الفعاليات — علامات التحقق', group: 'modules' },
  occasion_notifications:   { label: 'الفعاليات — الإعلانات', group: 'modules' },
  birthday_settings:        { label: 'أعياد الميلاد — الإعدادات', group: 'modules' },
  birthday_greetings:       { label: 'أعياد الميلاد — التهاني', group: 'modules' },
  birthday_card_templates:  { label: 'أعياد الميلاد — قوالب الكروت', group: 'modules' },
  shepherd_groups:          { label: 'الأشابين — المجموعات', group: 'modules' },
  // cards
  card_templates:           { label: 'قوالب الكروت', group: 'cards' },
  card_print_profiles:      { label: 'ملفات الطباعة المحفوظة', group: 'cards' },
  card_print_requests:      { label: 'طلبات طباعة الكروت', group: 'cards' },
  report_templates:         { label: 'قوالب التقارير والجداول', group: 'cards' },
  // settings
  app_settings:             { label: 'تخصيص التطبيق (الشريط · الرأس · الأسماء · الأكواد)', group: 'settings' },
  backup_schedules:         { label: 'النسخ الاحتياطية المجدولة', group: 'settings' },
  backup_runs:              { label: 'سجل النسخ الاحتياطية', group: 'settings' },
};

export const AUTH_USERS_META = { label: 'حسابات دخول الخدام (البريد وكلمة المرور المشفّرة)', group: 'servants' };

export const tableLabel = (name: string) =>
  name === AUTH_USERS_KEY ? AUTH_USERS_META.label : (TABLE_META[name]?.label ?? name);
export const tableGroup = (name: string) =>
  name === AUTH_USERS_KEY ? AUTH_USERS_META.group : (TABLE_META[name]?.group ?? 'other');

// ---------- file ----------
export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: number;
  created_at: string;
  app_version?: string;
  kind?: 'manual' | 'scheduled';
  tables: Record<string, { columns: string[]; rows: Record<string, unknown>[] }>;
  auth_users?: Record<string, unknown>[];
  counts: Record<string, number>;
}

export type BackupProgress = { phase: 'dump' | 'stage' | 'delete' | 'apply' | 'fixup' | 'auth' | 'done'; table?: string; done: number; total: number; message?: string };

export type RestoreMode = 'merge' | 'replace';
export const RESTORE_MODE_LABELS: Record<RestoreMode, { label: string; desc: string }> = {
  merge:   { label: 'دمج (آمن)',   desc: 'يضيف السجلات الناقصة ويحدّث الموجودة بنفس المعرّف — لا يحذف شيئًا' },
  replace: { label: 'استبدال كامل', desc: 'يعيد الجداول المختارة كما كانت في النسخة تمامًا — السجلات غير الموجودة في النسخة تُحذف' },
};

// ---------- errors ----------
const MESSAGES: Record<string, string> = {
  not_allowed: 'النسخ الاحتياطي متاح لمالك التطبيق فقط',
  unknown_table: 'الملف يحوي جدولاً غير معروف في قاعدة البيانات',
  bad_format: 'هذا الملف ليس نسخة احتياطية من التطبيق',
  no_tables: 'اختر جدولاً واحدًا على الأقل',
  job_not_found: 'انتهت جلسة الاسترجاع — أعد المحاولة',
  job_closed: 'انتهت جلسة الاسترجاع — أعد المحاولة',
  not_configured: 'الخادم غير مُهيّأ (SUPABASE_SERVICE_ROLE_KEY)',
  network: 'تعذر الاتصال بالخادم',
};
/** Postgres errors the owner may still meet → Arabic explanation + the raw text. */
function translatePgError(raw: string): string | null {
  const fk = raw.match(/insert or update on table "(\w+)" violates foreign key constraint "(\w+)"/);
  if (fk) {
    return `سجلات «${tableLabel(fk[1])}» تشير إلى سجل غير موجود في قاعدة البيانات (${fk[2]}). ` +
      'استرجع «الهيكل» و«الخدام» و«حسابات الدخول» مع هذا الجدول في نفس العملية، أو حدّث قاعدة البيانات إلى آخر إصدار (migration 20260922).';
  }
  const uq = raw.match(/duplicate key value violates unique constraint "(\w+)"/);
  if (uq) return `تعارض في قيمة فريدة (${uq[1]}) — يوجد سجل آخر بنفس الكود / الاسم. استخدم «استبدال» أو احذف السجل المكرر أولاً.`;
  const nn = raw.match(/null value in column "(\w+)" of relation "(\w+)" violates not-null constraint/);
  if (nn) return `عمود «${nn[1]}» في «${tableLabel(nn[2])}» لا يقبل فراغًا — النسخة من إصدار أقدم من قاعدة البيانات.`;
  if (/function public\.backup_restore_fixup/.test(raw) && /does not exist/.test(raw)) {
    return 'قاعدة البيانات تحتاج تحديثًا — شغّل migration 20260922_backup_restore_fk_order ثم أعد المحاولة.';
  }
  return null;
}
export function backupErrorMessage(e: unknown): string {
  const raw = typeof e === 'string' ? e : (e as { message?: string })?.message ?? '';
  const key = raw.split(':')[0].trim();
  if (MESSAGES[key]) return MESSAGES[key] + (raw.includes(':') ? ` (${raw.split(':').slice(1).join(':')})` : '');
  const pg = translatePgError(raw);
  if (pg) return `${pg}\n${raw}`;
  return raw || 'حدث خطأ غير متوقع';
}

// ---------- catalogue ----------
export async function fetchBackupTables(supabase: SupabaseClient): Promise<BackupTableInfo[]> {
  const { data, error } = await supabase.rpc('backup_tables');
  if (error) throw new Error(error.message);
  return (data as BackupTableInfo[]) ?? [];
}

// ---------- export ----------
export interface ExportOptions {
  tables: string[];              // real table names
  includeAuth: boolean;
  kind?: 'manual' | 'scheduled';
  appVersion?: string;
  onProgress?: (p: BackupProgress) => void;
  catalogue?: BackupTableInfo[]; // to size the progress bar
}

export async function exportBackup(supabase: SupabaseClient, opts: ExportOptions): Promise<BackupFile> {
  const cat = opts.catalogue ?? (await fetchBackupTables(supabase));
  const byName = new Map(cat.map((t) => [t.name, t]));
  const totalRows = opts.tables.reduce((s, t) => s + (byName.get(t)?.rows ?? 0), 0) + (opts.includeAuth ? 1 : 0);
  let done = 0;

  const file: BackupFile = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    created_at: new Date().toISOString(),
    app_version: opts.appVersion,
    kind: opts.kind ?? 'manual',
    tables: {},
    counts: {},
  };

  for (const t of opts.tables) {
    const info = byName.get(t);
    if (!info) throw new Error(`unknown_table:${t}`);
    const rows: Record<string, unknown>[] = [];
    let offset = 0;
    for (;;) {
      const { data, error } = await supabase.rpc('backup_dump_table', { p_table: t, p_offset: offset, p_limit: DUMP_PAGE });
      if (error) throw new Error(error.message);
      const page = (data as Record<string, unknown>[]) ?? [];
      rows.push(...page);
      offset += page.length;
      done += page.length;
      opts.onProgress?.({ phase: 'dump', table: t, done: Math.min(done, totalRows), total: totalRows });
      if (page.length < DUMP_PAGE) break;
    }
    file.tables[t] = { columns: info.columns, rows };
    file.counts[t] = rows.length;
  }

  if (opts.includeAuth) {
    opts.onProgress?.({ phase: 'auth', done, total: totalRows });
    const { data, error } = await supabase.rpc('backup_dump_auth_users');
    if (error) throw new Error(error.message);
    file.auth_users = (data as Record<string, unknown>[]) ?? [];
    file.counts[AUTH_USERS_KEY] = file.auth_users.length;
    done += 1;
  }
  opts.onProgress?.({ phase: 'done', done: totalRows, total: totalRows });
  return file;
}

export function backupFileName(kind: 'manual' | 'scheduled' = 'manual', date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}_${p(date.getHours())}-${p(date.getMinutes())}`;
  return `dma-backup_${kind}_${stamp}.json`;
}

export function serializeBackup(file: BackupFile): string {
  return JSON.stringify(file);
}

/** Browser only — trigger a download of the file. */
export function downloadBackup(file: BackupFile, name = backupFileName(file.kind)) {
  const blob = new Blob([serializeBackup(file)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function formatBytes(n: number | null | undefined): string {
  if (!n) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

// ---------- parse ----------
export function parseBackup(text: string): BackupFile {
  let obj: unknown;
  try { obj = JSON.parse(text); } catch { throw new Error('bad_format'); }
  const f = obj as Partial<BackupFile>;
  if (!f || f.format !== BACKUP_FORMAT || typeof f.tables !== 'object' || !f.tables) throw new Error('bad_format');
  if ((f.version ?? 0) > BACKUP_VERSION) throw new Error('bad_format:الملف من إصدار أحدث من التطبيق');
  const tables: BackupFile['tables'] = {};
  for (const [name, v] of Object.entries(f.tables)) {
    if (!v || !Array.isArray(v.rows)) continue;
    const columns = Array.isArray(v.columns) && v.columns.length
      ? v.columns
      : Array.from(new Set(v.rows.flatMap((r) => Object.keys(r ?? {}))));
    tables[name] = { columns, rows: v.rows };
  }
  return {
    format: BACKUP_FORMAT,
    version: f.version ?? 1,
    created_at: f.created_at ?? '',
    app_version: f.app_version,
    kind: f.kind,
    tables,
    auth_users: Array.isArray(f.auth_users) ? f.auth_users : undefined,
    counts: f.counts ?? Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.rows.length])),
  };
}

// ---------- restore ----------
export interface RestoreOptions {
  file: BackupFile;
  tables: string[];         // real table names to restore (subset of file.tables)
  mode: RestoreMode;
  restoreAuth: boolean;     // → /api/backup/auth-restore (server, service role)
  onProgress?: (p: BackupProgress) => void;
}
export interface RestoreTableResult {
  upserted?: number;
  deleted?: number;
  detached?: number;            // replace: references to deleted rows set to null
  deferred?: number;            // nullable FK values inserted as null first (parent not there yet)
  resolved?: number;            // …re-attached once the parent arrived
  unresolved?: number;          // …parent never arrived → stays null
  unresolved_samples?: { pk: Record<string, unknown>; column: string; value: unknown }[];
  skipped?: number;             // rows whose NOT NULL parent outside public (auth.users) is missing
  skipped_samples?: unknown[];
}
export interface RestoreResult {
  jobId: string;
  tables: Record<string, RestoreTableResult>;
  auth?: { created: number; updated: number; failed: number; errors: string[] };
  skipped: string[];        // tables in the file the DB does not know
}

export async function restoreBackup(supabase: SupabaseClient, opts: RestoreOptions): Promise<RestoreResult> {
  const cat = await fetchBackupTables(supabase);
  const known = new Set(cat.map((t) => t.name));
  const tables = opts.tables.filter((t) => known.has(t) && opts.file.tables[t]);
  const skipped = opts.tables.filter((t) => !known.has(t));
  if (tables.length === 0 && !opts.restoreAuth) throw new Error('no_tables');

  const columns = Object.fromEntries(tables.map((t) => [t, opts.file.tables[t].columns]));
  const totalRows = tables.reduce((s, t) => s + opts.file.tables[t].rows.length, 0);
  // progress: auth + stage (rows) + apply (rows)
  const total = totalRows * 2 + (opts.restoreAuth ? 1 : 0);
  let done = 0;
  const prog = (phase: BackupProgress['phase'], table?: string, message?: string) =>
    opts.onProgress?.({ phase, table, done: Math.min(done, total), total, message });

  const result: RestoreResult = { jobId: '', tables: {}, skipped };

  // 0. login accounts FIRST — servant_enrollments.id → auth.users, so the
  //    servants (and everything that points at them) need the accounts in place.
  if (opts.restoreAuth && opts.file.auth_users?.length) {
    prog('auth', undefined, 'استرجاع حسابات الدخول…');
    try {
      const res = await fetch('/api/backup/auth-restore', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ users: opts.file.auth_users }),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error((data.error as string) ?? 'failed');
      result.auth = data as unknown as RestoreResult['auth'];
    } catch (e) {
      throw new Error(`حسابات الدخول: ${backupErrorMessage(e)}`);
    }
    done += 1;
  }

  if (tables.length > 0) {
    const { data: jid, error: e0 } = await supabase.rpc('backup_restore_begin', {
      p_mode: opts.mode, p_tables: tables,
      p_meta: { columns, file: { created_at: opts.file.created_at, app_version: opts.file.app_version } },
    });
    if (e0) throw new Error(e0.message);
    const jobId = jid as string;
    result.jobId = jobId;

    try {
      // 1. stage
      for (const t of tables) {
        const rows = opts.file.tables[t].rows;
        for (let i = 0, seq = 0; i < rows.length || (rows.length === 0 && seq === 0); i += STAGE_CHUNK, seq += 1) {
          const chunk = rows.slice(i, i + STAGE_CHUNK);
          const { error } = await supabase.rpc('backup_restore_stage', { p_job: jobId, p_table: t, p_seq: seq, p_rows: chunk });
          if (error) throw new Error(`${t}: ${error.message}`);
          done += chunk.length;
          prog('stage', t);
          if (rows.length === 0) break;
        }
      }

      // 2. FK order
      const { data: orderData, error: e1 } = await supabase.rpc('backup_restore_order', { p_job: jobId });
      if (e1) throw new Error(e1.message);
      const order = (orderData as { table: string; seqs: number[]; rows: number }[]) ?? [];

      // 3. replace → delete missing, children first
      if (opts.mode === 'replace') {
        for (const o of [...order].reverse()) {
          prog('delete', o.table);
          const { error } = await supabase.rpc('backup_restore_delete_missing', { p_job: jobId, p_table: o.table });
          if (error) throw new Error(`${o.table}: ${error.message}`);
        }
      }

      // 4. apply, parents first
      for (const o of order) {
        let remaining = o.rows;
        for (const seq of o.seqs) {
          const { error } = await supabase.rpc('backup_restore_apply_chunk', { p_job: jobId, p_table: o.table, p_seq: seq });
          if (error) throw new Error(`${tableLabel(o.table)}: ${error.message}`);
          const step = Math.min(STAGE_CHUNK, remaining);
          remaining -= step;
          done += step;
          prog('apply', o.table);
        }
      }

      // 5. re-attach the references that were deferred because their parent
      //    row (a servant, a person …) came later in the order — FK cycles
      const { error: e3 } = await supabase.rpc('backup_restore_fixup', { p_job: jobId });
      if (e3) throw new Error(e3.message);
      prog('fixup');

      const { data: fin, error: e2 } = await supabase.rpc('backup_restore_finish', { p_job: jobId, p_status: 'done' });
      if (e2) throw new Error(e2.message);
      result.tables = ((fin as { result?: RestoreResult['tables'] })?.result) ?? {};
    } catch (err) {
      await supabase.rpc('backup_restore_finish', { p_job: jobId, p_status: 'failed', p_error: String((err as Error).message ?? err) }).then(() => undefined, () => undefined);
      throw err;
    }
  }

  prog('done');
  return result;
}

/** Human summary of what a restore could not put back exactly (empty = perfect). */
export function restoreWarnings(r: RestoreResult): string[] {
  const out: string[] = [];
  for (const [t, v] of Object.entries(r.tables)) {
    if (v.skipped) out.push(`${tableLabel(t)}: ${v.skipped} سجل لم يُسترجع لأن حساب الدخول الخاص به غير موجود — استرجع «حسابات الدخول» مع هذا الجدول.`);
    if (v.unresolved) out.push(`${tableLabel(t)}: ${v.unresolved} مرجع (مثل «أُنشئ بواسطة» / «آخر تعديل») يشير إلى خادم غير موجود في قاعدة البيانات — تُرك فارغًا.`);
  }
  return out;
}

// ---------- history / schedules (types mirror the tables) ----------
export interface BackupRun {
  id: string;
  kind: 'manual' | 'scheduled' | 'restore';
  schedule_id: string | null;
  status: 'running' | 'done' | 'failed' | 'partial';
  mode: RestoreMode | null;
  tables: string[];
  include_auth: boolean;
  row_counts: Record<string, number>;
  size_bytes: number | null;
  file_name: string | null;
  storage_path: string | null;
  error: string | null;
  created_by: string | null;
  created_at: string;
  finished_at: string | null;
}

export type BackupFrequency = 'daily' | 'weekly' | 'monthly';
export const FREQUENCY_LABELS: Record<BackupFrequency, string> = { daily: 'يوميًا', weekly: 'أسبوعيًا', monthly: 'شهريًا' };

export interface BackupSchedule {
  id: string;
  name: string;
  enabled: boolean;
  frequency: BackupFrequency;
  weekday: number;
  day_of_month: number;
  hour: number;
  tables: string[] | null;
  include_auth: boolean;
  keep_last: number;
  last_run_at: string | null;
  last_status: string | null;
  next_run_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export const RUN_STATUS_LABELS: Record<BackupRun['status'], string> = {
  running: 'جارٍ…', done: 'تمّت', failed: 'فشلت', partial: 'جزئية',
};
export const RUN_KIND_LABELS: Record<BackupRun['kind'], string> = {
  manual: 'نسخة يدوية', scheduled: 'نسخة مجدولة', restore: 'استرجاع',
};

/** Write a row in backup_runs (best effort — never breaks the flow). */
export async function logBackupRun(
  supabase: SupabaseClient,
  row: Partial<BackupRun> & { kind: BackupRun['kind'] }
): Promise<string | null> {
  const { data } = await supabase.from('backup_runs').insert(row).select('id').maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}
