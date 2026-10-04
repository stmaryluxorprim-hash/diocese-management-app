// ---------- ACTIVITY LOG (سجل النشاط) — migration 0047 ----------
// Types + Arabic registry for the audit rows written by the DB trigger and
// by `log_activity()`. Everything the module screens need to turn a raw row
// («persons · UPDATE · person.update · changed[phone]») into a sentence
// («خادم أ عدّل بيانات John — الهاتف») lives here.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { LucideIcon } from 'lucide-react';
import {
  UserCheck, Star, Phone, MessageSquare, User, Users, ShieldCheck, Church, Layers, School, CalendarDays,
  Coins, PhoneCall, IdCard, ClipboardList, KeyRound, HeartHandshake, ShoppingBag, GraduationCap, Cake,
  MessageCircle, Video, Trophy, Tent, Bell, Settings, ClipboardCheck, Percent, Library, Database, LogIn,
  LogOut, Activity, Crown, FileSpreadsheet, Printer, ScanLine, Eye, Trash2, Pencil, Plus, Lock, Unlock,
  Ban, CheckCircle2, XCircle, Pause, Play, ArrowLeftRight, Cog, History, Globe, UsersRound, DoorOpen,
} from 'lucide-react';

// ---------- row ----------
export type ActorKind = 'servant' | 'child' | 'priest' | 'system';
export type ActivityOp = 'INSERT' | 'UPDATE' | 'DELETE' | 'EVENT';

export interface ActivityRow {
  id: string;
  created_at: string;
  actor_kind: ActorKind;
  actor_id: string | null;
  actor_name: string | null;
  actor_role: string | null;
  table_name: string;
  op: ActivityOp;
  action: string;
  changed: string[] | null;
  row_id: string | null;
  target_kind: string | null;
  target_person_id: string | null;
  target_name: string | null;
  enrollment_id: string | null;
  church_id: string | null;
  service_id: string | null;
  class_id: string | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  meta: Record<string, unknown> | null;
  batch_id: string | null;
  batch_size: number;
  source: 'db' | 'app' | 'system';
}

export interface ActivityFilters {
  actor_kind?: ActorKind;
  actor_id?: string;
  action?: string;
  actions?: string[];
  action_prefix?: string;
  table_name?: string;
  op?: ActivityOp;
  target_person_id?: string;
  enrollment_id?: string;
  row_id?: string;
  batch_id?: string;
  church_id?: string;
  service_id?: string;
  class_id?: string;
  from?: string;
  to?: string;
  q?: string;
}

export interface ActivityActor {
  actor_kind: ActorKind;
  actor_id: string | null;
  actor_name: string | null;
  actor_role: string | null;
  n: number;
  last_at: string;
  first_at: string;
}

export interface ActivitySummary {
  total: number;
  today: number;
  first_at: string | null;
  last_at: string | null;
  by_action: { action: string; n: number; last_at: string }[];
  by_table: { table_name: string; n: number }[];
  by_op: { op: ActivityOp; n: number }[];
  by_actor: (Omit<ActivityActor, 'first_at'>)[];
  by_day: { day: string; n: number }[];
  by_hour: { hour: number; n: number }[];
}

export interface ActivityPermissions { view: boolean; view_all: boolean; manage: boolean }

export interface ActivitySettings { keep_days: number; enabled: boolean; rows: number; oldest: string | null }

/** How many rows one «dig» loads — the user picks. */
export const PAGE_SIZES = [10, 100, 1000] as const;
export type PageSize = (typeof PAGE_SIZES)[number];

// ---------- registry: groups (the «by operation» tab is organised by them) ----------
export interface ActivityGroup {
  key: string;            // prefix of the action key: 'attendance' · 'person' · …
  label: string;
  icon: LucideIcon;
  color: string;          // text color
  bg: string;             // soft background
}

