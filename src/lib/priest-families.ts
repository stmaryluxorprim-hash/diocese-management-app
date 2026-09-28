'use client';

// ---------- Priest portal — الافتقاد الأسري (migration 20260928120000) ----------
// المناطق → الشوارع → العمارات → العائلات → الأفراد + الزيارات.
// Every call receives the priest session token (see priest-portal.ts) — or
// the CHILD token for the child-portal functions at the bottom.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Gender } from '@/lib/types';
import type { PriestPerson, PriestPlace } from '@/lib/priest-portal';
import type { FamilyRelation } from '@/lib/families';

// ---------- Types ----------
export type LocationSource = 'family' | 'building' | 'street' | 'area';
export interface GeoLocation {
  lat: number | null;
  lng: number | null;
  maps_url: string | null;
  note: string | null;
  source: LocationSource;
}
/** the editable location fields shared by area · street · building · family */
export interface LocationInput { lat: number | null; lng: number | null; maps_url: string | null; location_note: string | null }

export interface PriestShort {
  id: string; name: string; title: string | null; phone: string | null; image_url: string | null; church_id: string; status: string;
}

export interface Building {
  id: string; street_id: string; name: string; number: string | null; floors_count: number | null;
  lat: number | null; lng: number | null; maps_url: string | null; location_note: string | null;
  location: GeoLocation | null; created_at: string; families_count: number;
}
export interface Street {
  id: string; area_id: string; name: string;
  lat: number | null; lng: number | null; maps_url: string | null; location_note: string | null;
  location: GeoLocation | null; created_at: string; families_count: number; buildings: Building[];
}
export interface Area {
  id: string; church_id: string; name: string; description: string | null;
  lat: number | null; lng: number | null; maps_url: string | null; location_note: string | null;
  location: GeoLocation | null; created_by_priest: string | null; created_at: string;
  is_mine: boolean; priest_ids: string[]; priests: PriestShort[]; families_count: number; streets: Street[];
}
export interface AreasTree { areas: Area[]; church_priests: PriestShort[]; server_today: string }

export interface FamilyMemberRow {
  id: string; family_id: string; person_id: string; relation: FamilyRelation | null; created_at: string;
  person: PriestPerson; places: PriestPlace[];
}

export type VisitStatus = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'done';
export const VISIT_STATUS_LABELS: Record<VisitStatus, string> = {
  pending: 'طلب بانتظار الموافقة', approved: 'مرتَّبة', rejected: 'مرفوضة', cancelled: 'ملغاة', done: 'تمّت',
};

export interface VisitFamilyBrief {
  id: string; code: string; name: string; phone: string | null; address: string | null;
  area_id: string | null; street_id: string | null; building_id: string | null; floor: string | null; apartment: string | null;
  area_name: string | null; street_name: string | null; building_name: string | null;
  location: GeoLocation | null; members_count: number;
}
export interface Visit {
  id: string; family_id: string; priest_id: string; priest: PriestShort | null;
  requested_by: 'priest' | 'family'; requested_by_person: { id: string; name: string } | null;
  requested_on: string | null; requested_time: string | null; note: string | null;
  status: VisitStatus; scheduled_on: string | null; scheduled_time: string | null; visited_on: string | null;
  on: string; time: string | null; decision_note: string | null; visit_note: string | null; decided_at: string | null; created_at: string;
  family: VisitFamilyBrief;
}

export interface PriestFamily {
  id: string; code: string; name: string; phone: string | null; address: string | null; notes: string | null;
  church_id: string | null; area_id: string | null; street_id: string | null; building_id: string | null;
  floor: string | null; apartment: string | null;
  lat: number | null; lng: number | null; maps_url: string | null; location_note: string | null;
  created_at: string; edited_at: string; created_by_priest: string | null;
  area_name: string | null; street_name: string | null; building_name: string | null;
  location: GeoLocation | null;
  members: FamilyMemberRow[]; members_count: number;
  last_visit: string | null; visits_count: number; days_since_visit: number | null;
  next_visit: { id: string; status: VisitStatus; on: string; time: string | null; requested_by: 'priest' | 'family'; priest_id: string } | null;
  pending_requests: number;
  area_priests: PriestShort[];
}
export interface PriestFamilyDetail extends PriestFamily { visits: Visit[] }

