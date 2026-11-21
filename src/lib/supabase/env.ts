// Supabase connection settings, read at RUNTIME (not baked in at build time).
//
// Preferred variables (can be stored as Cloudflare "Secrets" and edited any
// time without a rebuild):
//   SUPABASE_URL
//   SUPABASE_ANON_KEY
//
// The legacy NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY names are
// still honoured as a fallback so existing deployments keep working.
//
// NOTE: the URL and the anon key are public-by-design (every browser that opens
// the app needs them; RLS is what protects the data). They reach the browser
// through GET /api/runtime-config at runtime. Only SUPABASE_SERVICE_ROLE_KEY
// must never leave the server.

export function supabaseUrl(): string | undefined {
  return (
    process.env.SUPABASE_URL ||
    // eslint-disable-next-line no-restricted-syntax
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    undefined
  );
}

export function supabaseAnonKey(): string | undefined {
  return (
    process.env.SUPABASE_ANON_KEY ||
    // eslint-disable-next-line no-restricted-syntax
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    undefined
  );
}

/** Server-side: both values or throw a clear error. */
export function requireSupabaseEnv(): { url: string; anonKey: string } {
  const url = supabaseUrl();
  const anonKey = supabaseAnonKey();
  if (!url || !anonKey) {
    throw new Error(
      'Supabase is not configured: set SUPABASE_URL and SUPABASE_ANON_KEY (runtime variables/secrets).'
    );
  }
  return { url, anonKey };
}
