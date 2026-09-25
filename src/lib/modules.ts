// ---------- MODULES REGISTRY (الوحدات) ----------
// The app = a fixed CORE (the 5 main pages) + optional MODULES.
// Each module is declared ONCE here; the side menu, the settings hub and the
// owner module (صلاحيات الوحدات) all read from this list. Visibility per
// church / service / class is decided by the OWNER in `/owner/modules` and
// stored in `module_access` (migration 0024).
//
// To add a module later: add one entry here + guard its pages with
// `useModuleVisible(key)` (or `<ModuleGate module="key">`).

import { IdCard, Crown, HeartHandshake, ShoppingBag, GraduationCap, Cake, MessageCircle, Video, Trophy, Tent, Bell, ClipboardCheck, Library, History, FileBarChart2, UsersRound, DoorOpen, type LucideIcon } from 'lucide-react';
import type { Profile } from '@/lib/types';

export type ModuleKey = 'cards' | 'shepherds' | 'store' | 'exams' | 'birthdays' | 'messages' | 'online' | 'achievements' | 'occasions' | 'notifications' | 'results' | 'library' | 'activity' | 'reports' | 'family' | 'access';

export interface AppModule {
  key: ModuleKey;
  label: string;
  desc: string;
  href: string;          // entry page
  icon: LucideIcon;
  color: string;         // tailwind text color for the icon
  /** every path prefix that belongs to the module (used for active state + guards) */
  paths: string[];
}

export const MODULES: AppModule[] = [
  {
    key: 'cards',
    label: 'تصميم الكروت',
    desc: 'تصميم وطباعة كروت المخدومين',
    href: '/settings/cards',
    icon: IdCard,
    color: 'text-rose-600',
    paths: ['/settings/cards'],
  },
  {
    key: 'shepherds',
    label: 'الأشابين',
    desc: 'كل خادم يختار مجموعة مخدومين خاصة به — ويتابعهم من زر «مجموعتي» في المخدومين',
    href: '/shepherds',
    icon: HeartHandshake,
    color: 'text-teal-600',
    paths: ['/shepherds'],
  },
  {
    key: 'store',
    label: 'إستبدال النقاط',
    desc: 'نقطة بيع: المخدوم يستبدل نقاطه بأصناف من المخزون — مخزون · كاشير · أرشيف الفواتير',
    href: '/store',
    icon: ShoppingBag,
    color: 'text-orange-600',
    paths: ['/store'],
  },
  {
    key: 'exams',
    label: 'الامتحانات',
    desc: 'امتحانات اختيار من متعدد: أسئلة بمؤقت ودرجات، نجاح ونقاط — والمخدوم يحلّها من بوابته',
    href: '/exams',
    icon: GraduationCap,
    color: 'text-violet-600',
    paths: ['/exams'],
  },
  {
    key: 'birthdays',
    label: 'أعياد الميلاد',
    desc: 'من عيد ميلاده هذا الشهر يوماً بيوم — اتصال ورسائل للجميع، هدية نقاط، وكروت تهنئة للطباعة أو الإرسال',
    href: '/birthdays',
    icon: Cake,
    color: 'text-pink-600',
    paths: ['/birthdays'],
  },
  {
    key: 'messages',
    label: 'الرسائل',
    desc: 'محادثات داخل التطبيق: المخدوم يكتب لخدامه، والخادم يرسل لمخدوم أو فصل أو خدمة أو كنيسة وللخدام التابعين له',
    href: '/messages',
    icon: MessageCircle,
    color: 'text-sky-600',
    paths: ['/messages'],
  },
  {
    key: 'online',
    label: 'الفصول الأونلاين',
    desc: 'فصل ببث مباشر (YouTube · Facebook · Zoom · Meet): يدخل المخدوم من بوابته، فحوص انتباه وأسئلة ودردشة مباشرة، والحضور يُحسب تلقائياً بقواعد قابلة للتعديل',
    href: '/online',
    icon: Video,
    color: 'text-red-600',
    paths: ['/online'],
  },
  {
    key: 'achievements',
    label: 'الإنجازات',
    desc: 'إنجازات بنقاط: تُمنح للمخدوم يدوياً أو تلقائياً عند الوصول لعدد حضور أو حضور متتالٍ — وتظهر في بوابته مع شريط التقدم',
    href: '/achievements',
    icon: Trophy,
    color: 'text-amber-600',
    paths: ['/achievements'],
  },
  {
    key: 'occasions',
    label: 'الفعاليات',
    desc: 'رحلات · مؤتمرات · احتفالات · أنشطة: لوحة فعاليات، المخدوم يسجّل «أنا مشارك» من بوابته، الخادم يدير المشاركين وقائمة التحقق، تذكرة إلكترونية QR وتسجيل دخول بالمسح',
    href: '/occasions',
    icon: Tent,
    color: 'text-cyan-600',
    paths: ['/occasions'],
  },
  {
    key: 'notifications',
    label: 'الإشعارات',
    desc: 'إشعارات تصل إلى جهاز المخدوم أو الخادم: إرسال فوري أو مجدول لكنيسة / خدمة / فصل / مجموعة / مخدوم، وإشعارات تلقائية عند الحضور والنقاط والفصول الأونلاين والامتحانات، وسجل بالمُرسَل والمجدول',
    href: '/notifications',
    icon: Bell,
    color: 'text-indigo-600',
    paths: ['/notifications'],
  },
  {
    key: 'results',
    label: 'نتائج الامتحانات',
    desc: 'امتحانات بمواد ودرجات وأنظمة تقدير قابلة للتخصيص: إدخال جماعي سريع، استيراد من Excel، حساب النسب والتقديرات والترتيب تلقائياً، قفل النتائج، تقارير وسجل نتائج كل مخدوم',
    href: '/results',
    icon: ClipboardCheck,
    color: 'text-emerald-600',
    paths: ['/results'],
  },
  {
    key: 'library',
    label: 'المكتبة',
    desc: 'مكتبة بمواضيع: كتب (روابط PDF) ومحاضرات (فيديو أو صوت) — بحث ومفضلة، وكل محتوى يمكن إتاحته للجميع أو للخدام أو لخدمة أو فصل — والمخدوم يتصفحها من بوابته',
    href: '/library',
    icon: Library,
    color: 'text-lime-700',
    paths: ['/library'],
  },
  {
    key: 'activity',
    label: 'سجل النشاط',
    desc: 'كل ما يحدث في التطبيق: مَن فعل ماذا على مَن ومتى — حضور · نقاط · بيانات · خدام · دخول · وكل عملية في كل وحدة، مع الفرق قبل/بعد، حسب المستخدم أو حسب العملية، وتحميل 10 أو 100 أو 1000 عملية والتعمق أكثر',
    href: '/activity',
    icon: History,
    color: 'text-slate-700',
    paths: ['/activity'],
  },
  {
    key: 'reports',
    label: 'تقارير وجداول',
    desc: 'اختر البيانات (كنيسة · خدمة · فصل · فترة) والحقول التي تريدها بالضبط — رتّبها وسمّها وصفّها — ثم صمّم التقرير (عنوان · نص · شعار · جدول · رسم بياني · متغيرات) على صفحات، وصدّره PDF أو Excel أو اطبعه، واحفظه كقالب يُعاد استخدامه بنطاق جديد',
    href: '/reports',
    icon: FileBarChart2,
    color: 'text-fuchsia-600',
    paths: ['/reports'],
  },
  {
    key: 'family',
    label: 'العائلات',
    desc: 'عائلات من المخدومين والخدام: أضف الأفراد بمسح كود كل واحد (QR) — وعند مسح كود أي فرد في الماسح تظهر كل العائلة لاختيار الشخص والخدمة المطلوبة، مع التعرف على الخدمة التي حضرها اليوم',
    href: '/family',
    icon: UsersRound,
    color: 'text-teal-700',
    paths: ['/family'],
  },
  {
    key: 'access',
    label: 'التحكم في الدخول',
    desc: 'بوابات دخول بقواعد قابلة للتخصيص: امسح كود الشخص أو ابحث عنه فيظهر اسمه وصورته وحضوره ونقاطه مع «مسموح» أو «مرفوض» وكل قاعدة وهل تحققت — قواعد نقاط · حضور · مناسبات · نوع · عمر · تسجيل · امتحان · إنجاز · فعالية، تُربط بـ AND / OR ومجموعات، وقائمة مسموح لهم: أشخاص · فصل · خدمة · كنيسة',
    href: '/access',
    icon: DoorOpen,
    color: 'text-emerald-700',
    paths: ['/access'],
  },
];

