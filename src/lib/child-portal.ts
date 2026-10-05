'use client';

// ---------- Child portal (بوابة المخدوم) — client data layer ----------
// The child has no auth account. His card QR (= persons.national_id) is the
// bearer token: it is kept in localStorage and passed to every
// `child_portal_*` RPC (migration 0021). The RPCs are SECURITY DEFINER and
// return only that person's rows, so the anon key is enough.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Gender } from '@/lib/types';
import type { ExamResult, ExamStatus, PassMode, QuestionMode } from '@/lib/exams';

export const CHILD_TOKEN_KEY = 'child_portal_token';

// ---------- Types returned by the RPCs ----------
export interface ChildPerson {
  id: string;
  national_id: string;
  name: string;
  birthdate: string | null;
  gender: Gender | null;
  phone: string | null;
  address: string | null;
  image_url: string | null;
  created_at: string;
}

export interface ChildEnrollment {
  id: string;
  church_id: string;
  service_id: string;
  class_id: string;
  attendance_count: number;
  points: number;
  created_at: string;
  church_name: string;
  church_logo: string | null;
  service_name: string;
  service_photo: string | null;
  class_name: string;
  class_photo: string | null;
}

export interface ChildProfile {
  person: ChildPerson;
  enrollments: ChildEnrollment[];
}

export interface ChildAttendanceRow {
  id: string;
  enrollment_id: string;
  event_id: string | null;
  event_name: string | null;
  points_delta: number;
  attended_on: string; // YYYY-MM-DD (Cairo)
  created_at: string;
  recorded_by_name: string | null;
  class_name: string;
  service_name: string;
  church_name: string;
}

export interface ChildPointsRow {
  id: string;
  enrollment_id: string;
  source: 'cause' | 'attendance' | 'store' | 'exam' | 'birthday' | 'online' | 'achievement' | 'occasion';   // 'achievement' = الإنجازات (0031) · 'occasion' = الفعاليات (0032)   // 'store' = إستبدال النقاط (0026) · 'exam' = الامتحانات (0027) · 'birthday' = هدية عيد الميلاد (0028) · 'online' = الفصول الأونلاين (0030)
  reason: string | null;
  delta: number;
  created_at: string;
  recorded_by_name: string | null;
  class_name: string;
  service_name: string;
  church_name: string;
  event_name?: string | null;
  order_id?: string | null;                   // the store bill behind a 'store' row
  attempt_id?: string | null;                 // the exam attempt behind an 'exam' row
}

// ---------- Exams (الامتحانات) — what the child sees (migration 0027) ----------
export interface ChildExam {
  id: string;
  title: string;
  description: string | null;
  image_url: string | null;
  status: ExamStatus;
  opens_at: string | null;
  closes_at: string | null;
  default_seconds: number;
  question_mode: QuestionMode;
  random_count: number;
  max_attempts: number;
  show_result: boolean;
  pass_mode: PassMode;
  pass_value: number;
  points_pass: number;
  points_full: number;
  created_at: string;
  enrollment_id: string;
  class_name: string;
  service_name: string;
  church_name: string;
  total_questions: number;
  served_questions: number;
  attempts_used: number;
  open_attempt_id: string | null;
  last_result: ExamResult | null;
  is_open: boolean;
}

/** The question payload served to the child — NEVER contains the correct answer. */
export interface ChildExamQuestion {
  position: number;
  total: number;
  question_id: string | null;
  text: string;
  image_url: string | null;
  options: string[];       // in the SERVED (shuffled) order
  points: number;
  seconds: number;
  served_at: string;
  deadline_at: string;
  server_now: string;
}

export interface ChildExamStep {
  attempt_id: string;
  questions_count: number;
  finished: boolean;
  question?: ChildExamQuestion;
  result?: ExamResult;
}

// ---------- Online classes (الفصول الأونلاين) — what the child sees (migration 0030) ----------
import type { OnlineClassStatus, StreamPlatform, LiveQuestionStatus, AttendanceStatus, RoomMessage } from '@/lib/online-classes';

export interface ChildOnlineParticipant {
  id: string;
  first_joined_at: string;
  last_seen_at: string;
  left_at: string | null;
  seconds: number;
  percent: number;
  checks_ok: number;
  checks_late: number;
  checks_total: number;
  answers_count: number;
  correct_count: number;
  final_status: AttendanceStatus | null;
  final_percent: number | null;
  live_status: AttendanceStatus | null;
}

