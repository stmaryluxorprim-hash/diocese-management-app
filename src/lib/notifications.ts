'use client';

// ---------- Notifications module (وحدة الإشعارات) — client data layer ----------
// Everything goes through the SECURITY DEFINER RPCs of migration 0034.
//   servant side : notif_send · notif_cancel · notif_audience_count · notif_history ·
//                  notif_inbox · notif_unread_count · notif_mark_read · notif_permissions ·
//                  push_subscribe · push_unsubscribe
//   automations  : plain table access (RLS) on notification_automations
//   child portal : child_notifications · child_notif_unread · child_notif_mark_read ·
//                  child_push_subscribe · child_push_unsubscribe (anon, token = national id)
//
// Adding a new automatic trigger later = one row in TRIGGERS below + a DB
// trigger that calls notif_fire_enrollment() / notif_fire_scope().

import type { SupabaseClient } from '@supabase/supabase-js';

export const NOTIFICATIONS_MIGRATION_HINT =
  'وحدة الإشعارات تحتاج تشغيل تحديث قاعدة البيانات 0034_notifications.sql في Supabase';

// ---------- types ----------
export type NotifTargetKind = 'all' | 'church' | 'service' | 'class' | 'group' | 'person';
export type NotifAudience = 'children' | 'staff';
export type NotifStatus = 'scheduled' | 'sent' | 'failed' | 'cancelled';
export type NotifSource = 'manual' | 'automation';

export const TARGET_KIND_LABELS: Record<NotifTargetKind, string> = {
  all: 'كل الكنائس',
  church: 'كنيسة',
  service: 'خدمة',
  class: 'فصل',
  group: 'مجموعتي',
  person: 'مخدوم محدد',
};

export const NOTIF_STATUS_LABELS: Record<NotifStatus, string> = {
  scheduled: 'مجدول',
  sent: 'تم الإرسال',
  failed: 'فشل',
  cancelled: 'ملغي',
};

export const NOTIF_STATUS_CLASSES: Record<NotifStatus, string> = {
  scheduled: 'bg-amber-100 text-amber-800',
  sent: 'bg-emerald-100 text-emerald-800',
  failed: 'bg-red-100 text-red-700',
  cancelled: 'bg-slate-100 text-slate-500',
};

/** notifications row (as returned by notif_send / notif_cancel) */
export interface NotificationRow {
  id: string;
  church_id: string | null;
  service_id: string | null;
  class_id: string | null;
  title: string;
  body: string;
  image_url: string | null;
  link_url: string | null;
  target_kind: NotifTargetKind;
  audience: NotifAudience;
  target_servant_id: string | null;
  enrollment_ids: string[] | null;
  status: NotifStatus;
  scheduled_at: string | null;
  sent_at: string | null;
  recipients_count: number;
  error: string | null;
  source: NotifSource;
  automation_id: string | null;
  created_at: string;
  created_by: string | null;
}

/** one entry of notif_history() */
export interface NotifHistoryItem {
  id: string;
  title: string;
  body: string;
  image_url: string | null;
  link_url: string | null;
  target_kind: NotifTargetKind;
  audience: NotifAudience;
  church_id: string | null;
  service_id: string | null;
  class_id: string | null;
  target_label: string;
  status: NotifStatus;
  scheduled_at: string | null;
  sent_at: string | null;
  created_at: string;
  recipients_count: number;
  error: string | null;
  source: NotifSource;
  automation_id: string | null;
  automation_name: string | null;
  sender_name: string | null;
  is_mine: boolean;
  read_count: number;
  push_sent: number;
  can_cancel: boolean;
}

/** one entry of notif_inbox() / child_notifications() */
export interface InboxItem {
  id: string;
  notification_id: string;
  title: string;
  body: string;
  image_url: string | null;
  link_url: string | null;
  read_at: string | null;
  created_at: string;
  sender_name: string | null;
  source: NotifSource;
}

export interface NotifPermissions {
  visible: boolean;
  can_send_all: boolean;
  can_manage: boolean;
  role: string | null;
}

// ---------- automations ----------
export type TriggerKey =
  | 'attendance' | 'points_added' | 'points_deducted' | 'online_class_started'
  | 'exam_published' | 'achievement_earned' | 'occasion_reminder';
export type AutomationRecipient = 'student' | 'class_servants';

export interface NotificationAutomation {
  id: string;
  /** rows sharing a group_id are ONE automation covering several classes */
  group_id?: string | null;
  church_id: string | null;
  service_id: string | null;
  class_id: string | null;
  trigger_key: TriggerKey;
  recipient: AutomationRecipient;
  name: string;
  title_template: string;
  body_template: string;
  image_url: string | null;
  link_url: string | null;
  is_active: boolean;
  config: Record<string, unknown>;
  created_at: string;
  created_by: string | null;
  edited_at: string;
  edited_by: string | null;
}

