import type { SupabaseClient } from '@supabase/supabase-js';
import { PHOTOS_BUCKET } from '@/lib/types';
import { compressImageFile, extensionFor, maxDimFor } from '@/lib/image-compress';

/**
 * Cache-Control for uploaded files (20261011120000).
 *
 * Every object path carries a timestamp, so a file is NEVER overwritten — a
 * new photo is a new URL. That makes the content immutable and the browser
 * / Cloudflare may cache it for a year: the children list, the scanner
 * result card and the printed cards stop re-requesting the same photo on
 * every open. Each photo request was one Storage + one API-gateway line on
 * the Supabase «Logs Ingest» meter; on a scan day photos were 30–50 % of
 * all gateway lines. (Default was `max-age=3600`.)
 */
export const IMMUTABLE_CACHE_SECONDS = String(60 * 60 * 24 * 365);

/**
 * Upload an image to the public `photos` bucket and return its public URL.
 * Path: <folder>/<timestamp>-<sanitized name>
 */
export async function uploadPhoto(
  supabase: SupabaseClient,
  // 'child-requests' is the only folder the anon role may write to
  // (child portal photo proposals — storage policy in migration 0021)
  // 'priests' — the priest portal / signup (anon) may write there too (migration 20260927120000)
  folder: 'servants' | 'services' | 'classes' | 'persons' | 'cards' | 'child-requests' | 'store' | 'exams' | 'messages' | 'child-messages' | 'achievements' | 'occasions' | 'notifications' | 'priests',
  file: File | Blob,
  name?: string
): Promise<string> {
  // ONE compression choke-point for every photo upload (≈ 30 call sites):
  // downscale to the folder's max size + WebP. Falls back to the original
  // file on any problem, so an upload can never fail because of compression.
  const body = await compressImageFile(file, { maxDim: maxDimFor(folder) });
  const rawName = name ?? (file instanceof File ? file.name : 'photo.webp');
  let safeName = rawName.replace(/[^a-zA-Z0-9.]/g, '_');
  if (body !== file) {
    // keep the extension in line with the re-encoded bytes (png → webp / jpg)
    const ext = extensionFor(body.type);
    if (ext) safeName = safeName.replace(/\.[a-zA-Z0-9]+$/, '') + '.' + ext;
  }
  const path = `${folder}/${Date.now()}-${safeName}`;
  const { error } = await supabase.storage.from(PHOTOS_BUCKET).upload(path, body, {
    contentType: body.type || undefined,
    cacheControl: IMMUTABLE_CACHE_SECONDS,
  });
  if (error) throw error;
  return supabase.storage.from(PHOTOS_BUCKET).getPublicUrl(path).data.publicUrl;
}

/**
 * Upload a church logo to the `church-logos` bucket (compressed, immutable
 * cache) and return its public URL.
 */
export async function uploadChurchLogo(supabase: SupabaseClient, file: File): Promise<string> {
  const body = await compressImageFile(file, { maxDim: 512 });
  let safeName = file.name.replace(/[^a-zA-Z0-9.]/g, '_');
  if (body !== file) {
    const ext = extensionFor(body.type);
    if (ext) safeName = safeName.replace(/\.[a-zA-Z0-9]+$/, '') + '.' + ext;
  }
  const path = `${Date.now()}-${safeName}`;
  const { error } = await supabase.storage.from('church-logos').upload(path, body, {
    contentType: body.type || undefined,
    cacheControl: IMMUTABLE_CACHE_SECONDS,
  });
  if (error) throw error;
  return supabase.storage.from('church-logos').getPublicUrl(path).data.publicUrl;
}