export const ACTIVITY_GROUPS: ActivityGroup[] = [
  { key: 'attendance', label: 'الحضور', icon: UserCheck, color: 'text-emerald-600', bg: 'bg-emerald-50' },
  { key: 'points', label: 'النقاط', icon: Star, color: 'text-amber-600', bg: 'bg-amber-50' },
  { key: 'call', label: 'المكالمات', icon: Phone, color: 'text-sky-600', bg: 'bg-sky-50' },
  { key: 'message', label: 'الرسائل', icon: MessageSquare, color: 'text-sky-700', bg: 'bg-sky-50' },
  { key: 'person', label: 'بيانات الأشخاص', icon: User, color: 'text-primary-600', bg: 'bg-primary-50' },
  { key: 'enrollment', label: 'تسجيلات المخدومين', icon: Users, color: 'text-indigo-600', bg: 'bg-indigo-50' },
  { key: 'password', label: 'كلمات المرور', icon: KeyRound, color: 'text-slate-600', bg: 'bg-slate-100' },
  { key: 'data_request', label: 'طلبات تعديل البيانات', icon: ClipboardList, color: 'text-violet-600', bg: 'bg-violet-50' },
  { key: 'join_request', label: 'طلبات انضمام المخدومين', icon: ClipboardList, color: 'text-violet-700', bg: 'bg-violet-50' },
  { key: 'print_request', label: 'طلبات طباعة الكروت', icon: IdCard, color: 'text-rose-600', bg: 'bg-rose-50' },
  { key: 'card_template', label: 'تصميم الكروت', icon: IdCard, color: 'text-rose-700', bg: 'bg-rose-50' },
  { key: 'servant', label: 'الخدام', icon: ShieldCheck, color: 'text-rose-600', bg: 'bg-rose-50' },
  { key: 'servant_mirror', label: 'صفوف الخدام (مرآة)', icon: ShieldCheck, color: 'text-rose-400', bg: 'bg-rose-50' },
  { key: 'servant_scope', label: 'أماكن خدمة الخدام', icon: ShieldCheck, color: 'text-rose-500', bg: 'bg-rose-50' },
  { key: 'permission', label: 'الصلاحيات', icon: KeyRound, color: 'text-fuchsia-600', bg: 'bg-fuchsia-50' },
  { key: 'permission_profile', label: 'ملفات الصلاحيات', icon: KeyRound, color: 'text-fuchsia-700', bg: 'bg-fuchsia-50' },
  { key: 'module_access', label: 'صلاحيات الوحدات', icon: Crown, color: 'text-yellow-600', bg: 'bg-yellow-50' },
  { key: 'church', label: 'الكنائس', icon: Church, color: 'text-emerald-700', bg: 'bg-emerald-50' },
  { key: 'service', label: 'الخدمات', icon: Layers, color: 'text-emerald-600', bg: 'bg-emerald-50' },
  { key: 'class', label: 'الفصول', icon: School, color: 'text-emerald-500', bg: 'bg-emerald-50' },
  { key: 'event', label: 'المناسبات', icon: CalendarDays, color: 'text-cyan-600', bg: 'bg-cyan-50' },
  { key: 'cause', label: 'أسباب النقاط', icon: Coins, color: 'text-amber-700', bg: 'bg-amber-50' },
  { key: 'feedback', label: 'نتائج الافتقاد', icon: PhoneCall, color: 'text-sky-600', bg: 'bg-sky-50' },
  { key: 'shepherd', label: 'الأشابين', icon: HeartHandshake, color: 'text-teal-600', bg: 'bg-teal-50' },
  { key: 'store_item', label: 'مخزون النقاط', icon: ShoppingBag, color: 'text-orange-600', bg: 'bg-orange-50' },
  { key: 'store_order', label: 'فواتير الاستبدال', icon: ShoppingBag, color: 'text-orange-700', bg: 'bg-orange-50' },
  { key: 'store_shop', label: 'المتاجر', icon: ShoppingBag, color: 'text-orange-800', bg: 'bg-orange-50' },
  { key: 'store_shop_target', label: 'أماكن المتاجر', icon: ShoppingBag, color: 'text-orange-500', bg: 'bg-orange-50' },
  { key: 'store_request', label: 'طلبات الشراء', icon: ShoppingBag, color: 'text-orange-600', bg: 'bg-orange-50' },
  { key: 'exam', label: 'الامتحانات', icon: GraduationCap, color: 'text-violet-600', bg: 'bg-violet-50' },
  { key: 'exam_question', label: 'أسئلة الامتحانات', icon: GraduationCap, color: 'text-violet-500', bg: 'bg-violet-50' },
  { key: 'exam_attempt', label: 'محاولات الامتحانات', icon: GraduationCap, color: 'text-violet-700', bg: 'bg-violet-50' },
  { key: 'birthday', label: 'أعياد الميلاد', icon: Cake, color: 'text-pink-600', bg: 'bg-pink-50' },
  { key: 'birthday_setting', label: 'إعدادات أعياد الميلاد', icon: Cake, color: 'text-pink-500', bg: 'bg-pink-50' },
  { key: 'birthday_card', label: 'كروت التهنئة', icon: Cake, color: 'text-pink-700', bg: 'bg-pink-50' },
  { key: 'chat', label: 'المحادثات', icon: MessageCircle, color: 'text-sky-600', bg: 'bg-sky-50' },
  { key: 'online_class', label: 'الفصول الأونلاين', icon: Video, color: 'text-red-600', bg: 'bg-red-50' },
  { key: 'online_participant', label: 'حضور الفصول الأونلاين', icon: Video, color: 'text-red-500', bg: 'bg-red-50' },
  { key: 'online_class_checks', label: 'فحوص الانتباه', icon: Video, color: 'text-red-400', bg: 'bg-red-50' },
  { key: 'online_class_questions', label: 'أسئلة الفصول الأونلاين', icon: Video, color: 'text-red-400', bg: 'bg-red-50' },
  { key: 'online_class_answers', label: 'إجابات الفصول الأونلاين', icon: Video, color: 'text-red-400', bg: 'bg-red-50' },
  { key: 'achievement', label: 'الإنجازات', icon: Trophy, color: 'text-amber-600', bg: 'bg-amber-50' },
  { key: 'achievement_award', label: 'منح الإنجازات', icon: Trophy, color: 'text-amber-700', bg: 'bg-amber-50' },
  { key: 'occasion', label: 'الفعاليات', icon: Tent, color: 'text-cyan-600', bg: 'bg-cyan-50' },
  { key: 'occasion_registration', label: 'مشاركو الفعاليات', icon: Tent, color: 'text-cyan-700', bg: 'bg-cyan-50' },
  { key: 'occasion_checklist', label: 'قوائم تحقق الفعاليات', icon: Tent, color: 'text-cyan-500', bg: 'bg-cyan-50' },
  { key: 'occasion_mark', label: 'علامات قوائم التحقق', icon: Tent, color: 'text-cyan-500', bg: 'bg-cyan-50' },
  { key: 'occasion_notifications', label: 'إعلانات الفعاليات', icon: Tent, color: 'text-cyan-500', bg: 'bg-cyan-50' },
  { key: 'notification', label: 'الإشعارات', icon: Bell, color: 'text-indigo-600', bg: 'bg-indigo-50' },
  { key: 'notification_automation', label: 'الإشعارات التلقائية', icon: Bell, color: 'text-indigo-500', bg: 'bg-indigo-50' },
  { key: 'setting', label: 'إعدادات التطبيق', icon: Settings, color: 'text-slate-600', bg: 'bg-slate-100' },
  { key: 'result_exam', label: 'امتحانات النتائج', icon: ClipboardCheck, color: 'text-emerald-600', bg: 'bg-emerald-50' },
  { key: 'result_subject', label: 'مواد النتائج', icon: ClipboardCheck, color: 'text-emerald-500', bg: 'bg-emerald-50' },
  { key: 'result', label: 'درجات النتائج', icon: ClipboardCheck, color: 'text-emerald-700', bg: 'bg-emerald-50' },
  { key: 'grading', label: 'أنظمة التقدير', icon: Percent, color: 'text-emerald-600', bg: 'bg-emerald-50' },
  { key: 'grading_grade', label: 'شرائح التقدير', icon: Percent, color: 'text-emerald-500', bg: 'bg-emerald-50' },
  { key: 'library_subject', label: 'مواضيع المكتبة', icon: Library, color: 'text-lime-700', bg: 'bg-lime-50' },
  { key: 'library_book', label: 'كتب المكتبة', icon: Library, color: 'text-lime-600', bg: 'bg-lime-50' },
  { key: 'library_lecture', label: 'محاضرات المكتبة', icon: Library, color: 'text-lime-600', bg: 'bg-lime-50' },
  { key: 'library_favorite', label: 'مفضلة المكتبة', icon: Library, color: 'text-lime-500', bg: 'bg-lime-50' },
  { key: 'families', label: 'العائلات', icon: UsersRound, color: 'text-teal-700', bg: 'bg-teal-50' },
  { key: 'family_members', label: 'أفراد العائلات', icon: UsersRound, color: 'text-teal-600', bg: 'bg-teal-50' },
  { key: 'access_events', label: 'بوابات الدخول', icon: DoorOpen, color: 'text-emerald-700', bg: 'bg-emerald-50' },
  { key: 'access_rules', label: 'قواعد الدخول', icon: DoorOpen, color: 'text-emerald-600', bg: 'bg-emerald-50' },
  { key: 'access_rule_groups', label: 'مجموعات قواعد الدخول', icon: DoorOpen, color: 'text-emerald-600', bg: 'bg-emerald-50' },
  { key: 'access_allowed', label: 'المسموح لهم بالدخول', icon: DoorOpen, color: 'text-emerald-600', bg: 'bg-emerald-50' },
  { key: 'access_log', label: 'سجل الدخول', icon: DoorOpen, color: 'text-emerald-500', bg: 'bg-emerald-50' },
  { key: 'backup', label: 'النسخ الاحتياطي', icon: Database, color: 'text-slate-700', bg: 'bg-slate-100' },
  { key: 'backup_schedule', label: 'جداول النسخ الاحتياطي', icon: Database, color: 'text-slate-600', bg: 'bg-slate-100' },
  { key: 'backup_restore_jobs', label: 'استرجاع النسخ', icon: Database, color: 'text-slate-700', bg: 'bg-slate-100' },
  { key: 'auth', label: 'الدخول والخروج', icon: LogIn, color: 'text-blue-600', bg: 'bg-blue-50' },
  { key: 'portal', label: 'بوابة المخدوم', icon: Globe, color: 'text-blue-500', bg: 'bg-blue-50' },
  { key: 'export', label: 'التصدير', icon: FileSpreadsheet, color: 'text-green-700', bg: 'bg-green-50' },
  { key: 'print', label: 'الطباعة', icon: Printer, color: 'text-slate-600', bg: 'bg-slate-100' },
  { key: 'scan', label: 'الماسح', icon: ScanLine, color: 'text-orange-600', bg: 'bg-orange-50' },
  { key: 'activity', label: 'سجل النشاط', icon: History, color: 'text-slate-700', bg: 'bg-slate-100' },
];