export interface FamilyCodeLookup { code: string; free: boolean; family: { id: string; name: string } | null; person: { id: string; name: string } | null }
export interface FamilyPersonHit { person: PriestPerson; places: PriestPlace[]; family: { id: string; name: string } | null }
export type FamilyLookupResult =
  | { found: 'person'; person: PriestPerson; places: PriestPlace[]; family: { id: string; name: string; visible: boolean } | null }
  | { found: 'family'; family: PriestFamily }
  | { found: null; code: string };

// ---------- Errors (extend the priest ones) ----------
export const FAMILY_ERRORS: Record<string, string> = {
  area_not_found: 'المنطقة غير موجودة',
  street_not_found: 'الشارع غير موجود',
  building_not_found: 'العمارة غير موجودة',
  area_church_mismatch: 'المنطقة من كنيسة أخرى',
  invalid_location: 'الموقع غير صالح — أدخل خط العرض وخط الطول معًا',
  priest_other_church: 'لا يمكن ربط كاهن من كنيسة أخرى',
  family_not_found: 'العائلة غير موجودة',
  no_access: 'هذه العائلة خارج كنيستك',
  code_is_person: 'هذا الكود لشخص — كود العائلة يجب أن يكون مختلفًا',
  code_is_family: 'هذا الكود كود عائلة — لا يمكن استخدامه لشخص',
  code_taken: 'هذا الكود مستخدم بالفعل',
  in_other_family: 'هذا الشخص في عائلة أخرى',
  already_member: 'هذا الشخص في العائلة بالفعل',
  invalid_relation: 'صلة القرابة غير صالحة',
  no_family: 'لست مسجَّلًا في عائلة بعد — اطلب من الكاهن إضافتك',
  pending_exists: 'يوجد طلب زيارة بانتظار الرد بالفعل',
  past_date: 'اختر تاريخًا من اليوم فصاعدًا',
  future_date: 'لا يمكن تسجيل زيارة بتاريخ مستقبلي — استخدم «ترتيب زيارة»',
};
export function familyErrorMessage(err: unknown, fallback = 'حدث خطأ، حاول مجدداً'): string {
  const msg = (err as { message?: string } | null)?.message ?? '';
  for (const k of Object.keys(FAMILY_ERRORS)) if (msg.includes(k)) return FAMILY_ERRORS[k];
  return fallback;
}
/** `in_other_family` carries the other family's name in DETAIL and its id in HINT */
export function otherFamilyOf(err: unknown): { id: string | null; name: string } | null {
  const e = err as { message?: string; details?: string; hint?: string } | null;
  if (!e?.message?.includes('in_other_family')) return null;
  return { id: e.hint ?? null, name: e.details ?? '' };
}

