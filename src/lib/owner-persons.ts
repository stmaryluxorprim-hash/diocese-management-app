'use client';

// ---------- إدارة الأفراد (owner module) — data layer ----------
// Thin wrappers over the owner-only RPCs of migration
// 20260923120000_owner_persons_management.sql:
//   owner_persons_page          list (filters + pagination, enrollments embedded)
//   owner_persons_counts        header counters
//   owner_bulk_enroll           add many persons → many classes
//   owner_bulk_unenroll         remove many persons from a scope
//   owner_bulk_delete_persons   delete many persons completely (cascade)
// 20261005120000:
//   owner_add_priest_for_person a priest account for an existing person
//   owner_merge_persons         two persons rows → one (the owner picks the values)

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AppRole, ApprovalStatus, EnrollmentStatus, Gender, Person, ScopeRef } from '@/lib/types';
import { reads, type ReadOpts } from '@/lib/cached-reads';
import { classIdsOf } from '@/lib/class-multi';

/** One enrollment as embedded by owner_persons_page. */
export interface OwnerEnrollment {
  id: string;
  church_id: string;
  service_id: string;
  class_id: string;
  kind: 'child' | 'servant';
  servant_id: string | null;
  status: EnrollmentStatus;
  points: number;
  attendance_count: number;
  created_at: string;
}

/** The servant account bound to this person (null for a plain child). */
export interface OwnerServantInfo {
  id: string;
  role: AppRole;
  status: ApprovalStatus;
  church_id: string | null;
  service_id: string | null;
  class_id: string | null;
  scopes: ScopeRef[];
  /** places he asked for from another invite link — awaiting review (20261006120000). */
  pending_scopes?: ScopeRef[];
}

/** The priest account bound to this person (20261005120000). */
export interface OwnerPriestInfo {
  id: string;
  church_id: string;
  title: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'suspended';
  created_at: string;
}

/** A row of إدارة الأفراد — the full person + everything bound to him. */
export interface OwnerPersonRow extends Omit<Person, 'created_by' | 'edited_by'> {
  gender: Gender | null;
  enrollments: OwnerEnrollment[];
  servant: OwnerServantInfo | null;
  priest: OwnerPriestInfo | null;
  has_password: boolean;
  total_count: number;
}

export type ScopeMode = 'all' | 'scope' | 'none';
export type PersonKindFilter = 'all' | 'child' | 'servant' | 'priest';

/** The kinds of enrollment a person can hold — كمخدوم · كخادم · ككاهن. */
export type EnrollmentKind = 'child' | 'servant' | 'priest';
export const ENROLLMENT_KIND_LABELS: Record<EnrollmentKind, { as: string; noun: string }> = {
  child: { as: 'كمخدوم', noun: 'مخدوم' },
  servant: { as: 'كخادم', noun: 'خادم' },
  priest: { as: 'ككاهن', noun: 'كاهن' },
};

/** every kind the person currently holds (for the card badges) */
export function personKinds(r: Pick<OwnerPersonRow, 'enrollments' | 'servant' | 'priest'>): EnrollmentKind[] {
  const k: EnrollmentKind[] = [];
  if (r.enrollments.some((e) => e.kind === 'child')) k.push('child');
  if (r.servant) k.push('servant');
  if (r.priest) k.push('priest');
  return k;
}

export interface OwnerPersonsFilter {
  search?: string;
  scopeMode: ScopeMode;
  church?: string | null;
  service?: string | null;
  class?: string | null;
  /** MULTI-select of classes (empty = all); wins over `class`. 2+ classes → one RPC per class, merged client-side */
  classes?: string[];
  gender?: Gender | null;
  kind: PersonKindFilter;
}

export const OWNER_PAGE_SIZE = 100;

/**
 * Phase 2: cached under the rpc name + the COMPLETE argument object below
 * (search, scope mode/church/service/class, gender, kind, limit, offset), so
 * another page / page size / search / filter is always another entry.
 * `opts.force` = realtime / manual refresh / after an owner write;
 * `opts.bypass` = select-all before a bulk delete, merge-candidate search.
 */