export interface ChildPendingCheck {
  id: string;
  seq: number;
  prompt: string | null;
  sent_at: string;
  expires_at: string;
}

export interface ChildLiveQuestion {
  id: string;
  text: string;
  options: string[] | null;
  points: number;
  status: LiveQuestionStatus;
  opened_at: string | null;
  closed_at: string | null;
  my_answer: { selected_index: number | null; answer_text: string | null; is_correct: boolean | null; points_granted: number; answered_at: string } | null;
  correct_index: number | null;     // only revealed once the question is closed
}

/** online_class_child_payload() — the card in the list and the room payload */
export interface ChildOnlineClass {
  id: string;
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
  exam_title: string | null;
  event_name: string | null;
  min_time_percent: number;
  checks_required: number;
  checks_min_success: number;
  min_answers: number;
  check_seconds: number;
  attendance_points: number;
  teacher_name: string | null;
  enrollment_id: string;
  class_name: string;
  service_name: string;
  server_now: string;
  participant: ChildOnlineParticipant | null;
  pending_check?: ChildPendingCheck | null;
  questions?: ChildLiveQuestion[];
}

// ---------- Points store (إستبدال النقاط) — the child's bills ----------
export interface ChildStoreOrderLine {
  id: string;
  item_name: string;
  item_code: string;
  image_url: string | null;
  unit_price: number;
  qty: number;
  line_total: number;
}

export interface ChildStoreOrder {
  id: string;
  enrollment_id: string;
  status: 'completed' | 'cancelled';
  /** 20261001120000 — pos = sold at the cashier · request = my approved request */
  source?: 'pos' | 'request';
  shop_id?: string | null;
  shop_name?: string | null;
  request_id?: string | null;
  note?: string | null;
  items_count: number;
  total_points: number;
  balance_before: number;
  balance_after: number;
  created_at: string;
  cancelled_at: string | null;
  recorded_by_name: string | null;
  class_name: string;
  service_name: string;
  church_name: string;
  items: ChildStoreOrderLine[];
}

// ---------- Shops in the portal (المتاجر, migration 20261001120000) ----------
export interface ChildShop {
  id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  church_id: string;
  church_name: string;
  items_count: number;            // active items with stock
  enrollment_ids: string[] | null; // my enrollments the shop is connected to
  pending_requests: number;       // my open requests in this shop
}

export interface ChildShopItem {
  id: string;
  code: string;
  name: string;
  description: string | null;
  image_url: string | null;
  price: number;
  stock: number;
}

export type ChildStoreRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface ChildStoreRequestLine {
  id: string;
  item_id: string | null;
  item_name: string;
  item_code: string;
  image_url: string | null;
  unit_price: number;
  qty: number;
  line_total: number;
}

export interface ChildStoreRequest {
  id: string;
  shop_id: string;
  shop_name: string;
  shop_image_url: string | null;
  enrollment_id: string;
  status: ChildStoreRequestStatus;
  items_count: number;
  total_points: number;
  balance_at_request: number;
  note: string | null;
  decision_note: string | null;
  order_id: string | null;
  decided_at: string | null;
  decided_by_name: string | null;
  created_at: string;
  class_name: string;
  service_name: string;
  church_name: string;
  items: ChildStoreRequestLine[];
}

export type RequestKind = 'data' | 'photo';
export type RequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface DataChangeRequest {
  id: string;
  person_id: string;
  kind: RequestKind;
  changes: Record<string, string | null>;
  previous: Record<string, string | null>;
  note: string | null;
  status: RequestStatus;
  decision_note: string | null;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
}

export const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = {
  pending: 'قيد المراجعة',
  approved: 'تمت الموافقة',
  rejected: 'مرفوض',
  cancelled: 'ملغي',
};

export const REQUEST_KIND_LABELS: Record<RequestKind, string> = {
  data: 'تعديل البيانات',
  photo: 'تغيير الصورة',
};

export const FIELD_LABELS: Record<string, string> = {
  name: 'الاسم',
  birthdate: 'تاريخ الميلاد',
  gender: 'النوع',
  phone: 'الهاتف',
  address: 'العنوان',
  image_url: 'الصورة',
};

// ---------- Token (localStorage) ----------
/**
 * Session token storage (migration 0042): the token is issued by `child_login`.
 * «تذكرني» → localStorage (survives closing the browser, 90 days server-side);
 * otherwise sessionStorage (dies with the tab, 12 hours server-side).
 */
