// ---------- Domain types (mirror of Supabase schema) ----------

export type AppRole = 'owner' | 'church_manager' | 'service_manager' | 'class_servant';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'suspended';

export interface Church {
  id: string;
  name: string;
  logo_url: string | null;
  address: string | null;
  /** manual order — the smaller shows first in every list (20260928130000) */
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface Service {
  id: string;
  church_id: string;
  name: string;
  description: string | null;
  photo_url: string | null;
  /** manual order inside the church (20260928130000) */
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ClassRoom {
  id: string;
  church_id: string;
  service_id: string;
  name: string;
  description: string | null;
  photo_url: string | null;
  /** manual order inside the service (20260928130000) */
  sort_order: number;
  created_at: string;
  updated_at: string;
}

// ---------- SERVANT ENROLLMENT (تسجيل الخادم, migration 0037) ----------
// Table `servant_enrollments` (formerly `profiles`; a compatibility VIEW named
// `profiles` still exists). A servant is a PERSON first (persons.national_id =
// his code / QR) and is then registered as a servant enrollment bound to
// church → service → class — the same architecture as a child's enrollment.
// `id` = auth.users.id (the login account); `user_id` = the login name derived
// from the code.
export interface ServantEnrollment {
  id: string;
  person_id: string | null;
  full_name: string;
  user_id: string;
  phone: string;
  role: AppRole;
  status: ApprovalStatus;
  church_id: string | null;
  service_id: string | null;
  class_id: string | null;
  photo_url: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

/** @deprecated alias kept for the existing pages — use ServantEnrollment */
export type Profile = ServantEnrollment;

// ---------- Multi-scope servants (migration 0045) ----------
/** One place a person is bound to: church → service → class (nulls = the whole level). */
export interface ScopeRef {
  church_id: string;
  service_id: string | null;
  class_id: string | null;
}

/** `servant_scopes` row — an ADDITIONAL place of a servant besides his primary scope. */
export interface ServantScope extends ScopeRef {
  id: string;
  servant_id: string;
  created_at: string;
  created_by: string | null;
}

export const SERVANT_SCOPES_TABLE = 'servant_scopes';

/** Primary scope of a servant enrollment as a ScopeRef (null when he has no church). */
export const primaryScope = (s: Pick<ServantEnrollment, 'church_id' | 'service_id' | 'class_id'>): ScopeRef | null =>
  s.church_id ? { church_id: s.church_id, service_id: s.service_id, class_id: s.class_id } : null;

/** primary ∪ extras, primary first, deduplicated. */
export const allScopesOf = (
  s: Pick<ServantEnrollment, 'church_id' | 'service_id' | 'class_id'>,
  extras: ScopeRef[] = [],
): ScopeRef[] => {
  const out: ScopeRef[] = [];
  const seen = new Set<string>();
  const push = (x: ScopeRef) => {
    const k = scopeKey(x);
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ church_id: x.church_id, service_id: x.service_id ?? null, class_id: x.class_id ?? null });
  };
  const p = primaryScope(s);
  if (p) push(p);
  extras.forEach(push);
  return out;
};

export const scopeKey = (x: ScopeRef) => `${x.church_id}|${x.service_id ?? ''}|${x.class_id ?? ''}`;

/** The table the app reads servants from (0037). */
export const SERVANTS_TABLE = 'servant_enrollments';

// ---------- Permissions (migration 0037) ----------
// permission_profiles — an owner-made named set of permission keys.
export interface PermissionProfile {
  id: string;
  name: string;
  description: string | null;
  permissions: string[]; // keys of PERMISSIONS (src/lib/permissions.ts)
  color: string;
  sort_order: number;
  created_at: string;
  created_by: string | null;
  edited_at: string;
  edited_by: string | null;
}

// permissions — connects a servant enrollment to a permission profile.
export interface PermissionGrant {
  id: string;
  servant_id: string;
  permission_profile_id: string;
  granted_by: string | null;
  created_at: string;
}

// servant_signup RPC result
export interface ServantSignupResult {
  person_id: string;
  person_created: boolean;
  national_id: string;
  user_id: string;
}

// signup_lookup_code RPC result (person known for the typed / scanned code)
export interface SignupCodeLookup {
  name: string;
  gender: Gender | null;
  birthdate: string | null;
  phone: string | null;
  address: string | null;
  image_url: string | null;
  has_account: boolean;
  /** 20260930120000: true when the code belongs to a FAMILY (no person fields then) */
  family?: boolean;
  /** 20261003120000: the person already has THE password (child / priest account) */
  has_password?: boolean;
  is_child?: boolean;
  is_priest?: boolean;
}

// ---------- Add servants directly (migration 0041 + /api/servants/create) ----------
// One item of the request body — single add sends 1, bulk sends many.
export interface AddServantInput {
  code: string;                 // = national_id = login name (after codeToUserId)
  full_name: string;
  password: string;             // ≥ 6 chars — typed or generated by the manager
  role: AppRole;                // never 'owner'
  church_id: string;            // required — the PRIMARY place (= scopes[0])
  service_id: string | null;
  class_id: string | null;
  /** 0045: every place of the servant (primary first). Optional — the single scope above is used when absent. */
  scopes?: ScopeRef[];
  gender: Gender | null;
  birthdate: string | null;     // YYYY-MM-DD
  phone: string | null;         // +2XXXXXXXXXXX
  address: string | null;
  notes: string | null;
  image_url: string | null;
  profile_ids: string[];        // permission profiles granted right away
}

export type AddServantError =
  | 'code_required' | 'name_required' | 'church_required' | 'weak_password'
  | 'code_taken' | 'code_is_family' | 'already_registered' | 'duplicate_in_batch'
  | 'not_allowed' | 'invalid_scope' | 'invalid_gender' | 'failed';

export type AddServantOutcome =
  | {
      ok: true;
      servant_id: string;
      person_id: string | null;
      person_created: boolean;
      national_id: string;
      user_id: string;
      profiles_granted: number;
      /** 20261003120000: the person already had a password — the typed one was ignored */
      password_reused?: boolean;
    }
  | { ok: false; error: AddServantError; user_id?: string; detail?: string };

export const ADD_SERVANT_ERROR_LABELS: Record<AddServantError, string> = {
  code_required: 'الكود مفقود',
  name_required: 'الاسم مفقود',
  church_required: 'اختر الكنيسة',
  weak_password: 'كلمة المرور أقل من 6 أحرف',
  code_taken: 'الكود مستخدم لخادم آخر',
  code_is_family: 'الكود كود عائلة — لا يمكن استخدامه لشخص',
  already_registered: 'الحساب مسجّل بالفعل',
  duplicate_in_batch: 'كود مكرر داخل نفس الملف',
  not_allowed: 'خارج صلاحياتك (الدور أو النطاق)',
  invalid_scope: 'الخدمة / الفصل لا يتبعان الكنيسة المختارة',
  invalid_gender: 'النوع غير صالح',
  failed: 'فشل الحفظ',
};

// admin_servant_code_lookup RPC result (live pre-check in the add form)
export interface AdminCodeLookup {
  user_id: string;
  login_taken: boolean;
  person: (SignupCodeLookup & { notes: string | null }) | null;
  /** 20260930120000: name of the family that owns this code (a person can never take it) */
  family?: string | null;
}

export type Gender = 'male' | 'female';

export const GENDER_LABELS: Record<Gender, string> = {
  male: 'ذكر',
  female: 'أنثى',
};

// ---------- PERSON-CENTRIC MODEL (migration 0011) ----------

// persons — the central identity table.
// national_id IS the QR code, unique per person.
export interface Person {
  id: string;
  national_id: string;
  name: string;
  birthdate: string | null;
  gender: Gender | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  image_url: string | null;
  created_at: string;
  created_by: string | null;
  edited_at: string;
  edited_by: string | null;
}

// enrollments — a person bound to church + service + class.
// One person may have MANY enrollments. Attendance & points live here.
export interface Enrollment {
  id: string;
  person_id: string;
  church_id: string;
  service_id: string;
  class_id: string;
  attendance_count: number;
  points: number;
  created_at: string;
  created_by: string | null;
  edited_at: string;
  edited_by: string | null;
  /** migration 0042: 'child' (default) or 'servant' (mirror of a servant account) */
  kind?: 'child' | 'servant';
  /** the servant_enrollments.id this mirror row belongs to (kind = 'servant') */
  servant_id?: string | null;
  /** migration 0043: 'active' (default) or 'stopped' — no attendance / points / portal login */
  status?: EnrollmentStatus;
}

// ---------- Stop (إيقاف) — migration 0043 ----------
export type EnrollmentStatus = 'active' | 'stopped';
export const ENROLLMENT_STATUS_LABELS: Record<EnrollmentStatus, string> = {
  active: 'يعمل',
  stopped: 'موقوف',
};
/** The default login / portal password (children who never set one, new servant accounts). */
export const DEFAULT_PASSWORD = '000000';

// Enrollment joined with its person (the shape most pages work with)
export interface EnrollmentWithPerson extends Enrollment {
  person: Person;
}

// Result of the add_person_and_enroll RPC
export interface AddPersonResult {
  person_id: string;
  enrollment_id: string;
  national_id: string;
  person_created: boolean;
  already_enrolled: boolean;
  /** migration 0042: true when the child has a portal password */
  has_password?: boolean;
}

// ---------- Child accounts (migration 0042) ----------
export type ChildJoinRequestStatus = 'pending' | 'approved' | 'rejected';

export interface ChildJoinRequest {
  id: string;
  code: string;
  name: string;
  gender: 'male' | 'female' | null;
  birthdate: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  image_url: string | null;
  church_id: string;
  service_id: string;
  class_id: string;
  status: ChildJoinRequestStatus;
  decision_note: string | null;
  decided_by: string | null;
  decided_at: string | null;
  person_id: string | null;
  enrollment_id: string | null;
  created_at: string;
}

export const CHILD_JOIN_REQUEST_STATUS_LABELS: Record<ChildJoinRequestStatus, string> = {
  pending: 'قيد المراجعة',
  approved: 'مقبول',
  rejected: 'مرفوض',
};

// Egypt phone: displayed prefix +2 followed by exactly 11 digits (e.g. 01xxxxxxxxx)
export const PHONE_PREFIX = '+2';
export const PHONE_LOCAL_LENGTH = 11;

// ---------- Events & Causes (migrations 0013 + 0014) ----------

// Recurrence: 'once' (has event_date) or 'weekly' (weekdays[]).
// One weekday = every week; several = week days.
export type EventRecurrence = 'once' | 'weekly';

export const RECURRENCE_LABELS: Record<EventRecurrence, string> = {
  once: 'مرة واحدة',
  weekly: 'أسبوعياً',
};

// How the points amount behaves when recording (migration 0015):
//   'fixed'    -> bound number, cannot be changed
//   'editable' -> bound number as default, can be changed
//   'open'     -> no bound number, entered each time
export type PointsMode = 'fixed' | 'editable' | 'open';

export const POINTS_MODE_LABELS: Record<PointsMode, string> = {
  fixed: 'رقم ثابت',
  editable: 'قابل للتعديل',
  open: 'مفتوح',
};

// events — something attendable, bound to a scope:
//   service_id null => ALL services of the church (class null too)
//   class_id  null => ALL classes of the (church, service)
// Attendance is registered AGAINST an event and grants `points`.
export interface AppEvent {
  id: string;
  church_id: string;
  service_id: string | null;
  class_id: string | null;
  name: string;
  description: string | null;
  recurrence: EventRecurrence;
  event_date: string | null; // when recurrence = once
  weekdays: number[] | null; // 0=Sunday..6=Saturday, when recurrence = weekly
  start_time: string | null; // 'HH:MM:SS' Africa/Cairo
  end_time: string | null; // 'HH:MM:SS' Africa/Cairo
  points: number; // points granted per attendance
  points_mode: PointsMode; // fixed / editable / open (migration 0015)
  is_default: boolean; // default OF ITS SCOPE (0048): class → service → church; see lib/defaults.ts
  created_at: string;
  created_by: string | null;
  edited_at: string;
  edited_by: string | null;
}

// causes — the reason points are given/taken, bound to church / service / class.
// (same null = "all" scope semantics as events) with a bound points amount.
export interface Cause {
  id: string;
  church_id: string;
  service_id: string | null;
  class_id: string | null;
  name: string;
  description: string | null;
  points: number; // points amount bound to this cause
  points_mode: PointsMode; // fixed / editable / open (migration 0015)
  is_default: boolean; // default OF ITS SCOPE (0048): class → service → church; see lib/defaults.ts
  created_at: string;
  created_by: string | null;
  edited_at: string;
  edited_by: string | null;
}

// Does an event/cause scope apply to an enrollment's scope?
export const scopeApplies = (
  x: { church_id: string; service_id: string | null; class_id: string | null },
  e: { church_id: string; service_id: string; class_id: string }
): boolean =>
  x.church_id === e.church_id &&
  (x.service_id === null || x.service_id === e.service_id) &&
  (x.class_id === null || x.class_id === e.class_id);

// ---------- Log tables ----------

// enrollment_id already identifies church / service / class.
// Attendance rows record WHICH EVENT was attended; removing attendance
// DELETES the row (a DB trigger reverts the counters).
export interface AttendanceLog {
  id: string;
  enrollment_id: string;
  event_id: string | null; // null on legacy rows only
  points_delta: number;
  attended_on: string; // 'YYYY-MM-DD' in Africa/Cairo — unique per event per day
  recorded_by: string | null;
  created_at: string;
}

export interface PointsLog {
  id: string;
  enrollment_id: string;
  cause_id: string | null; // why the points changed (null on legacy rows)
  event_id: string | null; // the EVENT the points were given in (migration 0022; null on legacy rows)
  delta: number; // positive = add, negative = subtract
  recorded_by: string | null;
  created_at: string;
}

// contact_log (migration 0022) — a call or message made for a child AS A
// FOLLOW-UP FOR AN EVENT (e.g. calling the absent children of Friday's mass).
export type ContactKind = 'call' | 'whatsapp' | 'sms' | 'internal';

export const CONTACT_KIND_LABELS: Record<ContactKind, string> = {
  call: 'اتصال',
  whatsapp: 'واتساب',
  sms: 'رسالة SMS',
  internal: 'رسالة داخلية',
};

export interface ContactLog {
  id: string;
  enrollment_id: string;
  event_id: string | null;
  kind: ContactKind;
  message: string | null; // the sent text (variables substituted); null for calls
  contacted_on: string; // 'YYYY-MM-DD' Africa/Cairo
  feedback_id: string | null; // outcome of the call (migration 0023; null = plain call / message)
  occurrence_on: string | null; // 'YYYY-MM-DD' — the event occurrence this follow-up refers to (0023)
  note: string | null; // «أخرى»: the cause written by hand when no predefined feedback fits (20261012120000)
  recorded_by: string | null;
  created_at: string;
}

// ---------- Call feedbacks (migration 0023) ----------
// The OUTCOME of a follow-up call (e.g. «سيأتي الأسبوع القادم», «مريض»,
// «لم يرد»). Defined by the managers with a NAME, a COLOR and an ICON and
// bound to a scope: church → service (null = all) → class (null = all) →
// event (null = all events). Chosen from the call-feedback badge on a
// child's card; stored as a `contact_log` row (kind = 'call') with
// `feedback_id` + `occurrence_on`.
export interface CallFeedback {
  id: string;
  church_id: string;
  service_id: string | null;
  class_id: string | null;
  event_id: string | null;
  name: string;
  color: string; // '#rrggbb'
  icon: string; // key of CALL_FEEDBACK_ICONS (src/lib/call-feedback.ts)
  sort_order: number;
  created_at: string;
  created_by: string | null;
  edited_at: string;
  edited_by: string | null;
}

// Does a feedback apply to an enrollment inside a given event?
export const feedbackApplies = (
  fb: CallFeedback,
  e: { church_id: string; service_id: string; class_id: string },
  eventId: string | null
): boolean => scopeApplies(fb, e) && (fb.event_id === null || fb.event_id === eventId);

// ---------- Jobs (app-code constants, not stored in DB) ----------
// Jobs are the actions a servant performs on persons from the persons page.

export type Job = 'attendance' | 'call' | 'message' | 'points' | 'data' | 'print_card' | 'achievement';

export const JOBS: { value: Job; label: string }[] = [
  { value: 'attendance', label: 'الحضور' },
  { value: 'call', label: 'الاتصال' },
  { value: 'message', label: 'الرسائل' },
  { value: 'points', label: 'النقاط' },
  { value: 'data', label: 'البيانات' },
  { value: 'print_card', label: 'طباعة كارت' },
  { value: 'achievement', label: 'الإنجازات' },   // achievements module (0031)
];

// ---------- Card print requests (migration 0018) ----------
// A servant requests a card print from the children page; the print page
// prints from this list and can delete one / group / all.
export interface CardPrintRequest {
  id: string;
  enrollment_id: string;
  church_id: string;
  service_id: string;
  class_id: string;
  requested_by: string | null;
  created_at: string;
}

// ---------- Shepherds module — الأشابين (migration 0025) ----------
// One row = one child (enrollment) inside one servant's group. A child can
// be in ONE group only (unique enrollment_id).
export interface ShepherdGroupRow {
  id: string;
  servant_id: string;
  enrollment_id: string;
  church_id: string;
  service_id: string;
  class_id: string;
  created_at: string;
}

// `shepherd_claims` RPC — who holds each visible child (servant name/photo
// resolved server-side, since profiles RLS hides other servants).
export interface ShepherdClaim {
  enrollment_id: string;
  servant_id: string;
  servant_name: string;
  servant_photo: string | null;
  created_at: string;
}

// `shepherd_group_summary` RPC — group size per servant in scope
export interface ShepherdGroupSummary {
  servant_id: string;
  servant_name: string;
  servant_photo: string | null;
  children: number;
}

// ---------- Points store module (إستبدال النقاط, migration 0026) ----------

// store_items — an inventory item. Scoped church → service → class (null =
// all) like causes / events; the code is the printed QR label.
export interface StoreItem {
  id: string;
  church_id: string;
  service_id: string | null;
  class_id: string | null;
  code: string;
  name: string;
  description: string | null;
  image_url: string | null;
  price: number;   // in points
  stock: number;   // available count
  is_active: boolean;
  sort_order: number;
  shop_id: string | null;   // the shop the item belongs to (20261001120000) — null = legacy POS-only item
  created_at: string;
  created_by: string | null;
  edited_at: string;
  edited_by: string | null;
}

// ---------- Shops (المتاجر, migration 20261001120000) ----------

// store_shops — a shop / kiosk with an activation switch. Connected to one
// or many places through store_shop_targets; ACTIVE shops appear in the
// child portal where the child can build a cart and send a request.
export interface StoreShop {
  id: string;
  church_id: string;         // owning church
  name: string;
  description: string | null;
  image_url: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  created_by: string | null;
  edited_at: string;
  edited_by: string | null;
}

// store_shop_targets — one place the shop is connected to.
// church_id null = «الكل»; church only = whole church; + service; + class.
export interface StoreShopTarget {
  id: string;
  shop_id: string;
  church_id: string | null;
  service_id: string | null;
  class_id: string | null;
  created_at: string;
}

export type StoreRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

// store_requests — a cart the child sent from his portal
export interface StoreRequest {
  id: string;
  shop_id: string;
  enrollment_id: string;
  person_id: string;
  church_id: string;
  service_id: string;
  class_id: string;
  status: StoreRequestStatus;
  items_count: number;
  total_points: number;
  balance_at_request: number;
  note: string | null;
  decision_note: string | null;
  order_id: string | null;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
}

export interface StoreRequestItem {
  id: string;
  request_id: string;
  item_id: string | null;
  item_code: string;
  item_name: string;
  image_url: string | null;
  unit_price: number;
  qty: number;
  line_total: number;
}

/** store_request_json / store_request_detail shape (request + lines + names) */
export interface StoreRequestDetail extends Omit<StoreRequest, 'decided_by'> {
  shop_name: string;
  shop_image_url: string | null;
  decided_by_name: string | null;
  class_name: string;
  service_name: string;
  church_name: string;
  items: Omit<StoreRequestItem, 'request_id'>[];
}

export const STORE_REQUEST_STATUS_LABELS: Record<StoreRequestStatus, string> = {
  pending: 'بانتظار الخادم',
  approved: 'تم التسليم',
  rejected: 'مرفوض',
  cancelled: 'ألغاه المخدوم',
};

export type StoreOrderSource = 'pos' | 'request';

export type StoreOrderStatus = 'completed' | 'cancelled';

// store_orders — one bill (archive row)
export interface StoreOrder {
  id: string;
  enrollment_id: string;
  person_id: string;
  church_id: string;
  service_id: string;
  class_id: string;
  status: StoreOrderStatus;
  items_count: number;
  total_points: number;
  balance_before: number;
  balance_after: number;
  note: string | null;
  points_log_id: string | null;
  refund_points_log_id: string | null;
  recorded_by: string | null;
  created_at: string;
  cancelled_by: string | null;
  cancelled_at: string | null;
  shop_id: string | null;         // 20261001120000
  request_id: string | null;      // the child's request behind a 'request' order
  source: StoreOrderSource;       // pos = sold at the cashier · request = approved child request
}

// store_order_items — one line of a bill (snapshot of the item at sale time)
export interface StoreOrderItem {
  id: string;
  order_id: string;
  item_id: string | null;
  item_code: string;
  item_name: string;
  image_url: string | null;
  unit_price: number;
  qty: number;
  line_total: number;
}

// store_checkout RPC result
export interface StoreCheckoutResult {
  order_id: string;
  total_points: number;
  items_count: number;
  balance_before: number;
  balance_after: number;
}

export const STORE_ORDER_STATUS_LABELS: Record<StoreOrderStatus, string> = {
  completed: 'مكتملة',
  cancelled: 'ملغاة',
};

export const ROLE_LABELS: Record<AppRole, string> = {
  owner: 'مالك التطبيق',
  church_manager: 'مدير كنيسة',
  service_manager: 'مسؤول خدمة',
  class_servant: 'خادم فصل',
};

export const STATUS_LABELS: Record<ApprovalStatus, string> = {
  pending: 'قيد المراجعة',
  approved: 'مقبول',
  rejected: 'مرفوض',
  suspended: 'موقوف',
};

// Upload a photo to the public 'photos' bucket and return its public URL
export const PHOTOS_BUCKET = 'photos';

// user_id -> synthetic email used for Supabase auth
export const userIdToEmail = (userId: string) =>
  `${userId.trim().toLowerCase()}@diocese.app`;

// servant code (national id / QR) -> login name (mirror of SQL code_to_user_id)
export const codeToUserId = (code: string) =>
  code.trim().toLowerCase().replace(/[^a-zA-Z0-9._-]/g, '-');