export async function fetchOwnerPersons(
  supabase: SupabaseClient,
  f: OwnerPersonsFilter,
  page = 0,
  pageSize = OWNER_PAGE_SIZE,
  opts: ReadOpts = {},
): Promise<{ rows: OwnerPersonRow[]; total: number }> {
  const classIds = f.scopeMode === 'scope' ? classIdsOf(f) : [];
  const call = (cls: string | null, limit: number, offset: number) =>
    // the error is thrown raw (as before) — the page maps it with ownerPersonsError()
    reads.rpc<OwnerPersonRow[] | null>(supabase, 'owner_persons_page', {
      p_search: f.search?.trim() || null,
      p_scope_mode: f.scopeMode,
      p_church: f.scopeMode === 'scope' ? f.church || null : null,
      p_service: f.scopeMode === 'scope' ? f.service || null : null,
      p_class: cls,
      p_gender: f.gender || null,
      p_kind: f.kind,
      p_limit: limit,
      p_offset: offset,
    }, opts);
  const normalize = (data: OwnerPersonRow[] | null) => ((data ?? []) as OwnerPersonRow[]).map((r) => ({
    ...r,
    enrollments: (r.enrollments ?? []) as OwnerEnrollment[],
    servant: (r.servant ?? null) as OwnerServantInfo | null,
    priest: (r.priest ?? null) as OwnerPriestInfo | null,
  }));

  if (classIds.length <= 1) {
    const rows = normalize(await call(classIds[0] ?? null, pageSize, page * pageSize));
    return { rows, total: rows[0]?.total_count ?? 0 };
  }

  // 2+ classes: the RPC filters ONE class → fetch each (a person in several of
  // them counts once), sort like the RPC (name, id) and page locally
  const MAX_PER_CLASS = 500; // the RPC's own cap
  const lists = await Promise.all(classIds.map((c) => call(c, MAX_PER_CLASS, 0)));
  const byId = new Map<string, OwnerPersonRow>();
  for (const list of lists) for (const r of normalize(list)) if (!byId.has(r.id)) byId.set(r.id, r);
  const merged = Array.from(byId.values()).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const total = merged.length;
  return { rows: merged.slice(page * pageSize, page * pageSize + pageSize).map((r) => ({ ...r, total_count: total })), total };
}

export interface OwnerPersonsCounts {
  total: number;
  unenrolled: number;
  servants: number;
  children: number;
  /** 20261005120000 (undefined before the migration) */
  priests?: number;
}

/** error / empty answer → null (as before; never cached) */
export async function fetchOwnerPersonsCounts(supabase: SupabaseClient, opts: ReadOpts = {}): Promise<OwnerPersonsCounts | null> {
  return reads.rpcSoft<OwnerPersonsCounts>(supabase, 'owner_persons_counts', {}, opts);
}

export interface BulkEnrollResult { added: number; skipped: number; persons: number; scopes: number }

export async function bulkEnroll(
  supabase: SupabaseClient,
  personIds: string[],
  scopes: ScopeRef[],
): Promise<BulkEnrollResult> {
  const { data, error } = await supabase.rpc('owner_bulk_enroll', {
    p_person_ids: personIds,
    p_scopes: scopes.map((s) => ({ church_id: s.church_id, service_id: s.service_id, class_id: s.class_id })),
  });
  if (error) throw error;
  return data as BulkEnrollResult;
}

export async function bulkUnenroll(
  supabase: SupabaseClient,
  personIds: string[],
  scope: { church_id: string; service_id?: string | null; class_id?: string | null },
): Promise<{ removed: number }> {
  const { data, error } = await supabase.rpc('owner_bulk_unenroll', {
    p_person_ids: personIds,
    p_church: scope.church_id,
    p_service: scope.service_id ?? null,
    p_class: scope.class_id ?? null,
  });
  if (error) throw error;
  return data as { removed: number };
}

export async function bulkDeletePersons(
  supabase: SupabaseClient,
  personIds: string[],
): Promise<{ deleted: number; skipped_servants: number }> {
  const { data, error } = await supabase.rpc('owner_bulk_delete_persons', { p_person_ids: personIds });
  if (error) throw error;
  return data as { deleted: number; skipped_servants: number };
}

// ---------- 20261005120000: add a priest account to an existing person ----------
/** Another servant place for an EXISTING servant account (owner_add_servant_places, 20261006120000). */
export async function addServantPlaces(
  supabase: SupabaseClient,
  servantId: string,
  scopes: ScopeRef[],
): Promise<{ servant_id: string; scopes: ScopeRef[]; count: number }> {
  const { data, error } = await supabase.rpc('owner_add_servant_places', {
    p_servant: servantId,
    p_scopes: scopes.map((s) => ({ church_id: s.church_id, service_id: s.service_id ?? null, class_id: s.class_id ?? null })),
  });
  if (error) throw error;
  return data as { servant_id: string; scopes: ScopeRef[]; count: number };
}