export const GROUP_BY_KEY: Record<string, ActivityGroup> = Object.fromEntries(ACTIVITY_GROUPS.map((g) => [g.key, g]));

const FALLBACK_GROUP: ActivityGroup = { key: 'other', label: 'أخرى', icon: Activity, color: 'text-slate-500', bg: 'bg-slate-100' };

export const groupOf = (action: string): ActivityGroup => GROUP_BY_KEY[action.split('.')[0]] ?? FALLBACK_GROUP;

// ---------- verbs ----------
interface VerbDef { label: string; icon: LucideIcon; tone: 'add' | 'edit' | 'remove' | 'neutral' | 'good' | 'bad' }

const VERBS: Record<string, VerbDef> = {
  add: { label: 'أضاف', icon: Plus, tone: 'add' },
  update: { label: 'عدّل', icon: Pencil, tone: 'edit' },
  remove: { label: 'حذف', icon: Trash2, tone: 'remove' },
  deduct: { label: 'خصم', icon: Star, tone: 'bad' },
  counters: { label: 'تحديث العدّادات', icon: ArrowLeftRight, tone: 'neutral' },
  move: { label: 'نقل', icon: ArrowLeftRight, tone: 'edit' },
  stop: { label: 'أوقف', icon: Pause, tone: 'bad' },
  resume: { label: 'أعاد تفعيل', icon: Play, tone: 'good' },
  approve: { label: 'اعتمد', icon: CheckCircle2, tone: 'good' },
  activate: { label: 'فعّل', icon: Play, tone: 'good' },
  deactivate: { label: 'أوقف تفعيل', icon: Pause, tone: 'bad' },
  approved: { label: 'قبِل', icon: CheckCircle2, tone: 'good' },
  reject: { label: 'رفض', icon: XCircle, tone: 'bad' },
  rejected: { label: 'رفض', icon: XCircle, tone: 'bad' },
  suspend: { label: 'علّق', icon: Ban, tone: 'bad' },
  role: { label: 'غيّر دور', icon: ShieldCheck, tone: 'edit' },
  status: { label: 'غيّر حالة', icon: ArrowLeftRight, tone: 'edit' },
  lock: { label: 'قفل', icon: Lock, tone: 'neutral' },
  unlock: { label: 'فتح قفل', icon: Unlock, tone: 'neutral' },
  cancelled: { label: 'ألغى', icon: XCircle, tone: 'bad' },
  completed: { label: 'أتمّ', icon: CheckCircle2, tone: 'good' },
  confirmed: { label: 'أكّد', icon: CheckCircle2, tone: 'good' },
  checked_in: { label: 'سجّل دخول', icon: UserCheck, tone: 'good' },
  pending: { label: 'أعاد للمراجعة', icon: Pause, tone: 'neutral' },
  finished: { label: 'أنهى', icon: CheckCircle2, tone: 'good' },
  live: { label: 'بدأ البث', icon: Play, tone: 'good' },
  ended: { label: 'أنهى', icon: CheckCircle2, tone: 'neutral' },
  open: { label: 'فتح', icon: Play, tone: 'good' },
  closed: { label: 'أغلق', icon: Lock, tone: 'neutral' },
  draft: { label: 'أعاد كمسودة', icon: Pencil, tone: 'neutral' },
  archived: { label: 'أرشف', icon: Database, tone: 'neutral' },
  login: { label: 'سجّل دخول', icon: LogIn, tone: 'good' },
  logout: { label: 'سجّل خروج', icon: LogOut, tone: 'neutral' },
  login_failed: { label: 'محاولة دخول فاشلة', icon: Ban, tone: 'bad' },
  child_login: { label: 'دخل بوابة المخدوم', icon: LogIn, tone: 'good' },
  excel: { label: 'صدّر Excel', icon: FileSpreadsheet, tone: 'neutral' },
  cards: { label: 'طبع كروت', icon: Printer, tone: 'neutral' },
  qr: { label: 'مسح QR', icon: ScanLine, tone: 'neutral' },
  view: { label: 'عرض', icon: Eye, tone: 'neutral' },
  prune: { label: 'نظّف السجل', icon: Trash2, tone: 'neutral' },
  restore_begin: { label: 'بدأ استرجاع نسخة', icon: Database, tone: 'neutral' },
  download: { label: 'حمّل', icon: Database, tone: 'neutral' },
};