// ---------- Areas · streets · buildings ----------
export async function fetchAreasTree(supabase: SupabaseClient, token: string): Promise<AreasTree> {
  const { data, error } = await supabase.rpc('priest_areas_tree', { p_token: token });
  if (error) throw error;
  return data as AreasTree;
}
export interface AreaInput extends LocationInput { id: string | null; name: string; description: string | null; priest_ids: string[] | null }
export async function saveArea(supabase: SupabaseClient, token: string, i: AreaInput) {
  const { data, error } = await supabase.rpc('priest_area_save', {
    p_token: token, p_id: i.id, p_name: i.name, p_description: i.description, p_lat: i.lat, p_lng: i.lng,
    p_maps_url: i.maps_url, p_location_note: i.location_note, p_priest_ids: i.priest_ids,
  });
  if (error) throw error;
  return data as { id: string; name: string };
}
export async function setAreaPriests(supabase: SupabaseClient, token: string, areaId: string, priestIds: string[]) {
  const { data, error } = await supabase.rpc('priest_area_set_priests', { p_token: token, p_area: areaId, p_priest_ids: priestIds });
  if (error) throw error;
  return data as string[];
}
export async function deleteArea(supabase: SupabaseClient, token: string, id: string) {
  const { error } = await supabase.rpc('priest_area_delete', { p_token: token, p_id: id });
  if (error) throw error;
}
export interface StreetInput extends LocationInput { id: string | null; area_id: string; name: string }
export async function saveStreet(supabase: SupabaseClient, token: string, i: StreetInput) {
  const { data, error } = await supabase.rpc('priest_street_save', {
    p_token: token, p_id: i.id, p_area: i.area_id, p_name: i.name, p_lat: i.lat, p_lng: i.lng, p_maps_url: i.maps_url, p_location_note: i.location_note,
  });
  if (error) throw error;
  return data as { id: string; name: string; area_id: string };
}
export async function deleteStreet(supabase: SupabaseClient, token: string, id: string) {
  const { error } = await supabase.rpc('priest_street_delete', { p_token: token, p_id: id });
  if (error) throw error;
}
export interface BuildingInput extends LocationInput { id: string | null; street_id: string; name: string; number: string | null; floors_count: number | null }
export async function saveBuilding(supabase: SupabaseClient, token: string, i: BuildingInput) {
  const { data, error } = await supabase.rpc('priest_building_save', {
    p_token: token, p_id: i.id, p_street: i.street_id, p_name: i.name, p_number: i.number, p_floors: i.floors_count,
    p_lat: i.lat, p_lng: i.lng, p_maps_url: i.maps_url, p_location_note: i.location_note,
  });
  if (error) throw error;
  return data as { id: string; name: string; street_id: string };
}
export async function deleteBuilding(supabase: SupabaseClient, token: string, id: string) {
  const { error } = await supabase.rpc('priest_building_delete', { p_token: token, p_id: id });
  if (error) throw error;
}

// ---------- Families ----------
export async function fetchPriestFamilies(supabase: SupabaseClient, token: string): Promise<PriestFamily[]> {
  const { data, error } = await supabase.rpc('priest_families_list', { p_token: token });
  if (error) throw error;
  return (data ?? []) as PriestFamily[];
}
export async function fetchPriestFamily(supabase: SupabaseClient, token: string, id: string): Promise<PriestFamilyDetail> {
  const { data, error } = await supabase.rpc('priest_family_detail', { p_token: token, p_family: id });
  if (error) throw error;
  return data as PriestFamilyDetail;
}
export async function priestFamilyCodeLookup(supabase: SupabaseClient, token: string, code: string): Promise<FamilyCodeLookup> {
  const { data, error } = await supabase.rpc('priest_family_code_lookup', { p_token: token, p_code: code });
  if (error) throw error;
  return data as FamilyCodeLookup;
}
export interface FamilyInput extends LocationInput {
  id: string | null; name: string; code: string | null; phone: string | null; address: string | null; notes: string | null;
  area_id: string | null; street_id: string | null; building_id: string | null; floor: string | null; apartment: string | null;
}
export async function savePriestFamily(supabase: SupabaseClient, token: string, i: FamilyInput): Promise<PriestFamily> {
  const { data, error } = await supabase.rpc('priest_family_save', {
    p_token: token, p_id: i.id, p_name: i.name, p_code: i.code, p_phone: i.phone, p_address: i.address, p_notes: i.notes,
    p_area: i.area_id, p_street: i.street_id, p_building: i.building_id, p_floor: i.floor, p_apartment: i.apartment,
    p_lat: i.lat, p_lng: i.lng, p_maps_url: i.maps_url, p_location_note: i.location_note,
  });
  if (error) throw error;
  return data as PriestFamily;
}
export async function deletePriestFamily(supabase: SupabaseClient, token: string, id: string) {
  const { error } = await supabase.rpc('priest_family_delete', { p_token: token, p_family: id });
  if (error) throw error;
}