export interface TriggerDef {
  key: TriggerKey;
  label: string;
  desc: string;
  /** variables the templates may use — beyond the standard child ones */
  vars: string[];
  /** page opened when the recipient taps the notification (null link → this) */
  defaultLink: string;
  /** which recipients make sense */
  recipients: AutomationRecipient[];
  /** optional numeric config field */
  config?: { key: string; label: string; default: number; min: number; max: number };
  sample: { title: string; body: string };
}

/** standard variables available to EVERY child-based trigger */
export const STANDARD_VARS = ['الاسم', 'الاسم الأول', 'الرصيد', 'عدد الحضور', 'الفصل', 'الخدمة', 'الكنيسة', 'التاريخ', 'الوقت'];

export const TRIGGERS: TriggerDef[] = [
  {
    key: 'attendance',
    label: 'عند تسجيل الحضور',
    desc: 'يُرسل مرة واحدة لكل مناسبة في اليوم عندما يُسجَّل حضور المخدوم',
    vars: ['المناسبة', 'النقاط'],
    defaultLink: '/child/attendance',
    recipients: ['student', 'class_servants'],
    sample: { title: '✅ تم تسجيل حضورك', body: '[الاسم الأول]، تم تسجيل حضورك في [المناسبة] وحصلت على [النقاط] نقطة' },
  },
  {
    key: 'points_added',
    label: 'عند إضافة نقاط',
    desc: 'يُرسل عند إضافة نقاط لرصيد المخدوم (يمكن تحديد حد أدنى)',
    vars: ['النقاط', 'السبب', 'المناسبة'],
    defaultLink: '/child/points',
    recipients: ['student', 'class_servants'],
    config: { key: 'min_points', label: 'الحد الأدنى للنقاط', default: 1, min: 1, max: 100000 },
    sample: { title: '🎉 نقاط جديدة', body: 'تمت إضافة [النقاط] نقطة إلى رصيدك — رصيدك الآن [الرصيد]' },
  },
  {
    key: 'points_deducted',
    label: 'عند خصم نقاط',
    desc: 'يُرسل عند خصم نقاط من رصيد المخدوم (يمكن تحديد حد أدنى)',
    vars: ['النقاط', 'السبب', 'المناسبة'],
    defaultLink: '/child/points',
    recipients: ['student', 'class_servants'],
    config: { key: 'min_points', label: 'الحد الأدنى للنقاط', default: 1, min: 1, max: 100000 },
    sample: { title: 'تم خصم نقاط', body: 'تم خصم [النقاط] نقطة من رصيدك — السبب: [السبب]' },
  },
  {
    key: 'achievement_earned',
    label: 'عند الحصول على إنجاز',
    desc: 'يُرسل عندما يحصل المخدوم على إنجاز (وحدة الإنجازات)',
    vars: ['الإنجاز', 'النقاط'],
    defaultLink: '/child/achievements',
    recipients: ['student', 'class_servants'],
    sample: { title: '🏆 إنجاز جديد!', body: 'مبروك [الاسم الأول]! حصلت على إنجاز «[الإنجاز]»' },
  },
  {
    key: 'online_class_started',
    label: 'عند بدء فصل أونلاين',
    desc: 'يُرسل لكل مخدومي نطاق الفصل عندما يبدأ الخادم البث المباشر',
    vars: ['العنوان', 'المنصة', 'الوقت'],
    defaultLink: '/child/online',
    recipients: ['student', 'class_servants'],
    sample: { title: '🔴 الفصل بدأ الآن', body: 'فصل «[العنوان]» مباشر الآن — ادخل من التطبيق' },
  },
  {
    key: 'exam_published',
    label: 'عند نشر امتحان جديد',
    desc: 'يُرسل لكل مخدومي نطاق الامتحان عند نشره (أو عند حلول موعد فتحه)',
    vars: ['العنوان', 'آخر موعد'],
    defaultLink: '/child/exams',
    recipients: ['student', 'class_servants'],
    sample: { title: '📝 امتحان جديد', body: 'امتحان «[العنوان]» متاح الآن — آخر موعد: [آخر موعد]' },
  },
  {
    key: 'occasion_reminder',
    label: 'تذكير قبل فعالية',
    desc: 'يُرسل للمشاركين المسجّلين في الفعالية قبل موعدها بعدد ساعات تحدده',
    vars: ['العنوان', 'المكان', 'التاريخ', 'الوقت'],
    defaultLink: '/child/occasions',
    recipients: ['student', 'class_servants'],
    config: { key: 'hours_before', label: 'قبل الموعد بـ (ساعات)', default: 24, min: 1, max: 720 },
    sample: { title: '⏰ تذكير: [العنوان]', body: 'فعالية «[العنوان]» غداً [الوقت] في [المكان]' },
  },
];