const FALLBACK_VERB: VerbDef = { label: '', icon: Cog, tone: 'neutral' };

export const verbOf = (action: string): VerbDef => {
  const v = action.split('.')[1] ?? '';
  return VERBS[v] ?? { ...FALLBACK_VERB, label: v.replace(/_/g, ' ') };
};

export const TONE_CLASSES: Record<VerbDef['tone'], string> = {
  add: 'bg-emerald-100 text-emerald-700',
  edit: 'bg-sky-100 text-sky-700',
  remove: 'bg-rose-100 text-rose-700',
  neutral: 'bg-slate-100 text-slate-600',
  good: 'bg-emerald-100 text-emerald-700',
  bad: 'bg-rose-100 text-rose-700',
};

// ---------- object nouns (what the verb acts on) ----------
const NOUNS: Record<string, string> = {
  attendance: 'حضور', points: 'نقاط', call: 'مكالمة', message: 'رسالة', person: 'بيانات', enrollment: 'تسجيل',
  password: 'كلمة مرور', data_request: 'طلب تعديل بيانات', join_request: 'طلب انضمام', print_request: 'طلب طباعة كارت',
  card_template: 'قالب كارت', servant: 'خادم', servant_mirror: 'صف خادم', servant_scope: 'مكان خدمة', permission: 'صلاحية',
  permission_profile: 'ملف صلاحيات', module_access: 'صلاحية وحدة', church: 'كنيسة', service: 'خدمة', class: 'فصل',
  event: 'مناسبة', cause: 'سبب نقاط', feedback: 'نتيجة افتقاد', shepherd: 'مخدوم في مجموعته', store_item: 'صنف',
  store_order: 'فاتورة', store_shop: 'متجر', store_shop_target: 'مكان متجر', store_request: 'طلب شراء', exam: 'امتحان', exam_question: 'سؤال', exam_attempt: 'محاولة امتحان', birthday: 'تهنئة عيد ميلاد',
  birthday_setting: 'إعداد أعياد الميلاد', birthday_card: 'كارت تهنئة', chat: 'محادثة', online_class: 'فصل أونلاين',
  online_participant: 'حضور فصل أونلاين', achievement: 'إنجاز', achievement_award: 'منح إنجاز', occasion: 'فعالية',
  occasion_registration: 'مشاركة في فعالية', occasion_checklist: 'عنصر قائمة تحقق', occasion_mark: 'علامة تحقق',
  notification: 'إشعار', notification_automation: 'إشعار تلقائي', setting: 'إعداد', result_exam: 'امتحان نتائج',
  result_subject: 'مادة', result: 'درجة', grading: 'نظام تقدير', grading_grade: 'شريحة تقدير', library_subject: 'موضوع مكتبة',
  library_book: 'كتاب', library_lecture: 'محاضرة', library_favorite: 'مفضلة', backup: 'نسخة احتياطية',
  backup_schedule: 'جدول نسخ', backup_restore_jobs: 'استرجاع نسخة', families: 'عائلة', family_members: 'فرد عائلة',
  access_events: 'بوابة دخول', access_rules: 'قاعدة دخول', access_rule_groups: 'مجموعة قواعد', access_allowed: 'مسموح له بالدخول', access_log: 'عملية تحقق دخول',
};

