// ---------- PERMISSIONS REGISTRY (الصلاحيات) — migration 0037 ----------
// A permission is an app-code KEY. The owner groups keys into *permission
// profiles* (`permission_profiles`, ملفات الصلاحيات) from the owner module,
// and a servant enrollment is connected to one or more profiles through the
// `permissions` table. `usePermissions()` resolves the keys of the signed-in
// servant (owner ⇒ everything) and `has(key)` answers instantly.
//
// To add a permission later: add one entry here. Nothing else to change —
// the owner module lists the registry, and pages/guards call `has(key)`.

import type { LucideIcon } from 'lucide-react';
import {
  Users, UserPlus, Pencil, Trash2, ScanLine, Star, Phone, MessageSquare, IdCard,
  Church, Layers, School, CalendarDays, Coins, PhoneCall, UserCheck, ShieldCheck,
  QrCode, BarChart3, FileSpreadsheet, ClipboardList, KeyRound, ClipboardCheck, ListOrdered, Percent, Lock, FileUp, FileDown, PieChart,
  Library, BookOpen, History, Eye, Cog, FileBarChart2, LayoutTemplate, Printer, UsersRound, DoorOpen,
  Plus, ArrowUpDown, Check, XCircle,
} from 'lucide-react';

export interface PermissionGroup {
  key: string;
  label: string;
  icon: LucideIcon;
  color: string;
}

export interface PermissionDef {
  key: string;
  group: string;      // PermissionGroup.key
  label: string;
  desc: string;
}

export const PERMISSION_GROUPS: PermissionGroup[] = [
  { key: 'children', label: 'المخدومين', icon: Users, color: 'text-primary-600' },
  { key: 'scanner', label: 'الماسح', icon: ScanLine, color: 'text-orange-600' },
  { key: 'stats', label: 'الإحصائيات', icon: BarChart3, color: 'text-violet-600' },
  { key: 'structure', label: 'البنية (كنائس · خدمات · فصول)', icon: Church, color: 'text-emerald-600' },
  { key: 'events', label: 'المناسبات', icon: CalendarDays, color: 'text-violet-600' },
  { key: 'causes', label: 'أسباب النقاط', icon: Coins, color: 'text-amber-600' },
  { key: 'feedbacks', label: 'نتائج الافتقاد', icon: PhoneCall, color: 'text-teal-600' },
  { key: 'data_requests', label: 'طلبات تعديل البيانات', icon: ClipboardList, color: 'text-cyan-600' },
  { key: 'servants', label: 'الخدام', icon: ShieldCheck, color: 'text-rose-600' },
  { key: 'results', label: 'نتائج الامتحانات', icon: ClipboardCheck, color: 'text-emerald-600' },
  { key: 'library', label: 'المكتبة', icon: Library, color: 'text-lime-700' },
  { key: 'activity_log', label: 'سجل النشاط', icon: History, color: 'text-slate-700' },
  { key: 'reports', label: 'تقارير وجداول', icon: FileBarChart2, color: 'text-fuchsia-600' },
  { key: 'family', label: 'العائلات', icon: UsersRound, color: 'text-teal-700' },
  { key: 'access', label: 'التحكم في الدخول', icon: DoorOpen, color: 'text-emerald-700' },
];