export function getChildToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(CHILD_TOKEN_KEY) ?? window.sessionStorage.getItem(CHILD_TOKEN_KEY);
  } catch {
    return null;
  }
}
export function setChildToken(token: string, remember = true) {
  try {
    if (remember) {
      window.localStorage.setItem(CHILD_TOKEN_KEY, token);
      window.sessionStorage.removeItem(CHILD_TOKEN_KEY);
    } else {
      window.sessionStorage.setItem(CHILD_TOKEN_KEY, token);
      window.localStorage.removeItem(CHILD_TOKEN_KEY);
    }
  } catch {
    /* private mode */
  }
}
export function clearChildToken() {
  try {
    window.localStorage.removeItem(CHILD_TOKEN_KEY);
    window.sessionStorage.removeItem(CHILD_TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

// ---------- Accounts (migration 0042) ----------
export interface ChildLoginResult {
  token: string;
  expires_at: string;
  person_id: string;
  remember: boolean;
}

/** code + password → session token */
export async function childLogin(
  supabase: SupabaseClient,
  code: string,
  password: string,
  remember: boolean
): Promise<ChildLoginResult> {
  const ua = typeof navigator === 'undefined' ? null : navigator.userAgent.slice(0, 300);
  const { data, error } = await supabase.rpc('child_login', {
    p_code: code.trim(),
    p_password: password,
    p_remember: remember,
    p_user_agent: ua,
  });
  if (error) throw error;
  return data as ChildLoginResult;
}

export async function childLogout(supabase: SupabaseClient, token: string): Promise<void> {
  await supabase.rpc('child_logout', { p_token: token });
}

/** Validates + refreshes the session (extends a «remember me» session). */
// ---------- ONE request opens the portal (20261015120000) ----------
// `child_portal_bootstrap(token)` = child_session_touch + profile + every
// module block. A block the server could not produce (module not granted /
// migration missing) is null. Returns null when the RPC itself does not
// exist yet so the caller can fall back to the separate fetches.
export interface ChildBootstrap {
  session: { person_id: string; expires_at: string; remember: boolean };
  profile: ChildProfile;
  exams: ChildExam[] | null;
  conversations: import('@/lib/chat').ChildChatOverview[] | null;
  online_classes: ChildOnlineClass[] | null;
  achievements: import('@/lib/achievements').ChildAchievements | null;
  occasions: import('@/lib/occasions').ChildOccasion[] | null;
  notifications: import('@/lib/notifications').InboxItem[] | null;
  library: import('@/lib/library').ChildLibrary | null;
  shops: ChildShop[] | null;
  store_requests: ChildStoreRequest[] | null;
}

export async function fetchChildBootstrap(supabase: SupabaseClient, token: string): Promise<ChildBootstrap | null> {
  const { data, error } = await supabase.rpc('child_portal_bootstrap', { p_token: token, p_notif_limit: 80 });
  if (error) {
    // 42883 = function does not exist → migration not applied → fallback.
    // Any other error (session_expired …) must surface exactly as before.
    if (error.code === '42883' || /child_portal_bootstrap/.test(error.message ?? '') && /does not exist|not find/i.test(error.message ?? '')) return null;
    throw error;
  }
  const d = (data ?? {}) as Partial<ChildBootstrap>;
  if (!d.profile) throw new Error('invalid_code');
  return {
    session: d.session!,
    profile: d.profile,
    exams: d.exams ?? null,
    conversations: d.conversations ?? null,
    online_classes: d.online_classes ?? null,
    achievements: d.achievements ?? null,
    occasions: d.occasions ?? null,
    notifications: d.notifications ?? null,
    library: d.library ?? null,
    shops: d.shops ?? null,
    store_requests: d.store_requests ?? null,
  };
}

export async function childSessionTouch(
  supabase: SupabaseClient,
  token: string
): Promise<{ person_id: string; expires_at: string; remember: boolean }> {
  const { data, error } = await supabase.rpc('child_session_touch', { p_token: token });
  if (error) throw error;
  return data as { person_id: string; expires_at: string; remember: boolean };
}

export async function childChangePassword(
  supabase: SupabaseClient,
  token: string,
  current: string,
  next: string
): Promise<void> {
  const { error } = await supabase.rpc('child_change_password', {
    p_token: token,
    p_current: current,
    p_new: next,
  });
  if (error) throw error;
}

export interface ChildSignupLookup {
  exists: boolean;
  has_password: boolean;
  pending: boolean;
  name: string | null;
  /** 20260930120000: the code belongs to a FAMILY — a person can never take it */
  family?: boolean;
  /** 20261003120000: the accounts the person behind the code already has */
  is_child?: boolean;
  is_servant?: boolean;
  is_priest?: boolean;
}

export async function childSignupLookupCode(supabase: SupabaseClient, code: string): Promise<ChildSignupLookup> {
  const { data, error } = await supabase.rpc('child_signup_lookup_code', { p_code: code.trim() });
  if (error) throw error;
  return data as ChildSignupLookup;
}

export interface ChildSignupInput {
  code: string;
  name: string;
  password: string;
  gender: Gender | null;
  birthdate: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  image_url: string | null;
  church_id: string;
  service_id: string;
  class_id: string;
  /** 20261004120000: رمز الدعوة الذي فتح صفحة التسجيل (إلزامي) */
  invite: string;
}

export async function childSignup(
  supabase: SupabaseClient,
  input: ChildSignupInput
): Promise<{ request_id: string; code: string }> {
  const { data, error } = await supabase.rpc('child_signup', {
    p_code: input.code.trim(),
    p_name: input.name.trim(),
    p_password: input.password,
    p_gender: input.gender,
    p_birthdate: input.birthdate,
    p_phone: input.phone,
    p_address: input.address,
    p_notes: input.notes,
    p_image_url: input.image_url,
    p_church: input.church_id,
    p_service: input.service_id,
    p_class: input.class_id,
    p_invite: input.invite,
  });
  if (error) throw error;
  return data as { request_id: string; code: string };
}

export async function childSignupStatus(
  supabase: SupabaseClient,
  requestId: string
): Promise<{ status: 'pending' | 'approved' | 'rejected'; decision_note: string | null; code: string } | null> {
  const { data, error } = await supabase.rpc('child_signup_status', { p_request: requestId });
  if (error) throw error;
  return (data ?? null) as { status: 'pending' | 'approved' | 'rejected'; decision_note: string | null; code: string } | null;
}

/** Pending signup id (so the child can come back to the waiting screen). */
export const CHILD_SIGNUP_KEY = 'child_signup_request';
export function getChildSignupRequest(): string | null {
  if (typeof window === 'undefined') return null;
  try { return window.localStorage.getItem(CHILD_SIGNUP_KEY); } catch { return null; }
}
export function setChildSignupRequest(id: string | null) {
  try {
    if (id) window.localStorage.setItem(CHILD_SIGNUP_KEY, id);
    else window.localStorage.removeItem(CHILD_SIGNUP_KEY);
  } catch { /* ignore */ }
}

// ---------- Error mapping (RPC raise -> Arabic) ----------
const ERROR_MESSAGES: Record<string, string> = {
  // accounts (0042)
  session_expired: 'انتهت الجلسة — سجّل الدخول مجدداً',
  no_password: 'لم تُضبط كلمة مرور لهذا الكود بعد — جرّب الكلمة الافتراضية 000000 أو اطلب من الخادم ضبطها',
  account_stopped: 'هذا الحساب موقوف — تواصل مع خادم فصلك',
  enrollment_stopped: 'هذا التسجيل موقوف — لا يمكن تسجيل حضور أو نقاط',
  wrong_password: 'كلمة المرور غير صحيحة',
  weak_password: 'كلمة المرور قصيرة — 6 أحرف على الأقل',
  already_registered: 'هذا الكود مسجّل في هذا الفصل بالفعل — سجّل الدخول بدلاً من ذلك',
  invite_required: 'التسجيل بالدعوة فقط — افتح رابط الدعوة من خادم الفصل',
  invite_invalid: 'رابط الدعوة غير صالح أو انتهت صلاحيته — اطلب رابطًا جديدًا',
  wrong_password_signup: 'كلمة المرور غير صحيحة — هذا الكود له حساب بالفعل واكتب كلمة مروره نفسها',
  code_required: 'الكود مطلوب',
  name_required: 'الاسم مطلوب',
  church_required: 'اختر الكنيسة والخدمة والفصل',
  service_not_in_church: 'الخدمة لا تنتمي لهذه الكنيسة',
  class_not_in_service: 'الفصل لا ينتمي لهذه الخدمة',
  invalid_code: 'الكود غير صالح',
  unknown_code: 'هذا الكود غير مسجل — تأكد من كارت المخدوم',
  invalid_kind: 'نوع الطلب غير صالح',
  pending_exists: 'لديك طلب قيد المراجعة بالفعل — انتظر الرد عليه أو ألغِه أولاً',
  invalid_changes: 'البيانات المدخلة غير صالحة',
  no_changes: 'لم تغيّر أي بيانات',
  not_pending: 'هذا الطلب لم يعد قيد المراجعة',
  not_found: 'الطلب غير موجود',
  forbidden: 'ليس لديك صلاحية على هذا الطلب',
  // store shops (20261001120000)
  shop_not_found: 'هذا المتجر غير متاح لك الآن',
  empty_basket: 'السلة فارغة — أضف أصنافاً أولاً',
  invalid_line: 'بند غير صالح في السلة',
  item_not_found: 'أحد الأصناف لم يعد موجوداً في المتجر',
  item_inactive: 'أحد الأصناف غير متاح الآن',
  insufficient_stock: 'الكمية المتاحة من أحد الأصناف لا تكفي',
  insufficient_points: 'رصيدك من النقاط لا يكفي لهذه السلة',
  request_pending: 'لديك طلب سابق بانتظار الخادم في هذا المتجر — انتظر رده أو ألغِه أولاً',
  // exams (0027)
  module_not_visible: 'وحدة الامتحانات غير مفعّلة لفصلك',
  exam_not_found: 'الامتحان غير موجود',
  exam_out_of_scope: 'هذا الامتحان ليس لفصلك',
  exam_not_published: 'الامتحان غير منشور بعد',
  exam_not_open_yet: 'لم يبدأ وقت الامتحان بعد',
  exam_closed: 'انتهى وقت الامتحان',
  exam_has_no_questions: 'الامتحان لا يحتوي على أسئلة بعد',
  no_attempts_left: 'استهلكت كل محاولاتك في هذا الامتحان',
  attempt_not_found: 'المحاولة غير موجودة',
  attempt_in_progress: 'المحاولة لم تنته بعد',
  question_not_served: 'السؤال لم يُعرض بعد',
  position_mismatch: 'لا يمكن تخطي الأسئلة أو الرجوع',
  invalid_option: 'اختيار غير صالح',
  // online classes (0030)
  class_not_found: 'الفصل غير موجود',
  class_out_of_scope: 'هذا الفصل ليس لفصلك',
  class_not_live: 'الفصل ليس مباشراً الآن — انتظر حتى يبدأه الخادم',
  not_joined: 'ادخل الفصل أولاً',
  check_not_found: 'انتهى فحص الانتباه',
  question_closed: 'أُغلق هذا السؤال',
  already_answered: 'أجبت على هذا السؤال بالفعل',
  answer_blank: 'اكتب إجابتك أولاً',
  chat_disabled: 'الدردشة مغلقة في هذا الفصل',
  message_blank: 'اكتب رسالة أولاً',
  rate_limited: 'رسائل كثيرة — انتظر قليلاً',
};

export function childErrorMessage(err: unknown, fallback = 'حدث خطأ، حاول مجدداً'): string {
  const msg = (err as { message?: string } | null)?.message ?? '';
  for (const key of Object.keys(ERROR_MESSAGES)) {
    if (msg.includes(key)) return ERROR_MESSAGES[key];
  }
  return fallback;
}

// ---------- Fetchers ----------
// ---------- Birthday (migration 0028) ----------
export interface ChildBirthday {
  is_birthday: boolean;
  birthdate: string | null;
  age?: number;
  turns_age?: number;
  next_birthday?: string;
  days_left?: number;
  module_granted?: boolean;
  card?: { id: string; name: string; design: unknown } | null;
  constants?: {
    church_name: string; service_name: string; class_name: string; church_logo_url: string | null;
    service_logo_url?: string | null; class_logo_url?: string | null; // 0049
  };
  gift?: { points: number; created_at: string } | null;
}

export async function fetchChildBirthday(supabase: SupabaseClient, token: string): Promise<ChildBirthday | null> {
  const { data, error } = await supabase.rpc('child_portal_birthday', { p_national_id: token });
  if (error) return null;   // migration not run yet → no banner
  return data as ChildBirthday;
}

export async function fetchChildProfile(supabase: SupabaseClient, token: string): Promise<ChildProfile> {
  const { data, error } = await supabase.rpc('child_portal_profile', { p_national_id: token });
  if (error) throw error;
  return data as ChildProfile;
}

export async function fetchChildAttendance(supabase: SupabaseClient, token: string): Promise<ChildAttendanceRow[]> {
  const { data, error } = await supabase.rpc('child_portal_attendance', { p_national_id: token });
  if (error) throw error;
  return (data ?? []) as ChildAttendanceRow[];
}

export async function fetchChildPoints(supabase: SupabaseClient, token: string): Promise<ChildPointsRow[]> {
  const { data, error } = await supabase.rpc('child_portal_points', { p_national_id: token });
  if (error) throw error;
  return (data ?? []) as ChildPointsRow[];
}

/** The child's store bills (إستبدال النقاط). Empty when migration 0026 is missing. */
export async function fetchChildStoreOrders(supabase: SupabaseClient, token: string): Promise<ChildStoreOrder[]> {
  const { data, error } = await supabase.rpc('child_portal_store_orders', { p_national_id: token });
  if (error) return [];
  return (data ?? []) as ChildStoreOrder[];
}

/** ACTIVE shops connected to one of my enrollments. Empty when the shops migration is missing. */
export async function fetchChildShops(supabase: SupabaseClient, token: string): Promise<ChildShop[]> {
  const { data, error } = await supabase.rpc('child_portal_shops', { p_national_id: token });
  if (error) return [];
  return (data ?? []) as ChildShop[];
}

export async function fetchChildShopItems(supabase: SupabaseClient, token: string, shopId: string): Promise<ChildShopItem[]> {
  const { data, error } = await supabase.rpc('child_portal_shop_items', { p_national_id: token, p_shop: shopId });
  if (error) throw error;
  return (data ?? []) as ChildShopItem[];
}

/** «أرسل الطلب» — my cart → a pending request the servant approves after scanning my card */
export async function sendChildStoreRequest(
  supabase: SupabaseClient, token: string, shopId: string,
  lines: { item_id: string; qty: number }[], enrollmentId?: string | null, note?: string
): Promise<ChildStoreRequest> {
  const { data, error } = await supabase.rpc('child_portal_store_request', {
    p_national_id: token, p_shop: shopId, p_lines: lines,
    p_enrollment: enrollmentId ?? null, p_note: note?.trim() || null,
  });
  if (error) throw error;
  return data as ChildStoreRequest;
}

export async function cancelChildStoreRequest(supabase: SupabaseClient, token: string, requestId: string): Promise<ChildStoreRequest> {
  const { data, error } = await supabase.rpc('child_portal_store_request_cancel', { p_national_id: token, p_request: requestId });
  if (error) throw error;
  return data as ChildStoreRequest;
}

export async function fetchChildStoreRequests(supabase: SupabaseClient, token: string): Promise<ChildStoreRequest[]> {
  const { data, error } = await supabase.rpc('child_portal_store_requests', { p_national_id: token });
  if (error) return [];
  return (data ?? []) as ChildStoreRequest[];
}

export async function fetchChildRequests(supabase: SupabaseClient, token: string): Promise<DataChangeRequest[]> {
  const { data, error } = await supabase.rpc('child_portal_requests', { p_national_id: token });
  if (error) throw error;
  return (data ?? []) as DataChangeRequest[];
}

export async function submitChildRequest(
  supabase: SupabaseClient,
  token: string,
  kind: RequestKind,
  changes: Record<string, string | null>,
  note?: string
): Promise<DataChangeRequest> {
  const { data, error } = await supabase.rpc('child_portal_submit_request', {
    p_national_id: token,
    p_kind: kind,
    p_changes: changes,
    p_note: note ?? null,
  });
  if (error) throw error;
  return data as DataChangeRequest;
}

export async function cancelChildRequest(
  supabase: SupabaseClient,
  token: string,
  requestId: string
): Promise<DataChangeRequest> {
  const { data, error } = await supabase.rpc('child_portal_cancel_request', {
    p_national_id: token,
    p_request: requestId,
  });
  if (error) throw error;
  return data as DataChangeRequest;
}

// ---------- Exams (migration 0027) ----------
export async function fetchChildExams(supabase: SupabaseClient, token: string): Promise<ChildExam[]> {
  const { data, error } = await supabase.rpc('child_portal_exams', { p_national_id: token });
  if (error) throw error;
  return (data ?? []) as ChildExam[];
}

export async function startChildExam(supabase: SupabaseClient, token: string, examId: string): Promise<ChildExamStep> {
  const { data, error } = await supabase.rpc('child_exam_start', { p_national_id: token, p_exam: examId });
  if (error) throw error;
  return data as ChildExamStep;
}

export async function currentChildExamStep(supabase: SupabaseClient, token: string, attemptId: string): Promise<ChildExamStep> {
  const { data, error } = await supabase.rpc('child_exam_current', { p_national_id: token, p_attempt: attemptId });
  if (error) throw error;
  return data as ChildExamStep;
}

/** `selected` = index in the served options, or null = time ran out / skipped. */
export async function answerChildExam(
  supabase: SupabaseClient, token: string, attemptId: string, position: number, selected: number | null
): Promise<ChildExamStep> {
  const { data, error } = await supabase.rpc('child_exam_answer', {
    p_national_id: token, p_attempt: attemptId, p_position: position, p_selected: selected,
  });
  if (error) throw error;
  return data as ChildExamStep;
}

export async function fetchChildExamResult(supabase: SupabaseClient, token: string, attemptId: string): Promise<ExamResult> {
  const { data, error } = await supabase.rpc('child_exam_result', { p_national_id: token, p_attempt: attemptId });
  if (error) throw error;
  return data as ExamResult;
}

// ---------- Online classes (migration 0030) ----------
export async function fetchChildOnlineClasses(supabase: SupabaseClient, token: string): Promise<ChildOnlineClass[]> {
  const { data, error } = await supabase.rpc('child_online_classes', { p_national_id: token });
  if (error) throw error;
  return (data ?? []) as ChildOnlineClass[];
}
export async function fetchChildOnlineClass(supabase: SupabaseClient, token: string, classId: string): Promise<ChildOnlineClass> {
  const { data, error } = await supabase.rpc('child_online_class', { p_national_id: token, p_class: classId });
  if (error) throw error;
  return data as ChildOnlineClass;
}
export async function joinChildOnlineClass(supabase: SupabaseClient, token: string, classId: string): Promise<ChildOnlineClass> {
  const { data, error } = await supabase.rpc('child_online_join', { p_national_id: token, p_class: classId });
  if (error) throw error;
  return data as ChildOnlineClass;
}
export async function heartbeatChildOnlineClass(supabase: SupabaseClient, token: string, classId: string): Promise<ChildOnlineClass> {
  const { data, error } = await supabase.rpc('child_online_heartbeat', { p_national_id: token, p_class: classId });
  if (error) throw error;
  return data as ChildOnlineClass;
}
export async function leaveChildOnlineClass(supabase: SupabaseClient, token: string, classId: string): Promise<ChildOnlineClass> {
  const { data, error } = await supabase.rpc('child_online_leave', { p_national_id: token, p_class: classId });
  if (error) throw error;
  return data as ChildOnlineClass;
}
export async function respondChildCheck(supabase: SupabaseClient, token: string, checkId: string): Promise<ChildOnlineClass> {
  const { data, error } = await supabase.rpc('child_online_check_respond', { p_national_id: token, p_check: checkId });
  if (error) throw error;
  return data as ChildOnlineClass;
}
export async function answerChildLiveQuestion(
  supabase: SupabaseClient, token: string, questionId: string, selected: number | null, text: string | null
): Promise<ChildOnlineClass> {
  const { data, error } = await supabase.rpc('child_online_answer', { p_national_id: token, p_question: questionId, p_selected: selected, p_text: text });
  if (error) throw error;
  return data as ChildOnlineClass;
}
export async function fetchChildRoomMessages(supabase: SupabaseClient, token: string, classId: string): Promise<RoomMessage[]> {
  const { data, error } = await supabase.rpc('child_online_messages', { p_national_id: token, p_class: classId, p_before: null, p_limit: 150 });
  if (error) throw error;
  return (data ?? []) as RoomMessage[];
}
export async function sendChildRoomMessage(supabase: SupabaseClient, token: string, classId: string, body: string): Promise<void> {
  const { error } = await supabase.rpc('child_online_chat_send', { p_national_id: token, p_class: classId, p_body: body });
  if (error) throw error;
}

// ---------- Small helpers ----------
export function ageFromBirthdate(birthdate: string | null): number | null {
  if (!birthdate) return null;
  const b = new Date(birthdate);
  if (isNaN(b.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
  return age;
}

export const sumBy = <T,>(rows: T[], f: (r: T) => number) => rows.reduce((s, r) => s + f(r), 0);