// ---------- column labels (for the diff view) ----------
export const COLUMN_LABELS: Record<string, string> = {
  name: 'الاسم', full_name: 'الاسم', title: 'العنوان', description: 'الوصف', phone: 'الهاتف', address: 'العنوان',
  birthdate: 'تاريخ الميلاد', gender: 'النوع', notes: 'ملاحظات', image_url: 'الصورة', photo_url: 'الصورة',
  national_id: 'الكود', user_id: 'اسم الدخول', role: 'الدور', status: 'الحالة', church_id: 'الكنيسة',
  service_id: 'الخدمة', class_id: 'الفصل', event_id: 'المناسبة', cause_id: 'السبب', delta: 'النقاط',
  points: 'النقاط', points_delta: 'النقاط', attendance_count: 'عدد الحضور', kind: 'النوع', message: 'نص الرسالة',
  is_active: 'مفعّل', is_default: 'افتراضي', price: 'السعر', stock: 'المخزون', total_points: 'إجمالي النقاط',
  score: 'الدرجة', percent: 'النسبة', passed: 'ناجح', locked: 'مقفول', permissions: 'الصلاحيات', module_key: 'الوحدة',
  key: 'المفتاح', value: 'القيمة', starts_at: 'يبدأ', ends_at: 'ينتهي', event_date: 'التاريخ', recurrence: 'التكرار',
  remember: 'تذكرني', legacy: 'دخول قديم', rows: 'عدد الصفوف', count: 'العدد', file: 'الملف', mode: 'الوضع', reason: 'السبب',
  shop_id: 'المتجر', family_id: 'العائلة', priest_id: 'الكاهن', occasion_id: 'الفعالية', exam_id: 'الامتحان', achievement_id: 'الإنجاز',
  notification_id: 'الإشعار', template_id: 'القالب', item_id: 'الصنف', order_id: 'الفاتورة', request_id: 'الطلب', group_id: 'المجموعة',
  subject_id: 'المادة', book_id: 'الكتاب', lecture_id: 'المحاضرة', automation_id: 'الإشعار التلقائي', schedule_id: 'الجدول',
  grading_system_id: 'نظام التقدير', online_class_id: 'الفصل الأونلاين', area_id: 'المنطقة', street_id: 'الشارع', building_id: 'العمارة',
  weekdays: 'الأيام', start_time: 'من', end_time: 'إلى', points_mode: 'وضع النقاط', audience: 'الجمهور',
  sort_order: 'الترتيب', feedback_id: 'نتيجة الافتقاد', contacted_on: 'تاريخ المتابعة', attended_on: 'يوم الحضور',
  recorded_by: 'سجّله', created_by: 'أنشأه', approved_by: 'اعتمده', decision_note: 'ملاحظة القرار', note: 'ملاحظة',
  ticket_code: 'كود التذكرة', capacity: 'السعة', location: 'المكان', platform: 'المنصة', stream_url: 'رابط البث',
  pdf_url: 'رابط PDF', media_url: 'رابط الوسائط', author: 'المؤلف', speaker: 'المتحدث', code: 'الكود',
  full_degree: 'الدرجة الكاملة', pass_degree: 'درجة النجاح', weight: 'الوزن', academic_year: 'العام الدراسي',
  exam_date: 'تاريخ الامتحان', person_id: 'الشخص', enrollment_id: 'التسجيل', servant_id: 'الخادم',
  permission_profile_id: 'ملف الصلاحيات', keep_days: 'مدة الاحتفاظ', enabled: 'مفعّل',
};