export const PERMISSIONS: PermissionDef[] = [
  // ---- المخدومين ----
  { key: 'children.view', group: 'children', label: 'عرض المخدومين', desc: 'رؤية قائمة المخدومين وبياناتهم في نطاقه' },
  { key: 'children.add', group: 'children', label: 'إضافة مخدوم', desc: 'إضافة فردية وجماعية' },
  { key: 'children.edit', group: 'children', label: 'تعديل بيانات المخدوم', desc: 'الاسم · النوع · الهاتف · تاريخ الميلاد · العنوان · الصورة · الكود' },
  { key: 'children.delete', group: 'children', label: 'حذف مخدوم', desc: 'إزالة التسجيل أو الشخص' },
  { key: 'children.attendance', group: 'children', label: 'تسجيل الحضور', desc: 'تسجيل / إزالة حضور مناسبة' },
  { key: 'children.points', group: 'children', label: 'النقاط', desc: 'إضافة وخصم النقاط' },
  { key: 'children.call', group: 'children', label: 'الاتصال ونتيجة الافتقاد', desc: 'مكالمات المتابعة وتسجيل نتيجتها' },
  { key: 'children.message', group: 'children', label: 'الرسائل', desc: 'واتساب · SMS · رسالة داخلية' },
  { key: 'children.print_card', group: 'children', label: 'طلب طباعة كارت', desc: 'إرسال الكارت إلى قائمة الطباعة' },
  { key: 'children.export', group: 'children', label: 'تصدير Excel', desc: 'تصدير بيانات المخدومين' },

  // ---- الماسح ----
  { key: 'scanner.use', group: 'scanner', label: 'استخدام الماسح', desc: 'مسح QR وتشغيل المهام (حضور · نقاط · بيانات)' },

  // ---- الإحصائيات ----
  { key: 'stats.view', group: 'stats', label: 'عرض الإحصائيات', desc: 'لوحة الإحصائيات وتصدير Excel' },

  // ---- البنية ----
  { key: 'structure.churches', group: 'structure', label: 'إدارة الكنائس', desc: 'إضافة وتعديل وحذف الكنائس' },
  { key: 'structure.services', group: 'structure', label: 'إدارة الخدمات', desc: 'إضافة وتعديل وحذف الخدمات' },
  { key: 'structure.classes', group: 'structure', label: 'إدارة الفصول', desc: 'إضافة وتعديل وحذف الفصول' },

  // ---- عناصر النشاط (20260925130000) — managers hold them all; a class
  // servant VIEWS by default (he needs the event on the scanner) and needs
  // a profile for every write. The old coarse keys `activity.events` /
  // `activity.causes` / `activity.feedbacks` / `activity.data_requests`
  // are still honoured (⇒ every fine key of that item) — see LEGACY_ACTIVITY_KEYS.
  { key: 'activity.events.view', group: 'events', label: 'عرض المناسبات', desc: 'رؤية مناسبات نطاقه (افتراضي لكل خادم)' },
  { key: 'activity.events.add', group: 'events', label: 'إضافة مناسبة', desc: 'إنشاء مناسبة جديدة في نطاقه' },
  { key: 'activity.events.edit', group: 'events', label: 'تعديل مناسبة', desc: 'الاسم · النطاق · الجدول · النقاط' },
  { key: 'activity.events.delete', group: 'events', label: 'حذف مناسبة', desc: 'إزالة المناسبة — سجلات الحضور تبقى' },
  { key: 'activity.events.set_default', group: 'events', label: 'تحديد المناسبة الافتراضية', desc: 'تشغيل / إيقاف «افتراضية» لنطاقها' },

  { key: 'activity.causes.view', group: 'causes', label: 'عرض أسباب النقاط', desc: 'رؤية أسباب نطاقه (افتراضي لكل خادم)' },
  { key: 'activity.causes.add', group: 'causes', label: 'إضافة سبب', desc: 'إنشاء سبب إضافة / خصم جديد' },
  { key: 'activity.causes.edit', group: 'causes', label: 'تعديل سبب', desc: 'الاسم · النطاق · النقاط · طريقة النقاط' },
  { key: 'activity.causes.delete', group: 'causes', label: 'حذف سبب', desc: 'إزالة السبب — سجل النقاط يبقى' },
  { key: 'activity.causes.set_default', group: 'causes', label: 'تحديد السبب الافتراضي', desc: 'تشغيل / إيقاف «افتراضي» لنطاقه' },

  { key: 'activity.feedbacks.view', group: 'feedbacks', label: 'عرض نتائج الافتقاد', desc: 'رؤية نتائج نطاقه (افتراضي لكل خادم)' },
  { key: 'activity.feedbacks.add', group: 'feedbacks', label: 'إضافة نتيجة', desc: 'نتيجة افتقاد جديدة باسم ولون وأيقونة' },
  { key: 'activity.feedbacks.edit', group: 'feedbacks', label: 'تعديل نتيجة', desc: 'الاسم · اللون · الأيقونة · النطاق · المناسبة' },
  { key: 'activity.feedbacks.delete', group: 'feedbacks', label: 'حذف نتيجة', desc: 'إزالة النتيجة — المكالمات المسجلة تبقى' },
  { key: 'activity.feedbacks.reorder', group: 'feedbacks', label: 'ترتيب النتائج', desc: 'تحريك النتائج لأعلى / لأسفل' },

  { key: 'activity.data_requests.view', group: 'data_requests', label: 'عرض الطلبات', desc: 'رؤية طلبات مخدومي نطاقه (افتراضي لكل خادم)' },
  { key: 'activity.data_requests.approve', group: 'data_requests', label: 'الموافقة على طلب', desc: 'تطبيق التعديل على بيانات المخدوم' },
  { key: 'activity.data_requests.reject', group: 'data_requests', label: 'رفض طلب', desc: 'رفض الطلب مع ملاحظة' },
  { key: 'activity.data_requests.delete', group: 'data_requests', label: 'حذف طلب', desc: 'إزالة طلب من السجل' },

  // ---- الخدام ----
  { key: 'servants.view', group: 'servants', label: 'عرض الخدام', desc: 'قائمة الخدام في نطاقه' },
  { key: 'servants.approve', group: 'servants', label: 'قبول طلبات الانضمام', desc: 'اعتماد أو رفض الخدام الجدد' },
  { key: 'servants.manage', group: 'servants', label: 'إدارة الخدام', desc: 'تعديل · إيقاف · حذف' },
  { key: 'servants.add', group: 'servants', label: 'إضافة خدام', desc: 'إضافة خدام معتمدين مباشرة — فردي أو جماعي (Excel)' },
  { key: 'servants.invite', group: 'servants', label: 'دعوة خادم', desc: 'رابط / QR دعوة بنطاق' },
  { key: 'servants.permissions', group: 'servants', label: 'منح الصلاحيات', desc: 'ربط الخدام بملفات الصلاحيات في نطاقه' },

  // ---- نتائج الامتحانات (0038) — managers hold them all; class servants
  // view & see statistics by default and need a profile for the rest ----
  { key: 'results.view', group: 'results', label: 'عرض النتائج', desc: 'رؤية الامتحانات والنتائج في نطاقه (افتراضي لكل خادم)' },
  { key: 'results.enter', group: 'results', label: 'إدخال النتائج', desc: 'إدخال درجات جديدة (فردي · جماعي) وتعديل مسوداته' },
  { key: 'results.edit', group: 'results', label: 'تعديل النتائج', desc: 'تعديل وحذف نتائج مُدخلة' },
  { key: 'results.import', group: 'results', label: 'استيراد من Excel', desc: 'استيراد النتائج من ملف Excel بعد المعاينة' },
  { key: 'results.export', group: 'results', label: 'تصدير النتائج', desc: 'تصدير النتائج والتقارير إلى Excel' },
  { key: 'results.manage_exams', group: 'results', label: 'إدارة الامتحانات', desc: 'إنشاء وتعديل وحذف الامتحانات ونشرها' },
  { key: 'results.manage_subjects', group: 'results', label: 'إدارة المواد', desc: 'مواد الامتحان ودرجاتها وترتيبها' },
  { key: 'results.manage_grading', group: 'results', label: 'إدارة أنظمة التقدير', desc: 'التقديرات ونسبها وألوانها' },
  { key: 'results.lock', group: 'results', label: 'قفل النتائج', desc: 'قفل / فتح نتائج الامتحان — والكتابة بعد القفل' },
  { key: 'results.stats', group: 'results', label: 'عرض الإحصائيات', desc: 'لوحة الامتحان والتقارير (افتراضي لكل خادم)' },

  // ---- المكتبة (0039) — managers hold them all; class servants browse by
  // default and need a profile to manage content ----
  { key: 'library.view', group: 'library', label: 'تصفح المكتبة', desc: 'رؤية المواضيع والكتب والمحاضرات المتاحة له (افتراضي لكل خادم)' },
  { key: 'library.manage', group: 'library', label: 'إدارة المكتبة', desc: 'إضافة وتعديل وحذف المواضيع والكتب والمحاضرات في نطاقه' },

  // ---- سجل النشاط (0047) — owner + church managers see everything in
  // their church by default; service managers see their service; class
  // servants need `activity.view` ----
  { key: 'activity.view', group: 'activity_log', label: 'عرض سجل النشاط', desc: 'رؤية العمليات في نطاقه (خادم الفصل يحتاجها؛ المديرون يملكونها)' },
  { key: 'activity.view_all', group: 'activity_log', label: 'عرض سجل الكنيسة كاملاً', desc: 'مسؤول الخدمة / خادم الفصل يرى كل عمليات كنيسته لا نطاقه فقط' },

  // ---- تقارير وجداول (0050) — every servant who sees the module can build
  // and export reports of HIS scope (RLS bounds the data); saving templates
  // for a whole service / church follows `can_access` ----
  { key: 'reports.build', group: 'reports', label: 'إنشاء وتصدير التقارير', desc: 'اختيار البيانات والحقول وتصميم التقرير وتصديره PDF / Excel / طباعة (افتراضي لكل خادم يرى الوحدة)' },
  { key: 'reports.templates', group: 'reports', label: 'إدارة القوالب', desc: 'حفظ وتعديل وحذف قوالب التقارير في نطاقه' },

  // ---- العائلات — managers hold them all; class servants view by default
  // and need a profile to build / edit families ----
  { key: 'family.view', group: 'family', label: 'عرض العائلات', desc: 'رؤية العائلات التي لها فرد في نطاقه، وظهور العائلة عند المسح (افتراضي لكل خادم يرى الوحدة)' },
  { key: 'family.manage', group: 'family', label: 'إدارة العائلات', desc: 'إنشاء عائلة وإضافة أفرادها بمسح الكود (QR) وتعديلها وحذفها' },

  // ---- التحكم في الدخول — managers hold them all; class servants stand at
  // the door by default and need a profile to configure events / rules ----
  { key: 'access.check', group: 'access', label: 'التحقق عند البوابة', desc: 'مسح الكود أو البحث عن الشخص ورؤية مسموح / مرفوض وحالة كل قاعدة (افتراضي لكل خادم يرى الوحدة)' },
  { key: 'access.manage', group: 'access', label: 'إدارة بوابات الدخول', desc: 'إنشاء وتعديل وحذف بوابات الدخول وقواعدها ومجموعاتها وقائمة المسموح لهم في نطاقه' },
];

