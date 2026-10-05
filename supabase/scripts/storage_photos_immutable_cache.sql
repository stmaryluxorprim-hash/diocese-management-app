-- =====================================================================
-- Make EXISTING photos cacheable for a year (20261011120000)
--
-- New uploads already carry `Cache-Control: max-age=31536000` (src/lib/
-- upload.ts). Files uploaded before that kept the Supabase default
-- (`max-age=3600`), so every phone re-downloads every child photo every
-- hour — one Storage + one API-gateway log line per photo per device on the
-- «Logs Ingest» meter. Every object path contains a timestamp and is never
-- overwritten, so the long cache is safe.
--
-- Supabase Storage reads the header from `storage.objects.metadata->>
-- 'cacheControl'`. Run ONCE in the SQL editor (postgres role). Idempotent.
-- Cloudflare / browsers pick the new value up as their cached copies expire
-- (≤ 1 hour).
-- =====================================================================
update storage.objects
   set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('cacheControl', 'max-age=31536000')
 where bucket_id in ('photos', 'church-logos')
   and coalesce(metadata->>'cacheControl', '') <> 'max-age=31536000';

select bucket_id, count(*) as objects,
       count(*) filter (where metadata->>'cacheControl' = 'max-age=31536000') as immutable
  from storage.objects
 where bucket_id in ('photos', 'church-logos')
 group by bucket_id;