export const columnLabel = (c: string) => COLUMN_LABELS[c] ?? c;

export const ROLE_LABELS: Record<string, string> = {
  owner: 'مالك التطبيق', church_manager: 'مدير كنيسة', service_manager: 'مسؤول خدمة', class_servant: 'خادم فصل',
  child: 'مخدوم', system: 'النظام', service_role: 'النظام (خادم الويب)', unknown: 'حساب غير معروف',
};

export const ACTOR_KIND_LABELS: Record<ActorKind, string> = { servant: 'خادم', child: 'مخدوم', priest: 'كاهن', system: 'النظام' };

export const OP_LABELS: Record<ActivityOp, string> = { INSERT: 'إضافة', UPDATE: 'تعديل', DELETE: 'حذف', EVENT: 'حدث' };

// ---------- describe a row ----------
export interface Described {
  actor: string;
  verb: string;
  noun: string;
  target: string | null;
  /** «خادم أ · سجّل حضور · John» */
  sentence: string;
  /** short chips: changed columns (UPDATE) or key facts (points delta …) */
  details: string[];
  group: ActivityGroup;
  tone: VerbDef['tone'];
  icon: LucideIcon;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Human value for the chips — never a UUID or a JSON blob (20261010120000: no codes in the module). */
const str = (v: unknown): string => {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'نعم' : 'لا';
  if (typeof v === 'object') return Array.isArray(v) ? `${v.length} عنصر` : '…';
  const s = String(v);
  if (UUID_RE.test(s)) return '…';
  if (/^https?:\/\//.test(s)) return 'رابط';
  return s.length > 60 ? s.slice(0, 60) + '…' : s;
};
/** Columns whose change is noise or an identifier — skipped in the chips (the UI diff table applies the same rule). */
const CHIP_SKIP = new Set(['edited_at', 'updated_at', 'edited_by', 'updated_by', 'created_at', 'created_by', 'id', 'batch_id']);
const isRefColumn = (c: string) => CHIP_SKIP.has(c) || c.endsWith('_hash') || (c.endsWith('_id') && c !== 'national_id' && c !== 'user_id');

export function describe(row: ActivityRow): Described {
  const group = groupOf(row.action);
  const verb = verbOf(row.action);
  const base = row.action.split('.')[0];
  const noun = NOUNS[base] ?? group.label;
  const actor = row.actor_name ?? (row.actor_kind === 'system' ? 'النظام' : row.actor_kind === 'child' ? 'مخدوم' : row.actor_kind === 'priest' ? 'كاهن' : 'خادم');
  const target = row.target_name ?? null;

  const details: string[] = [];
  const nd = row.new_data ?? {};
  const od = row.old_data ?? {};
  if (row.op === 'UPDATE' && row.changed?.length) {
    const shown = row.changed.filter((c) => !isRefColumn(c));
    shown.slice(0, 6).forEach((c) => details.push(`${columnLabel(c)}: ${str(od[c])} → ${str(nd[c])}`));
    // only references changed (moved to another class …) → name the fields without the ids
    if (!shown.length) {
      const refs = row.changed.filter((c) => c.endsWith('_id') && !CHIP_SKIP.has(c));
      if (refs.length) details.push(refs.map(columnLabel).join(' · '));
    }
  } else if (row.op === 'INSERT') {
    if (base === 'points' && nd.delta !== undefined) details.push(`${Number(nd.delta) > 0 ? '+' : ''}${nd.delta} نقطة`);
    if (base === 'attendance' && nd.points_delta !== undefined) details.push(`+${nd.points_delta} نقطة`);
    if (base === 'message' && typeof nd.message === 'string') details.push(nd.message.slice(0, 80));
    if ((base === 'store_order' || base === 'store_request') && nd.total_points !== undefined) details.push(`${nd.total_points} نقطة · ${nd.items_count ?? ''} صنف`);
    if (base === 'servant' && nd.role) details.push(ROLE_LABELS[String(nd.role)] ?? String(nd.role));
  } else if (row.op === 'EVENT' && row.meta) {
    Object.entries(row.meta)
      .filter(([k]) => k !== 'user_agent' && k !== 'ua' && !isRefColumn(k))
      .slice(0, 4)
      .forEach(([k, v]) => details.push(`${columnLabel(k)}: ${str(v)}`));
  }
  if (row.batch_size > 1) details.unshift(`ضمن عملية جماعية (${row.batch_size})`);

  const verbLabel = verb.label || OP_LABELS[row.op];
  const sentence = row.op === 'EVENT'
    ? `${actor} · ${verbLabel}${target ? ` · ${target}` : ''}`
    : `${actor} · ${verbLabel} ${noun}${target ? ` · ${target}` : ''}`;

  return { actor, verb: verbLabel, noun, target, sentence, details, group, tone: verb.tone, icon: verb.icon };
}

/** Label of an action key alone («تسجيل حضور») — for the by-operation tab. */
export function actionLabel(action: string): string {
  const g = groupOf(action); const v = verbOf(action);
  const base = action.split('.')[0];
  const noun = NOUNS[base] ?? g.label;
  if (base === 'auth' || base === 'portal' || base === 'export' || base === 'print' || base === 'scan' || base === 'activity') return v.label || action;
  return `${v.label || action.split('.')[1]} ${noun}`.trim();
}

// ---------- data access ----------
export async function fetchFeed(
  supabase: SupabaseClient, filters: ActivityFilters, limit: number,
  cursor?: { created_at: string; id: string } | null
): Promise<ActivityRow[]> {
  const { data, error } = await supabase.rpc('activity_feed', {
    p_filters: filters, p_limit: limit,
    p_before: cursor?.created_at ?? null, p_before_id: cursor?.id ?? null,
  });
  if (error) throw error;
  return (data ?? []) as ActivityRow[];
}

export async function fetchSummary(supabase: SupabaseClient, filters: ActivityFilters): Promise<ActivitySummary> {
  const { data, error } = await supabase.rpc('activity_summary', { p_filters: filters });
  if (error) throw error;
  return data as ActivitySummary;
}

export async function fetchActors(supabase: SupabaseClient, filters: ActivityFilters): Promise<ActivityActor[]> {
  const { data, error } = await supabase.rpc('activity_actors', { p_filters: filters });
  if (error) throw error;
  return (data ?? []) as ActivityActor[];
}

export async function fetchPermissions(supabase: SupabaseClient): Promise<ActivityPermissions> {
  const { data, error } = await supabase.rpc('activity_permissions');
  if (error) return { view: false, view_all: false, manage: false };
  return data as ActivityPermissions;
}

export async function fetchSettings(supabase: SupabaseClient): Promise<ActivitySettings> {
  const { data, error } = await supabase.rpc('activity_settings');
  if (error) throw error;
  const d = (data ?? {}) as Partial<ActivitySettings>;
  return { keep_days: d.keep_days ?? 365, enabled: d.enabled ?? true, rows: Number(d.rows ?? 0), oldest: d.oldest ?? null };
}

export async function saveSettings(supabase: SupabaseClient, v: { keep_days: number; enabled: boolean }) {
  const { error } = await supabase.rpc('activity_settings_set', { p_value: v });
  if (error) throw error;
}

export async function prune(supabase: SupabaseClient, keepDays?: number): Promise<number> {
  const { data, error } = await supabase.rpc('activity_prune', { p_keep_days: keepDays ?? null });
  if (error) throw error;
  return Number(data ?? 0);
}

/**
 * Log an app-level EVENT (login · logout · export · print · scan …).
 * Never throws — the log must never break the operation it describes.
 */
export async function logActivity(
  supabase: SupabaseClient, action: string,
  opts: { person?: string | null; enrollment?: string | null; meta?: Record<string, unknown>; church?: string | null; service?: string | null; class?: string | null } = {}
): Promise<void> {
  try {
    await supabase.rpc('log_activity', {
      p_action: action, p_target_person: opts.person ?? null, p_enrollment: opts.enrollment ?? null,
      p_meta: opts.meta ?? {}, p_church: opts.church ?? null, p_service: opts.service ?? null, p_class: opts.class ?? null,
    });
  } catch { /* silent */ }
}

/** Child-portal variant — token instead of session. Never throws. */
export async function logChildActivity(supabase: SupabaseClient, token: string, action: string, meta: Record<string, unknown> = {}) {
  try { await supabase.rpc('child_portal_log_activity', { p_token: token, p_action: action, p_meta: meta }); } catch { /* silent */ }
}

// ---------- export ----------
/** «الاسم: جون · الهاتف: 0100…» — the readable form of a row snapshot (no ids, no JSON). */
function humanData(d: Record<string, unknown> | null): string {
  if (!d) return '';
  return Object.entries(d)
    .filter(([k]) => !isRefColumn(k))
    .map(([k, v]) => `${columnLabel(k)}: ${str(v)}`)
    .join(' · ');
}

export async function exportRowsToExcel(rows: ActivityRow[], fileName = 'activity_log') {
  const XLSX = await import('xlsx');
  const data = rows.map((r) => {
    const d = describe(r);
    return {
      'الوقت': new Date(r.created_at).toLocaleString('ar-EG', { timeZone: 'Africa/Cairo' }),
      'الفاعل': d.actor,
      'نوع الفاعل': ACTOR_KIND_LABELS[r.actor_kind],
      'الدور': ROLE_LABELS[r.actor_role ?? ''] ?? r.actor_role ?? '',
      'العملية': actionLabel(r.action),
      'القسم': d.group.label,
      'النوع': OP_LABELS[r.op],
      'الهدف': r.target_name ?? '',
      'التفاصيل': d.details.join(' | '),
      'قبل': humanData(r.old_data),
      'بعد': humanData(r.new_data),
      'عملية جماعية': r.batch_size > 1 ? r.batch_size : '',
    };
  });
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'سجل النشاط');
  XLSX.writeFile(wb, `${fileName}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// ---------- misc ----------
export const MIGRATION_HINT = 'لم يتم تشغيل migration 0047 (سجل النشاط) على قاعدة البيانات بعد.';

export function activityErrorMessage(e: unknown, fallback: string): string {
  const msg = (e as { message?: string; code?: string })?.message ?? '';
  const code = (e as { code?: string })?.code ?? '';
  if (code === '42883' || code === '42P01' || /activity_(feed|summary|log)/.test(msg) && /does not exist/.test(msg)) return MIGRATION_HINT;
  if (code === '57014' || /statement timeout|canceling statement/i.test(msg))
    return 'استغرق التحميل وقتًا طويلًا — شغّل migration 20261007120000 (تسريع سجل النشاط) أو ضيّق الفترة والفلاتر';
  if (code === '42501' || code === 'PGRST301' || /permission denied|JWT/i.test(msg)) return 'غير مسموح لك بعرض سجل النشاط';
  if (msg === 'not_allowed') return 'غير مسموح لك بهذه العملية';
  return fallback;
}

export function relTime(iso: string, now = Date.now()): string {
  const diff = Math.max(0, now - new Date(iso).getTime());
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'الآن';
  const m = Math.floor(s / 60);
  if (m < 60) return `قبل ${m} د`;
  const h = Math.floor(m / 60);
  if (h < 24) return `قبل ${h} س`;
  const d = Math.floor(h / 24);
  if (d < 30) return `قبل ${d} ي`;
  return new Date(iso).toLocaleDateString('ar-EG', { timeZone: 'Africa/Cairo' });
}

export function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ar-EG', { timeZone: 'Africa/Cairo', dateStyle: 'medium', timeStyle: 'short' });
}
