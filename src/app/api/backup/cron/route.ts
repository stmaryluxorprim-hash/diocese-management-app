// /api/backup/cron — run the DUE scheduled backups (migration 0044).
//   GET   — Vercel Cron (DAILY — the Hobby plan refuses to deploy crons that
//           run more often; see vercel.json). When CRON_SECRET is set the
//           request must carry `Authorization: Bearer <secret>` (Vercel adds it).
//   POST  — the owner, from /owner/backup, «تشغيل الآن» for ONE schedule
//           ({ schedule_id }) or every due one ({}).
// Files land in the private bucket `backups/<schedule>/<file>.json`; the
// history row in backup_runs keeps the path so the owner can download it
// to the device later (/api/backup/file?run=<id>).
import { NextResponse, type NextRequest } from 'next/server';
import { adminClient, requireOwner, runDueSchedules, runSchedule } from '@/lib/server/backup-admin';
import type { BackupSchedule } from '@/lib/backup';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const APP_VERSION = '0.2.0';

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization') ?? '';
    const q = req.nextUrl.searchParams.get('secret') ?? '';
    if (auth !== `Bearer ${secret}` && q !== secret) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }
  const admin = adminClient();
  if (!admin) return NextResponse.json({ error: 'not_configured', configured: false }, { status: 503 });
  try {
    const results = await runDueSchedules(admin, APP_VERSION);
    return NextResponse.json({ ok: true, ran: results.length, results });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const who = await requireOwner();
  if (!who.ok) return NextResponse.json({ error: who.error }, { status: who.status });
  let body: { schedule_id?: string } = {};
  try { body = await req.json(); } catch { /* empty body = all due */ }
  try {
    if (body.schedule_id) {
      const { data, error } = await who.admin.from('backup_schedules').select('*').eq('id', body.schedule_id).maybeSingle();
      if (error || !data) return NextResponse.json({ error: 'not_found' }, { status: 404 });
      const r = await runSchedule(who.admin, data as BackupSchedule, APP_VERSION);
      return NextResponse.json({ ok: r.status === 'done', results: [r] });
    }
    const results = await runDueSchedules(who.admin, APP_VERSION);
    return NextResponse.json({ ok: true, ran: results.length, results });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
