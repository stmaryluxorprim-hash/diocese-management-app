'use client';

// ---------- Library module (المكتبة) — client data layer ----------
// Subjects → books (PDF links) + lectures (video / voice links). Everything
// is a URL — nothing is uploaded. CRUD goes straight to the tables (RLS
// scoped + module gated, migration 0039); favorites are per servant rows;
// the child portal reads through anon RPCs.

import type { SupabaseClient } from '@supabase/supabase-js';

// ---------- Types (mirror of migration 0039) ----------
export type Audience = 'everyone' | 'servants' | 'service' | 'class';
export type LectureKind = 'video' | 'voice';

export interface AudienceFields {
  audience: Audience;
  church_id: string | null;
  service_id: string | null;
  class_id: string | null;
}

interface Meta {
  id: string;
  /** rows sharing a group_id are ONE book / lecture covering several classes */
  group_id?: string | null;
  sort_order: number;
  created_at: string;
  created_by: string | null;
  edited_at: string;
  edited_by: string | null;
}

export interface LibrarySubject extends AudienceFields, Meta {
  name: string;
  description: string | null;
  image_url: string | null;
}

export interface LibraryBook extends AudienceFields, Meta {
  subject_id: string;
  title: string;
  author: string | null;
  description: string | null;
  cover_url: string | null;
  pdf_url: string;
}

export interface LibraryLecture extends AudienceFields, Meta {
  subject_id: string;
  title: string;
  speaker: string | null;
  description: string | null;
  lecture_date: string | null;
  kind: LectureKind;
  media_url: string;
  thumbnail_url: string | null;
}

export interface LibraryFavorite {
  id: string;
  user_id: string | null;
  person_id: string | null;
  book_id: string | null;
  lecture_id: string | null;
  created_at: string;
}

export interface LibraryPermissions { view: boolean; manage: boolean }
export const NO_LIBRARY_PERMISSIONS: LibraryPermissions = { view: false, manage: false };

export interface LibraryData {
  subjects: LibrarySubject[];
  books: LibraryBook[];
  lectures: LibraryLecture[];
  favorites: LibraryFavorite[];
}

// ---------- Labels ----------
export const AUDIENCE_LABELS: Record<Audience, string> = {
  everyone: 'الجميع',
  servants: 'الخدام فقط',
  service: 'خدمة محددة',
  class: 'فصل محدد',
};
export const KIND_LABELS: Record<LectureKind, string> = { video: 'فيديو', voice: 'صوت' };

export function audienceLabel(
  x: AudienceFields,
  lookups: { services?: { id: string; name: string }[]; classes?: { id: string; name: string }[] } = {}
): string {
  if (x.audience === 'service') return `خدمة: ${lookups.services?.find((s) => s.id === x.service_id)?.name ?? '—'}`;
  if (x.audience === 'class') {
    const ids = (x as { class_ids?: string[] }).class_ids;
    if (ids && ids.length > 1) return `فصول: ${ids.map((id) => lookups.classes?.find((c) => c.id === id)?.name ?? '—').join('، ')}`;
    return `فصل: ${lookups.classes?.find((c) => c.id === x.class_id)?.name ?? '—'}`;
  }
  return AUDIENCE_LABELS[x.audience];
}

// ---------- Link helpers (Google Drive · YouTube · direct) ----------
export type LinkProvider = 'youtube' | 'drive' | 'pdf' | 'audio' | 'video' | 'other';