// ---------- Members ----------
export async function priestFamilyAddMember(supabase: SupabaseClient, token: string, familyId: string, personId: string, relation: string | null, move = false) {
  const { data, error } = await supabase.rpc('priest_family_add_member', { p_token: token, p_family: familyId, p_person: personId, p_relation: relation, p_move: move });
  if (error) throw error;
  return data as FamilyMemberRow & { moved_from: { id: string; name: string } | null };
}
export async function priestFamilyAddMemberByCode(supabase: SupabaseClient, token: string, familyId: string, code: string, relation: string | null, move = false) {
  const { data, error } = await supabase.rpc('priest_family_add_member_by_code', { p_token: token, p_family: familyId, p_code: code.trim(), p_relation: relation, p_move: move });
  if (error) throw error;
  return data as FamilyMemberRow & { moved_from: { id: string; name: string } | null };
}
export interface NewFamilyMemberInput {
  name: string; code: string | null; gender: Gender | null; birthdate: string | null; phone: string | null;
  address: string | null; notes: string | null; image_url: string | null; relation: string | null; move?: boolean;
}
export async function priestFamilyAddNewMember(supabase: SupabaseClient, token: string, familyId: string, i: NewFamilyMemberInput) {
  const { data, error } = await supabase.rpc('priest_family_add_new_member', {
    p_token: token, p_family: familyId, p_name: i.name.trim(), p_code: i.code, p_gender: i.gender, p_birthdate: i.birthdate, p_phone: i.phone,
    p_address: i.address, p_notes: i.notes, p_image_url: i.image_url, p_relation: i.relation, p_move: !!i.move,
  });
  if (error) throw error;
  return data as FamilyMemberRow & { moved_from: { id: string; name: string } | null; person_created: boolean };
}
export async function priestFamilySetRelation(supabase: SupabaseClient, token: string, memberId: string, relation: string | null) {
  const { error } = await supabase.rpc('priest_family_set_relation', { p_token: token, p_member: memberId, p_relation: relation });
  if (error) throw error;
}
export async function priestFamilyRemoveMember(supabase: SupabaseClient, token: string, memberId: string) {
  const { error } = await supabase.rpc('priest_family_remove_member', { p_token: token, p_member: memberId });
  if (error) throw error;
}
export async function priestFamilySearchPersons(supabase: SupabaseClient, token: string, q: string, limit = 30): Promise<FamilyPersonHit[]> {
  const { data, error } = await supabase.rpc('priest_family_search_persons', { p_token: token, p_query: q, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as FamilyPersonHit[];
}
export async function priestFamilyLookupCode(supabase: SupabaseClient, token: string, code: string): Promise<FamilyLookupResult> {
  const { data, error } = await supabase.rpc('priest_family_lookup_code', { p_token: token, p_code: code.trim() });
  if (error) throw error;
  return data as FamilyLookupResult;
}

// ---------- Visits ----------
export async function fetchVisits(supabase: SupabaseClient, token: string, opts: { from?: string | null; to?: string | null; includePast?: boolean } = {}): Promise<Visit[]> {
  const { data, error } = await supabase.rpc('priest_visits_list', { p_token: token, p_from: opts.from ?? null, p_to: opts.to ?? null, p_include_past: !!opts.includePast });
  if (error) throw error;
  return (data ?? []) as Visit[];
}
/** `done = true` records a visit that already happened (on ≤ today); otherwise schedules one */
export async function createVisit(supabase: SupabaseClient, token: string, familyId: string, on: string, opts: { time?: string | null; note?: string | null; done?: boolean; visitNote?: string | null } = {}): Promise<Visit> {
  const { data, error } = await supabase.rpc('priest_visit_create', {
    p_token: token, p_family: familyId, p_on: on, p_time: opts.time ?? null, p_note: opts.note ?? null, p_done: !!opts.done, p_visit_note: opts.visitNote ?? null,
  });
  if (error) throw error;
  return data as Visit;
}
export type VisitAction = 'approve' | 'reject' | 'cancel' | 'done';
export async function decideVisit(supabase: SupabaseClient, token: string, id: string, action: VisitAction, opts: { on?: string | null; time?: string | null; note?: string | null } = {}): Promise<Visit> {
  const { data, error } = await supabase.rpc('priest_visit_decide', { p_token: token, p_visit: id, p_action: action, p_on: opts.on ?? null, p_time: opts.time ?? null, p_note: opts.note ?? null });
  if (error) throw error;
  return data as Visit;
}
export async function deleteVisit(supabase: SupabaseClient, token: string, id: string) {
  const { error } = await supabase.rpc('priest_visit_delete', { p_token: token, p_visit: id });
  if (error) throw error;
}

// ---------- Child portal — عائلتي ----------
export interface ChildFamily {
  family: PriestFamily | null;
  me: { id: string; name: string };
  priests: PriestShort[];
  /** true when no priest is connected to the family's area → the priests of the church are shown */
  priests_fallback: boolean;
  visits: Visit[];
  server_today: string;
}
export async function fetchChildFamily(supabase: SupabaseClient, token: string): Promise<ChildFamily> {
  const { data, error } = await supabase.rpc('child_portal_family', { p_token: token });
  if (error) throw error;
  return data as ChildFamily;
}
export async function childRequestVisit(supabase: SupabaseClient, token: string, priestId: string, on: string, time?: string | null, note?: string | null): Promise<Visit> {
  const { data, error } = await supabase.rpc('child_request_visit', { p_token: token, p_priest: priestId, p_on: on, p_time: time ?? null, p_note: note ?? null });
  if (error) throw error;
  return data as Visit;
}
export async function childCancelVisit(supabase: SupabaseClient, token: string, id: string) {
  const { error } = await supabase.rpc('child_cancel_visit', { p_token: token, p_visit: id });
  if (error) throw error;
}

// ---------- Directions helpers ----------
/** Google Maps navigation link for a location (coordinates first, else the saved link). */
export function directionsUrl(loc: GeoLocation | null | undefined): string | null {
  if (!loc) return null;
  if (loc.lat != null && loc.lng != null) return `https://www.google.com/maps/dir/?api=1&destination=${loc.lat},${loc.lng}&travelmode=driving`;
  return loc.maps_url ?? null;
}
/** Plain «show on map» link. */
export function mapUrl(loc: GeoLocation | null | undefined): string | null {
  if (!loc) return null;
  if (loc.lat != null && loc.lng != null) return `https://www.google.com/maps/search/?api=1&query=${loc.lat},${loc.lng}`;
  return loc.maps_url ?? null;
}
export const LOCATION_SOURCE_LABELS: Record<LocationSource, string> = { family: 'موقع العائلة', building: 'موقع العمارة', street: 'موقع الشارع', area: 'موقع المنطقة' };

/** Try to pull lat/lng out of a pasted Google Maps link (…@lat,lng… or q=lat,lng or !3dLAT!4dLNG). */
export function parseLatLng(text: string): { lat: number; lng: number } | null {
  const t = text.trim();
  const m = t.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/) || t.match(/[?&](?:q|query|destination|ll)=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/)
    || t.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/) || t.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (!m) return null;
  const lat = Number(m[1]); const lng = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

/** «منطقة · شارع · عمارة · دور · شقة» line for a family */
export function placeLine(f: { area_name: string | null; street_name: string | null; building_name: string | null; floor?: string | null; apartment?: string | null }): string {
  const parts = [f.area_name, f.street_name, f.building_name ? `عمارة ${f.building_name}` : null, f.floor ? `دور ${f.floor}` : null, f.apartment ? `شقة ${f.apartment}` : null].filter(Boolean);
  return parts.join(' · ');
}
export const visitDaysLabel = (n: number | null) => (n == null ? 'لم تُزَر بعد' : n === 0 ? 'زيارة اليوم' : n === 1 ? 'منذ يوم' : n === 2 ? 'منذ يومين' : n <= 10 ? `منذ ${n} أيام` : `منذ ${n} يومًا`);
