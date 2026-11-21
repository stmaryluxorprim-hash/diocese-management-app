// ---------- Web Push dispatcher (SERVER ONLY) ----------
// Reads the pending queue through notif_push_queue() (service role), sends
// every payload with the VAPID keys, writes the results back with
// notif_push_mark(). Also runs notif_tick() first so due scheduled sends
// and occasion reminders are materialized before pushing.
//
// Env (server): SUPABASE_SERVICE_ROLE_KEY · VAPID_PUBLIC_KEY ·
// VAPID_PRIVATE_KEY · VAPID_SUBJECT (mailto:… or https://…) ·
// CRON_SECRET (optional — protects GET /api/notifications/dispatch).
// Generate keys once: `npx web-push generate-vapid-keys`.

import { createClient } from '@supabase/supabase-js';
import { appIcon } from '@/lib/branding';
import webpush from 'web-push';
import { supabaseUrl } from '@/lib/supabase/env';

export interface QueueItem {
  recipient_id: string;
  subscription_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  title: string;
  body: string;
  image_url: string | null;
  link_url: string | null;
  is_child: boolean;
  notification_id: string;
}

export interface DispatchResult {
  configured: boolean;
  /** true when another run happened within the gate window and this one did nothing */
  skipped?: boolean;
  tick?: unknown;
  queued: number;
  sent: number;
  failed: number;
  gone: number;
  error?: string;
}

export function vapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY || process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || null;
}

function adminClient() {
  const url = supabaseUrl();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function configureVapid(): boolean {
  const pub = vapidPublicKey();
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@diocese.app', pub, priv);
  return true;
}

/** Run the tick + push the pending queue. Safe to call often (idempotent). */
export async function dispatchPending(limit = 300, opts: { gateSeconds?: number } = {}): Promise<DispatchResult> {
  const supabase = adminClient();
  if (!supabase) return { configured: false, queued: 0, sent: 0, failed: 0, gone: 0, error: 'missing SUPABASE_SERVICE_ROLE_KEY' };

  // 0046 gate: every open app kicks this endpoint; with 80 users that was
  // ~40 runs a minute, each executing notif_tick() + the queue query with
  // the service role. Only ONE run per `gateSeconds` gets through — the
  // rest answer immediately. (Gate missing = migration not applied → run.)
  const gateSeconds = opts.gateSeconds ?? 45;
  if (gateSeconds > 0) {
    const { data: allowed, error: gateErr } = await supabase.rpc('notif_dispatch_gate', { p_min_seconds: gateSeconds });
    if (!gateErr && allowed === false) {
      return { configured: true, skipped: true, queued: 0, sent: 0, failed: 0, gone: 0 };
    }
  }

  let tick: unknown = null;
  try {
    const { data } = await supabase.rpc('notif_tick');
    tick = data;
  } catch { /* migration missing */ }

  if (!configureVapid()) return { configured: false, tick, queued: 0, sent: 0, failed: 0, gone: 0, error: 'missing VAPID keys' };

  const { data, error } = await supabase.rpc('notif_push_queue', { p_limit: limit });
  if (error) return { configured: true, tick, queued: 0, sent: 0, failed: 0, gone: 0, error: error.message };
  const queue = (data as QueueItem[]) ?? [];
  if (queue.length === 0) return { configured: true, tick, queued: 0, sent: 0, failed: 0, gone: 0 };

  const results: { recipient_id: string; subscription_id: string; ok: boolean; gone?: boolean; error?: string }[] = [];
  // limited concurrency — push services throttle
  const CONC = 20;
  for (let i = 0; i < queue.length; i += CONC) {
    const slice = queue.slice(i, i + CONC);
    await Promise.all(slice.map(async (q) => {
      const payload = JSON.stringify({
        title: q.title,
        body: q.body,
        image: q.image_url,
        icon: appIcon(192),
        badge: appIcon(96),
        url: q.link_url || (q.is_child ? '/child/notifications' : '/notifications/inbox'),
        tag: q.notification_id,
        recipient_id: q.recipient_id,
        is_child: q.is_child,
      });
      try {
        await webpush.sendNotification(
          { endpoint: q.endpoint, keys: { p256dh: q.p256dh, auth: q.auth } },
          payload,
          { TTL: 60 * 60 * 24, urgency: 'high' }
        );
        results.push({ recipient_id: q.recipient_id, subscription_id: q.subscription_id, ok: true });
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        const gone = status === 404 || status === 410;
        results.push({ recipient_id: q.recipient_id, subscription_id: q.subscription_id, ok: false, gone, error: `${status ?? ''} ${(e as Error).message ?? ''}`.trim().slice(0, 200) });
      }
    }));
  }

  await supabase.rpc('notif_push_mark', { p: results });
  return {
    configured: true,
    tick,
    queued: queue.length,
    sent: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok && !r.gone).length,
    gone: results.filter((r) => r.gone).length,
  };
}