export function detectProvider(url: string): LinkProvider {
  const u = url.trim().toLowerCase();
  if (/(^|\/|\.)youtube\.com|youtu\.be/.test(u)) return 'youtube';
  if (/drive\.google\.com|docs\.google\.com/.test(u)) return 'drive';
  if (/\.pdf(\?|#|$)/.test(u)) return 'pdf';
  if (/\.(mp3|m4a|wav|ogg|aac|flac)(\?|#|$)/.test(u)) return 'audio';
  if (/\.(mp4|webm|mov|m4v)(\?|#|$)/.test(u)) return 'video';
  return 'other';
}

export const PROVIDER_LABELS: Record<LinkProvider, string> = {
  youtube: 'YouTube', drive: 'Google Drive', pdf: 'PDF', audio: 'ملف صوتي', video: 'ملف فيديو', other: 'رابط',
};

/** YouTube video id (watch?v= · youtu.be/ · shorts/ · embed/ · live/) */
export function youtubeId(url: string): string | null {
  try {
    const u = new URL(url.trim());
    const host = u.hostname.replace(/^(www|m)\./, '');
    if (host === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null;
    if (/youtube\.com$/.test(host)) {
      const v = u.searchParams.get('v');
      if (v) return v;
      const m = u.pathname.match(/\/(shorts|embed|live|v)\/([^/?#]+)/);
      if (m) return m[2];
    }
  } catch { /* not a url */ }
  return null;
}

/** Google Drive file id (…/file/d/ID/… · ?id=ID) */
export function driveId(url: string): string | null {
  try {
    const u = new URL(url.trim());
    if (!/google\.com$/.test(u.hostname)) return null;
    const m = u.pathname.match(/\/d\/([^/?#]+)/);
    if (m) return m[1];
    return u.searchParams.get('id');
  } catch { return null; }
}

/** Embeddable player URL (iframe) when we know how; else null → open link. */
export function embedUrl(url: string): string | null {
  const yt = youtubeId(url);
  if (yt) return `https://www.youtube.com/embed/${yt}`;
  const dr = driveId(url);
  if (dr) return `https://drive.google.com/file/d/${dr}/preview`;
  return null;
}

/** Automatic thumbnail for a YouTube / Drive link (when none is given). */
export function autoThumbnail(url: string): string | null {
  const yt = youtubeId(url);
  if (yt) return `https://img.youtube.com/vi/${yt}/hqdefault.jpg`;
  const dr = driveId(url);
  if (dr) return `https://drive.google.com/thumbnail?id=${dr}&sz=w640`;
  return null;
}

export function isValidUrl(s: string): boolean {
  try {
    const u = new URL(s.trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch { return false; }
}

// ---------- Error mapping ----------
export const MIGRATION_HINT = 'تحتاج تشغيل تحديث قاعدة البيانات 0039_library.sql في Supabase أولاً';

export function isMigrationMissing(err: unknown): boolean {
  const msg = (err as { message?: string } | null)?.message ?? '';
  return /library_/.test(msg) && /does not exist|not find|schema cache|relation/i.test(msg);
}

export function libraryErrorMessage(err: unknown, fallback = 'حدث خطأ، حاول مجدداً'): string {
  const msg = (err as { message?: string } | null)?.message ?? '';
  if (!msg) return fallback;
  if (isMigrationMissing(err)) return MIGRATION_HINT;
  if (/row-level security|permission denied|forbidden/i.test(msg)) return 'ليس لديك صلاحية على هذه العملية';
  if (/service does not belong|class does not belong/i.test(msg)) return 'الخدمة أو الفصل لا يتبعان الكنيسة المختارة';
  if (/audience_scope/.test(msg)) return 'حدّد الخدمة / الفصل لهذا الجمهور';
  if (/not_blank/.test(msg)) return 'الاسم والرابط مطلوبان';
  if (/unique|duplicate/i.test(msg)) return 'موجود بالفعل';
  return fallback;
}

// ---------- Permissions ----------
export async function fetchLibraryPermissions(supabase: SupabaseClient): Promise<LibraryPermissions> {
  const { data, error } = await supabase.rpc('library_permissions');
  if (error || !data) return NO_LIBRARY_PERMISSIONS;
  return data as LibraryPermissions;
}

// ---------- Load everything (RLS trims to what the caller may see) ----------
export async function fetchLibrary(supabase: SupabaseClient): Promise<LibraryData> {
  const [s, b, l, f] = await Promise.all([
    supabase.from('library_subjects').select('*').order('sort_order').order('name'),
    supabase.from('library_books').select('*').order('sort_order').order('title'),
    supabase.from('library_lectures').select('*').order('sort_order').order('lecture_date', { ascending: false, nullsFirst: false }).order('title'),
    supabase.from('library_favorites').select('*'),
  ]);
  const err = s.error ?? b.error ?? l.error ?? f.error;
  if (err) throw err;
  return {
    subjects: (s.data ?? []) as LibrarySubject[],
    books: (b.data ?? []) as LibraryBook[],
    lectures: (l.data ?? []) as LibraryLecture[],
    favorites: (f.data ?? []) as LibraryFavorite[],
  };
}

// ---------- CRUD ----------
export type SubjectInput = Omit<LibrarySubject, keyof Meta>;
export type BookInput = Omit<LibraryBook, keyof Meta>;
export type LectureInput = Omit<LibraryLecture, keyof Meta>;

async function saveRow<T>(supabase: SupabaseClient, table: string, id: string | null, payload: object, groupId?: string | null): Promise<T> {
  const body = groupId === undefined ? payload : { ...payload, group_id: groupId };
  const res = id
    ? await supabase.from(table).update(body).eq('id', id).select('*').single()
    : await supabase.from(table).insert(body).select('*').single();
  if (res.error) throw res.error;
  return res.data as T;
}

async function deleteRow(supabase: SupabaseClient, table: string, id: string): Promise<void> {
  const { error, count } = await supabase.from(table).delete({ count: 'exact' }).eq('id', id);
  if (error) throw error;
  if (count === 0) throw new Error('forbidden');
}

export const saveSubject = (s: SupabaseClient, id: string | null, p: SubjectInput) => saveRow<LibrarySubject>(s, 'library_subjects', id, p);
export const deleteSubject = (s: SupabaseClient, id: string) => deleteRow(s, 'library_subjects', id);
export const saveBook = (s: SupabaseClient, id: string | null, p: BookInput, groupId?: string | null) => saveRow<LibraryBook>(s, 'library_books', id, p, groupId);
export const deleteBook = (s: SupabaseClient, id: string) => deleteRow(s, 'library_books', id);
export const saveLecture = (s: SupabaseClient, id: string | null, p: LectureInput, groupId?: string | null) => saveRow<LibraryLecture>(s, 'library_lectures', id, p, groupId);
export const deleteLecture = (s: SupabaseClient, id: string) => deleteRow(s, 'library_lectures', id);

// ---------- Favorites (servant) ----------
export async function setFavorite(
  supabase: SupabaseClient, userId: string, item: { book_id?: string; lecture_id?: string }, on: boolean
): Promise<void> {
  if (on) {
    const { error } = await supabase.from('library_favorites').insert({
      user_id: userId, book_id: item.book_id ?? null, lecture_id: item.lecture_id ?? null,
    });
    if (error && !/unique|duplicate/i.test(error.message)) throw error;
  } else {
    let q = supabase.from('library_favorites').delete().eq('user_id', userId);
    q = item.book_id ? q.eq('book_id', item.book_id) : q.eq('lecture_id', item.lecture_id!);
    const { error } = await q;
    if (error) throw error;
  }
}

/** Set of favorite keys: `book:<id>` / `lecture:<id>` */
export function favoriteKeys(favs: { book_id: string | null; lecture_id: string | null }[]): Set<string> {
  const out = new Set<string>();
  favs.forEach((f) => { if (f.book_id) out.add(`book:${f.book_id}`); if (f.lecture_id) out.add(`lecture:${f.lecture_id}`); });
  return out;
}

// ---------- Search (subjects · books · lectures · authors · speakers) ----------
const norm = (s: string | null | undefined) =>
  (s ?? '').toLowerCase()
    .replace(/[\u064B-\u0652\u0640]/g, '')          // tashkeel + tatweel
    .replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه');

export function matches(q: string, ...fields: (string | null | undefined)[]): boolean {
  const n = norm(q).trim();
  if (!n) return true;
  return fields.some((f) => norm(f).includes(n));
}

export interface SearchResults<S, B, L> { subjects: S[]; books: B[]; lectures: L[] }

export function searchLibrary<
  S extends { name: string; description: string | null },
  B extends { title: string; author: string | null; description: string | null },
  L extends { title: string; speaker: string | null; description: string | null },
>(data: { subjects: S[]; books: B[]; lectures: L[] }, q: string): SearchResults<S, B, L> {
  return {
    subjects: data.subjects.filter((s) => matches(q, s.name, s.description)),
    books: data.books.filter((b) => matches(q, b.title, b.author, b.description)),
    lectures: data.lectures.filter((l) => matches(q, l.title, l.speaker, l.description)),
  };
}

// ---------- Child portal (anon, token = national id) ----------
export interface ChildLibrarySubject {
  id: string; name: string; description: string | null; image_url: string | null; sort_order: number;
}
export interface ChildLibraryBook {
  id: string; subject_id: string; title: string; author: string | null; description: string | null;
  cover_url: string | null; pdf_url: string; sort_order: number; created_at: string;
}
export interface ChildLibraryLecture {
  id: string; subject_id: string; title: string; speaker: string | null; description: string | null;
  lecture_date: string | null; kind: LectureKind; media_url: string; thumbnail_url: string | null;
  sort_order: number; created_at: string;
}
export interface ChildLibrary {
  subjects: ChildLibrarySubject[];
  books: ChildLibraryBook[];
  lectures: ChildLibraryLecture[];
  favorites: { book_id: string | null; lecture_id: string | null }[];
}

export async function fetchChildLibrary(supabase: SupabaseClient, token: string): Promise<ChildLibrary> {
  const { data, error } = await supabase.rpc('child_portal_library', { p_national_id: token });
  if (error) throw error;
  const d = (data ?? {}) as Partial<ChildLibrary>;
  return { subjects: d.subjects ?? [], books: d.books ?? [], lectures: d.lectures ?? [], favorites: d.favorites ?? [] };
}

export async function setChildFavorite(
  supabase: SupabaseClient, token: string, item: { book_id?: string; lecture_id?: string }, on: boolean
): Promise<void> {
  const { error } = await supabase.rpc('child_portal_library_favorite', {
    p_national_id: token, p_book: item.book_id ?? null, p_lecture: item.lecture_id ?? null, p_on: on,
  });
  if (error) throw error;
}

export function fmtLectureDate(iso: string | null): string {
  if (!iso) return '';
  try {
    return new Date(`${iso}T00:00:00`).toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch { return iso; }
}
