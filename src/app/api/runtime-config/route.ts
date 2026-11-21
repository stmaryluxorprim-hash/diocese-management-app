import { supabaseAnonKey, supabaseUrl } from '@/lib/supabase/env';

// Serves the public Supabase settings to the browser at RUNTIME as a tiny
// classic script (loaded synchronously from <head> in the root layout), so the
// values can live in non-NEXT_PUBLIC runtime variables/secrets and be changed
// without rebuilding the app.
export const dynamic = 'force-dynamic';

export async function GET() {
  const url = supabaseUrl();
  const anonKey = supabaseAnonKey();
  const payload = url && anonKey ? JSON.stringify({ url, anonKey }).replace(/</g, '\\u003c') : 'null';
  const body =
    `window.__SUPABASE_ENV__=${payload};` +
    `try{if(window.__SUPABASE_ENV__)localStorage.setItem('dma:supabase-env',JSON.stringify(window.__SUPABASE_ENV__))}catch(e){}`;
  return new Response(body, {
    headers: {
      'content-type': 'application/javascript; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
