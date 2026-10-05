'use client';

// ---------- Web Push — device registration (client side) ----------
// Flow: permission → PushManager.subscribe(VAPID public key) → store the
// subscription in push_subscriptions through the RPCs of migration 0034
// (servant: push_subscribe with his session · child: child_push_subscribe
// with the national-id token). The public key comes from
// NEXT_PUBLIC_VAPID_PUBLIC_KEY (or /api/notifications/vapid as a fallback).
//
// iOS: web push works only for the app INSTALLED on the home screen
// (iOS 16.4+). We report that so the UI can show an install hint.

import type { SupabaseClient } from '@supabase/supabase-js';

export type PushSupport =
  | 'ok'                 // can subscribe
  | 'needs_install'      // iOS Safari not installed as PWA
  | 'unsupported'        // no service worker / PushManager / Notification
  | 'denied'             // permission blocked by the user
  | 'insecure';          // not https

export function pushSupport(): PushSupport {
  if (typeof window === 'undefined') return 'unsupported';
  if (!window.isSecureContext) return 'insecure';
  const ua = navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return isIOS && !standalone ? 'needs_install' : 'unsupported';
  }
  if (isIOS && !standalone) return 'needs_install';
  if (Notification.permission === 'denied') return 'denied';
  return 'ok';
}

let cachedKey: string | null | undefined;
async function vapidPublicKey(): Promise<string | null> {
  if (cachedKey !== undefined) return cachedKey;
  const env = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (env) { cachedKey = env; return env; }
  try {
    const r = await fetch('/api/notifications/vapid', { cache: 'no-store' });
    if (r.ok) { const j = (await r.json()) as { publicKey?: string | null }; cachedKey = j.publicKey ?? null; return cachedKey; }
  } catch { /* offline */ }
  cachedKey = null;
  return null;
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function readyRegistration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration();
  if (existing) return existing;
  await navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' });
  return navigator.serviceWorker.ready;
}

/** The current device subscription (or null when the browser has none). */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (pushSupport() !== 'ok' && Notification?.permission !== 'granted') return null;
  try {
    const reg = await readyRegistration();
    return await reg.pushManager.getSubscription();
  } catch { return null; }
}

export interface EnableResult { ok: boolean; reason?: string; subscription?: PushSubscriptionJSON }

/**
 * Ask permission (if needed), subscribe the browser and register the device
 * in the database. `owner` = the signed-in servant or the child token.
 */
export async function enablePush(
  supabase: SupabaseClient,
  owner: { kind: 'servant' } | { kind: 'child'; token: string }
): Promise<EnableResult> {
  const support = pushSupport();
  if (support !== 'ok') return { ok: false, reason: support };
  const key = await vapidPublicKey();
  if (!key) return { ok: false, reason: 'no_vapid' };

  const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (perm !== 'granted') return { ok: false, reason: perm === 'denied' ? 'denied' : 'dismissed' };

  const reg = await readyRegistration();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key) as unknown as BufferSource,
    });
  }
  const json = sub.toJSON();
  const payload = { endpoint: json.endpoint, keys: json.keys, user_agent: navigator.userAgent.slice(0, 300) };
  const { error } = owner.kind === 'servant'
    ? await supabase.rpc('push_subscribe', { p: payload })
    : await supabase.rpc('child_push_subscribe', { p_national_id: owner.token, p: payload });
  if (error) return { ok: false, reason: error.message };
  try { localStorage.setItem('push_registered', '1'); } catch { /* ignore */ }
  return { ok: true, subscription: json };
}

/** Remove this device from the database and unsubscribe the browser. */
export async function disablePush(
  supabase: SupabaseClient,
  owner: { kind: 'servant' } | { kind: 'child'; token: string }
): Promise<void> {
  const sub = await currentSubscription();
  if (sub) {
    const endpoint = sub.endpoint;
    if (owner.kind === 'servant') await supabase.rpc('push_unsubscribe', { p_endpoint: endpoint });
    else await supabase.rpc('child_push_unsubscribe', { p_national_id: owner.token, p_endpoint: endpoint });
    await sub.unsubscribe().catch(() => {});
  }
  try { localStorage.removeItem('push_registered'); } catch { /* ignore */ }
}

/**
 * Silent re-registration on app start: if the browser already has a
 * subscription and permission, make sure the database row still points to
 * the current owner (the subscription upserts by endpoint).
 */
export async function syncPushRegistration(
  supabase: SupabaseClient,
  owner: { kind: 'servant' } | { kind: 'child'; token: string }
): Promise<void> {
  if (typeof window === 'undefined' || Notification?.permission !== 'granted') return;
  const sub = await currentSubscription();
  if (!sub) return;
  const json = sub.toJSON();
  const payload = { endpoint: json.endpoint, keys: json.keys, user_agent: navigator.userAgent.slice(0, 300) };
  try {
    if (owner.kind === 'servant') await supabase.rpc('push_subscribe', { p: payload });
    else await supabase.rpc('child_push_subscribe', { p_national_id: owner.token, p: payload });
  } catch { /* migration missing / offline */ }
}

/** Ask the server to push whatever is pending (fire-and-forget after a send). */
// Client-side throttle: at most one kick per 60 s from this device (the
// server has its own cross-device gate, see notif_dispatch_gate).
let lastKickAt = 0;
export function kickDispatcher(opts: { force?: boolean } = {}): void {
  const now = Date.now();
  if (!opts.force && now - lastKickAt < 60_000) return;
  lastKickAt = now;
  try { fetch('/api/notifications/dispatch', { method: 'POST', keepalive: true }).catch(() => {}); } catch { /* ignore */ }
}

/**
 * Dispatcher kicks from a long-lived screen (header bell).
 *
 * 20261011120000: NO periodic loop any more. Every kick = 2–3 service-role
 * requests (gate · tick · queue) logged by the API gateway, on every open
 * device, all day. pg_cron runs `notif_tick()` every 5 min server-side and
 * every send / approval already calls kickDispatcher({force}) directly, so
 * the browser only kicks ONCE when the app opens (spread over 0–20 s) and
 * once more when the tab comes back after being hidden ≥ 10 min — enough to
 * flush a queue left over from a cold start, nothing more. Returns stop().
 */
export function startDispatcherKicks(): () => void {
  let t: ReturnType<typeof setTimeout> | null = setTimeout(() => { t = null; kickDispatcher(); }, Math.floor(Math.random() * 20_000));
  let hiddenAt = 0;
  const onVis = () => {
    if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
    if (hiddenAt && Date.now() - hiddenAt >= 10 * 60_000) kickDispatcher();
    hiddenAt = 0;
  };
  document.addEventListener('visibilitychange', onVis);
  return () => { if (t) clearTimeout(t); document.removeEventListener('visibilitychange', onVis); };
}

export const PUSH_REASON_LABELS: Record<string, string> = {
  needs_install: 'على الآيفون: أضف التطبيق إلى الشاشة الرئيسية أولاً (زر المشاركة ← إضافة إلى الشاشة الرئيسية) ثم فعّل الإشعارات من داخله',
  unsupported: 'هذا المتصفح لا يدعم إشعارات الجهاز',
  denied: 'الإشعارات محظورة من إعدادات المتصفح — اسمح بها من إعدادات الموقع ثم أعد المحاولة',
  insecure: 'الإشعارات تعمل فقط عبر اتصال آمن (https)',
  no_vapid: 'الخادم غير مهيأ لإشعارات الجهاز (مفتاح VAPID مفقود)',
  dismissed: 'لم يتم منح الإذن',
};