export async function addPriestForPerson(
  supabase: SupabaseClient,
  personId: string,
  churchId: string,
  title: string | null,
  password: string | null,
): Promise<{ priest_id: string; person_id: string; code: string }> {
  const { data, error } = await supabase.rpc('owner_add_priest_for_person', {
    p_person: personId, p_church: churchId, p_title: title, p_password: password,
  });
  if (error) throw error;
  return data as { priest_id: string; person_id: string; code: string };
}

// ---------- 20261005120000: merge two persons ----------
/** The identity fields the owner chooses between when merging. */
export type MergeField = 'name' | 'gender' | 'birthdate' | 'phone' | 'address' | 'notes' | 'image_url' | 'national_id';
export const MERGE_FIELDS: { key: MergeField; label: string }[] = [
  { key: 'national_id', label: 'الكود' },
  { key: 'name', label: 'الاسم' },
  { key: 'gender', label: 'النوع' },
  { key: 'birthdate', label: 'تاريخ الميلاد' },
  { key: 'phone', label: 'الهاتف' },
  { key: 'address', label: 'العنوان' },
  { key: 'notes', label: 'ملاحظات' },
  { key: 'image_url', label: 'الصورة' },
];

export interface MergeResult {
  person_id: string;
  code: string;
  moved: Record<string, number>;
  servant_id: string | null;
  priest_id: string | null;
  /** the servant Auth account must be re-synced — POST /api/servants/account {action:'realign'} */
  realign_servant: boolean;
}

export async function mergePersons(
  supabase: SupabaseClient,
  keepId: string,
  removeId: string,
  fields: Partial<Record<MergeField, string | null>>,
): Promise<MergeResult> {
  const { data, error } = await supabase.rpc('owner_merge_persons', { p_keep: keepId, p_remove: removeId, p_fields: fields });
  if (error) throw error;
  const r = data as MergeResult;
  if (r.realign_servant && r.servant_id) {
    // the login e-mail / password hash of the servant account follow the merged person
    try {
      const res = await fetch('/api/servants/account', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'realign', servant_id: r.servant_id }),
      });
      if (res.ok) r.realign_servant = false;
    } catch { /* reported to the owner by the caller */ }
  }
  return r;
}

/** Human message for the RPC errors above. */
export function ownerPersonsError(err: unknown, fallback = 'تعذر تنفيذ العملية'): string {
  const m = (err as { message?: string; code?: string } | null)?.message ?? '';
  const code = (err as { code?: string } | null)?.code ?? '';
  if (code === 'PGRST202' || /Could not find the function/i.test(m)) {
    return 'تحديث قاعدة البيانات مطلوب — شغّل 20260923120000_owner_persons_management.sql';
  }
  if (m.includes('forbidden')) return 'هذه الصفحة لمالك التطبيق فقط';
  if (m.includes('no_access')) return 'ليس لديك صلاحية على هذا النطاق';
  if (m.includes('invalid_scope')) return 'الفصل لا يتبع الخدمة / الكنيسة المختارة';
  if (m.includes('class_required')) return 'اختر الفصل — التسجيل يكون دائمًا في فصل';
  if (m.includes('church_required')) return 'اختر الكنيسة أولاً';
  if (m.includes('persons_required')) return 'لم يُحدَّد أي شخص';
  if (m.includes('scopes_required')) return 'اختر فصلًا واحدًا على الأقل';
  if (m.includes('both_servants')) return 'للشخصين حسابا خادم — احذف أحدهما من إدارة الخدام أولاً ثم ادمج';
  if (m.includes('both_priests')) return 'للشخصين حسابا كاهن — احذف أحدهما من الكهنة أولاً ثم ادمج';
  if (m.includes('two_persons_required')) return 'اختر شخصين مختلفين';
  if (m.includes('person_not_found')) return 'لم يعد أحد الشخصين موجودًا — حدّث الصفحة';
  if (m.includes('already_registered')) return 'لهذا الشخص حساب من هذا النوع بالفعل';
  if (m.includes('weak_password')) return 'كلمة المرور 6 أحرف على الأقل';
  if (m.includes('invalid_code')) return 'الكود المختار يجب أن يكون كود أحد الشخصين';
  return fallback;
}