export const PERMISSION_BY_KEY: Record<string, PermissionDef> = Object.fromEntries(
  PERMISSIONS.map((p) => [p.key, p])
);

// ---------- Activity items: legacy coarse keys → fine keys ----------
/** Kept for profiles saved before 20260925130000: each coarse key implies every fine key of its item. */
export const LEGACY_ACTIVITY_KEYS: Record<string, string> = {
  'activity.events': 'المناسبات (كل الصلاحيات — مفتاح قديم)',
  'activity.causes': 'أسباب النقاط (كل الصلاحيات — مفتاح قديم)',
  'activity.feedbacks': 'نتائج الافتقاد (كل الصلاحيات — مفتاح قديم)',
  'activity.data_requests': 'طلبات تعديل البيانات (كل الصلاحيات — مفتاح قديم)',
};

export type ActivityItem = 'events' | 'causes' | 'feedbacks' | 'data_requests';
export type ActivityAction = 'view' | 'add' | 'edit' | 'delete' | 'set_default' | 'reorder' | 'approve' | 'reject';

/** The legacy coarse key of a fine activity key (`activity.events.add` → `activity.events`). */
export const activityLegacyKey = (key: string) => key.replace(/^(activity\.(?:events|causes|feedbacks|data_requests))\..*$/, '$1');