export const TRIGGER_BY_KEY: Record<TriggerKey, TriggerDef> = Object.fromEntries(TRIGGERS.map((t) => [t.key, t])) as Record<TriggerKey, TriggerDef>;

export const RECIPIENT_LABELS: Record<AutomationRecipient, string> = {
  student: 'المخدوم',
  class_servants: 'خدام الفصل',
};

/** in-app pages a manual notification may open (plus any custom path / https URL) */
export const LINK_PRESETS: { value: string; label: string }[] = [
  { value: '', label: 'بدون رابط' },
  { value: '/child', label: 'الرئيسية' },
  { value: '/child/attendance', label: 'الحضور' },
  { value: '/child/points', label: 'النقاط' },
  { value: '/child/messages', label: 'الرسائل' },
  { value: '/child/exams', label: 'الامتحانات' },
  { value: '/child/online', label: 'الفصول الأونلاين' },
  { value: '/child/achievements', label: 'الإنجازات' },
  { value: '/child/occasions', label: 'الفعاليات' },
  { value: '/child/notifications', label: 'الإشعارات' },
];

// ---------- RPC wrappers (servant) ----------
export interface SendParams {
  title: string;
  body?: string;
  image_url?: string | null;
  link_url?: string | null;
  audience?: NotifAudience;
  target_kind: NotifTargetKind;
  church_id?: string | null;
  service_id?: string | null;
  class_id?: string | null;
  target_servant_id?: string | null;
  enrollment_ids?: string[];
  scheduled_at?: string | null;   // ISO
}

export async function sendNotification(supabase: SupabaseClient, p: SendParams): Promise<NotificationRow> {
  const { data, error } = await supabase.rpc('notif_send', { p });
  if (error) throw error;
  return data as NotificationRow;
}

export async function cancelNotification(supabase: SupabaseClient, id: string): Promise<NotificationRow> {
  const { data, error } = await supabase.rpc('notif_cancel', { p_id: id });
  if (error) throw error;
  return data as NotificationRow;
}

export async function fetchAudienceCount(supabase: SupabaseClient, p: Omit<SendParams, 'title'>): Promise<number> {
  const { data, error } = await supabase.rpc('notif_audience_count', { p });
  if (error) throw error;
  return (data as number) ?? 0;
}

export async function fetchHistory(supabase: SupabaseClient, limit = 60, before?: string): Promise<NotifHistoryItem[]> {
  const { data, error } = await supabase.rpc('notif_history', { p_limit: limit, p_before: before ?? null });
  if (error) throw error;
  return (data as NotifHistoryItem[]) ?? [];
}

export async function deleteNotification(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from('notifications').delete().eq('id', id);
  if (error) throw error;
}

export async function fetchInbox(supabase: SupabaseClient, limit = 50): Promise<InboxItem[]> {
  const { data, error } = await supabase.rpc('notif_inbox', { p_limit: limit });
  if (error) throw error;
  return (data as InboxItem[]) ?? [];
}

export async function fetchUnreadCount(supabase: SupabaseClient): Promise<number> {
  const { data, error } = await supabase.rpc('notif_unread_count');
  if (error) throw error;
  return (data as number) ?? 0;
}

export async function markRead(supabase: SupabaseClient, ids?: string[]): Promise<number> {
  const { data, error } = await supabase.rpc('notif_mark_read', { p_ids: ids ?? null });
  if (error) throw error;
  return (data as number) ?? 0;
}

export async function fetchPermissions(supabase: SupabaseClient): Promise<NotifPermissions> {
  const { data, error } = await supabase.rpc('notif_permissions');
  if (error) throw error;
  return data as NotifPermissions;
}

// ---------- automations (RLS-protected table) ----------
export async function fetchAutomations(supabase: SupabaseClient): Promise<NotificationAutomation[]> {
  const { data, error } = await supabase.from('notification_automations').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return (data as NotificationAutomation[]) ?? [];
}

export type AutomationInput = Pick<NotificationAutomation,
  'church_id' | 'service_id' | 'class_id' | 'trigger_key' | 'recipient' | 'name' | 'title_template' | 'body_template' | 'image_url' | 'link_url' | 'is_active' | 'config'> & { group_id?: string | null };

export async function saveAutomation(supabase: SupabaseClient, input: AutomationInput, id?: string, userId?: string): Promise<NotificationAutomation> {
  if (id) {
    const { data, error } = await supabase.from('notification_automations').update({ ...input, edited_by: userId ?? null }).eq('id', id).select('*').single();
    if (error) throw error;
    return data as NotificationAutomation;
  }
  const { data, error } = await supabase.from('notification_automations').insert({ ...input, created_by: userId ?? null, edited_by: userId ?? null }).select('*').single();
  if (error) throw error;
  return data as NotificationAutomation;
}

