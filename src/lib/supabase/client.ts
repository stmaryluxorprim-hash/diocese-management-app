'use client';

import { createBrowserClient } from '@supabase/ssr';
import { supabaseAnonKey, supabaseUrl } from './env';

declare global {
  interface Window {
    __SUPABASE_ENV__?: { url: string; anonKey: string } | null;
  }
}

const CACHE_KEY = 'dma:supabase-env';

function browserEnv(): { url: string; anonKey: string } | null {
  // 1) injected at runtime by <script src="/api/runtime-config"> in the root layout
  const injected = window.__SUPABASE_ENV__;
  if (injected?.url && injected?.anonKey) return injected;
  // 2) last known values (offline / PWA start without network)
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (cached?.url && cached?.anonKey) return cached;
  } catch {
    /* ignore */
  }
  // 3) legacy build-time NEXT_PUBLIC_* values (inlined by Next, if present)
  const url = supabaseUrl();
  const anonKey = supabaseAnonKey();
  if (url && anonKey) return { url, anonKey };
  return null;
}

export function createClient() {
  if (typeof window === 'undefined') {
    // SSR / prerender: read the runtime env of the server. During `next build`
    // there may be no variables at all, so fall back to a placeholder instead
    // of failing the build (no request is made while prerendering).
    return createBrowserClient(
      supabaseUrl() || 'https://placeholder.supabase.co',
      supabaseAnonKey() || 'placeholder-anon-key'
    );
  }
  const env = browserEnv();
  if (!env) {
    throw new Error('Supabase is not configured (SUPABASE_URL / SUPABASE_ANON_KEY missing).');
  }
  return createBrowserClient(env.url, env.anonKey);
}