export const MODULE_BY_KEY: Record<ModuleKey, AppModule> = Object.fromEntries(
  MODULES.map((m) => [m.key, m])
) as Record<ModuleKey, AppModule>;

// The OWNER MODULE — unique, never granted; only `role = owner` sees it.
export const OWNER_MODULE = {
  key: 'owner' as const,
  label: 'وحدة المالك',
  desc: 'تحكم خاص بمالك التطبيق — صلاحيات الوحدات وأكثر',
  href: '/owner',
  icon: Crown,
  color: 'text-gold-500',
  paths: ['/owner'],
};

// ---------- module_access rows (migration 0024) ----------
export interface ModuleAccess {
  id: string;
  module_key: string;
  church_id: string | null;   // null = every church
  service_id: string | null;  // null = all services of the church
  class_id: string | null;    // null = all classes of the service
  /** PERSON grant (20260925130000): only this servant sees the module; scope columns are null */
  servant_id?: string | null;
  created_at: string;
  created_by: string | null;
}

export const isPersonGrant = (g: ModuleAccess) => !!g.servant_id;

/**
 * Mirror of the SQL `scope_overlaps` + `module_visible` rules so the UI can
 * decide instantly from the (RLS-filtered) grant rows it already has.
 */
export function grantOverlapsProfile(g: ModuleAccess, p: Profile): boolean {
  if (p.role === 'owner') return true;
  if (isPersonGrant(g)) return g.servant_id === p.id;
  if (g.church_id === null) return true;
  if (g.church_id !== p.church_id) return false;
  if (p.role === 'church_manager') return true;
  if (p.service_id !== null && g.service_id !== null && g.service_id !== p.service_id) return false;
  if (p.role === 'service_manager') return true;
  if (p.class_id !== null && g.class_id !== null && g.class_id !== p.class_id) return false;
  return true;
}

export function visibleModuleKeys(grants: ModuleAccess[], profile: Profile | null): Set<string> {
  const out = new Set<string>();
  if (!profile) return out;
  if (profile.role === 'owner') {
    MODULES.forEach((m) => out.add(m.key));
    return out;
  }
  for (const g of grants) {
    if (grantOverlapsProfile(g, profile)) out.add(g.module_key);
  }
  return out;
}