export async function toggleAutomation(supabase: SupabaseClient, id: string, active: boolean, groupId?: string | null): Promise<void> {
  const q = supabase.from('notification_automations').update({ is_active: active });
  const { error } = groupId ? await q.eq('group_id', groupId) : await q.eq('id', id);
  if (error) throw error;
}

export async function deleteAutomation(supabase: SupabaseClient, id: string, groupId?: string | null): Promise<void> {
  const q = supabase.from('notification_automations').delete();
  const { error } = groupId ? await q.eq('group_id', groupId) : await q.eq('id', id);
  if (error) throw error;
}

// ---------- child portal (anon) ----------
export async function fetchChildNotifications(supabase: SupabaseClient, token: string, limit = 50): Promise<InboxItem[]> {
  const { data, error } = await supabase.rpc('child_notifications', { p_national_id: token, p_limit: limit });
  if (error) throw error;
  return (data as InboxItem[]) ?? [];
}

export async function fetchChildUnread(supabase: SupabaseClient, token: string): Promise<number> {
  const { data, error } = await supabase.rpc('child_notif_unread', { p_national_id: token });
  if (error) throw error;
  return (data as number) ?? 0;
}

export async function childMarkRead(supabase: SupabaseClient, token: string, ids?: string[]): Promise<number> {
  const { data, error } = await supabase.rpc('child_notif_mark_read', { p_national_id: token, p_ids: ids ?? null });
  if (error) throw error;
  return (data as number) ?? 0;
}

// ---------- helpers ----------
/** Render [variables] in a template with sample values (preview only). */
export function renderPreview(template: string, trigger?: TriggerDef): string {
  const sample: Record<string, string> = {
    'الاسم': 'مينا جرجس', 'الاسم الأول': 'مينا', 'الرصيد': '120', 'عدد الحضور': '14',
    'الفصل': 'فصل أ', 'الخدمة': 'مدارس الأحد', 'الكنيسة': 'كنيسة العذراء', 'التاريخ': '2026-09-12', 'الوقت': '09:30',
    'المناسبة': 'القداس', 'النقاط': '5', 'السبب': 'سلوك', 'الإنجاز': 'الحضور المنتظم', 'العنوان': 'درس الأحد',
    'المنصة': 'youtube', 'آخر موعد': '2026-09-20 22:00', 'المكان': 'قاعة الكنيسة',
  };
  let out = template;
  for (const [k, v] of Object.entries(sample)) out = out.split(`[${k}]`).join(v);
  void trigger;
  return out;
}

/** Arabic user message from a notif_* RPC error */
export function notifErrorMessage(e: unknown, fallback = 'حدث خطأ'): string {
  const msg = (e as { message?: string })?.message ?? '';
  if (/notif_|does not exist|schema cache|Could not find/.test(msg) && /function|relation|table/.test(msg)) return NOTIFICATIONS_MIGRATION_HINT;
  const map: Record<string, string> = {
    module_not_visible: 'وحدة الإشعارات غير مفعّلة لنطاقك',
    not_approved: 'حسابك غير مقبول بعد',
    empty_title: 'اكتب عنوان الإشعار',
    text_too_long: 'النص طويل جداً',
    schedule_in_past: 'موعد الإرسال في الماضي — اختر وقتاً لاحقاً',
    scope_not_allowed: 'هذا النطاق خارج صلاحيتك',
    no_recipients: 'اختر مستلماً واحداً على الأقل',
    too_many_recipients: 'عدد المستلمين كبير جداً (الحد 500)',
    enrollment_not_visible: 'أحد المخدومين خارج صلاحيتك',
    enrollment_not_found: 'المخدوم غير موجود',
    bad_target: 'طريقة الإرسال غير صحيحة',
    not_scheduled: 'هذا الإشعار ليس مجدولاً',
    not_allowed: 'غير مسموح',
    not_found: 'غير موجود',
    bad_subscription: 'بيانات الجهاز غير صحيحة',
  };
  for (const k of Object.keys(map)) if (msg.includes(k)) return map[k];
  if (/row-level security|permission denied|42501/i.test(msg)) return 'غير مسموح — خارج صلاحيتك';
  return msg || fallback;
}

/** local datetime-input value ('YYYY-MM-DDTHH:MM') → ISO string */
export function localInputToISO(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('ar-EG', {
    timeZone: 'Africa/Cairo', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date(iso));
}

export function fmtRelative(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'الآن';
  if (diff < 3600) return `قبل ${Math.floor(diff / 60)} د`;
  if (diff < 86400) return `قبل ${Math.floor(diff / 3600)} س`;
  if (diff < 7 * 86400) return `قبل ${Math.floor(diff / 86400)} يوم`;
  return fmtDateTime(iso);
}