/**
 * Mirror of SQL `activity_item_can(key)`: owner / church manager / service
 * manager hold everything; a class servant views by default and needs the
 * fine key or the legacy coarse key for any write.
 */
export function activityItemCan(role: string | null | undefined, keys: Set<string>, item: ActivityItem, action: ActivityAction): boolean {
  if (!role) return false;
  if (role === 'owner' || role === 'church_manager' || role === 'service_manager') return true;
  if (role !== 'class_servant') return false;
  if (action === 'view') return true;
  const key = `activity.${item}.${action}`;
  return hasKey(keys, key) || hasKey(keys, activityLegacyKey(key));
}

/** Label of any key held by a profile — registry first, then the legacy coarse keys. */
export const permissionLabel = (key: string) => PERMISSION_BY_KEY[key]?.label ?? LEGACY_ACTIVITY_KEYS[key] ?? key;

export const permissionsOfGroup = (group: string) => PERMISSIONS.filter((p) => p.group === group);

// A few icons the owner module can use per permission key (fallback per group)
export const PERMISSION_ICONS: Record<string, LucideIcon> = {
  'children.view': Users,
  'children.add': UserPlus,
  'children.edit': Pencil,
  'children.delete': Trash2,
  'children.attendance': UserCheck,
  'children.points': Star,
  'children.call': Phone,
  'children.message': MessageSquare,
  'children.print_card': IdCard,
  'children.export': FileSpreadsheet,
  'scanner.use': QrCode,
  'stats.view': BarChart3,
  'structure.churches': Church,
  'structure.services': Layers,
  'structure.classes': School,
  'activity.events.view': Eye,
  'activity.events.add': Plus,
  'activity.events.edit': Pencil,
  'activity.events.delete': Trash2,
  'activity.events.set_default': Star,
  'activity.causes.view': Eye,
  'activity.causes.add': Plus,
  'activity.causes.edit': Pencil,
  'activity.causes.delete': Trash2,
  'activity.causes.set_default': Star,
  'activity.feedbacks.view': Eye,
  'activity.feedbacks.add': Plus,
  'activity.feedbacks.edit': Pencil,
  'activity.feedbacks.delete': Trash2,
  'activity.feedbacks.reorder': ArrowUpDown,
  'activity.data_requests.view': Eye,
  'activity.data_requests.approve': Check,
  'activity.data_requests.reject': XCircle,
  'activity.data_requests.delete': Trash2,
  'servants.view': Users,
  'servants.approve': UserCheck,
  'servants.manage': ShieldCheck,
  'servants.add': UserPlus,
  'servants.invite': QrCode,
  'servants.permissions': KeyRound,
  'results.view': ClipboardCheck,
  'results.enter': Pencil,
  'results.edit': Pencil,
  'results.import': FileUp,
  'results.export': FileDown,
  'results.manage_exams': ClipboardList,
  'results.manage_subjects': ListOrdered,
  'results.manage_grading': Percent,
  'results.lock': Lock,
  'results.stats': PieChart,
  'library.view': BookOpen,
  'library.manage': Library,
  'activity.view': Eye,
  'activity.view_all': Cog,
  'reports.build': Printer,
  'reports.templates': LayoutTemplate,
  'family.view': Eye,
  'family.manage': UsersRound,
  'access.check': QrCode,
  'access.manage': DoorOpen,
};

/** Resolve the key set from the grant rows + the profiles (owner ⇒ '*'). */
export function resolvePermissionKeys(
  role: string | null | undefined,
  grants: { permission_profile_id: string }[],
  profiles: { id: string; permissions: string[] }[]
): Set<string> {
  const out = new Set<string>();
  if (role === 'owner') { out.add('*'); return out; }
  const byId = new Map(profiles.map((p) => [p.id, p]));
  for (const g of grants) {
    const p = byId.get(g.permission_profile_id);
    p?.permissions.forEach((k) => out.add(k));
  }
  return out;
}

export const hasKey = (keys: Set<string>, key: string) => keys.has('*') || keys.has(key);
