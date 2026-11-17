'use client';

// ---------- Who earned this achievement ----------
// `achievement_earners` RPC (names / pictures resolved server-side, scoped
// by RLS-equivalent visibility). Managers (or the awarder) can revoke an
// award → compensating −points row + the award row disappears.

import { useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import { X, Loader2, User, Star, Users, Undo2, Zap, Hand } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth-context';
import { fetchEarners, revokeAchievement, achievementErrorMessage, type Achievement, type AchievementEarner } from '@/lib/achievements';
import { AchievementThumb, fmtDateTime } from '@/components/achievements/AchievementBits';

export default function EarnersModal({ achievement, onClose, onChanged }: {
  achievement: Achievement & { group_rows?: Achievement[] }; onClose: () => void; onChanged?: () => void;
}) {
  const { profile } = useAuth();
  const [supabase] = useState(() => createClient());
  const [rows, setRows] = useState<AchievementEarner[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      // an achievement covering several classes = several rows; show the earners of all of them
      const ids = (achievement.group_rows ?? [achievement]).map((r) => r.id);
      const lists = await Promise.all(ids.map((id) => fetchEarners(supabase, id)));
      setRows(lists.flat());
    }
    catch (e) { setError(achievementErrorMessage(e)); setRows([]); }
  }, [supabase, achievement]);
  useEffect(() => { load(); }, [load]);

  const isManager = !!profile && ['owner', 'church_manager', 'service_manager'].includes(profile.role);
  const canRevoke = (r: AchievementEarner) => isManager || r.awarded_by === profile?.id;

  const revoke = async (r: AchievementEarner) => {
    if (!confirm(`إلغاء إنجاز «${achievement.name}» من ${r.person_name}؟\nسيُخصم ${r.points_awarded} نقطة من رصيده.`)) return;
    setBusy(r.id); setError('');
    try {
      await revokeAchievement(supabase, r.id);
      setRows((l) => (l ?? []).filter((x) => x.id !== r.id));
      onChanged?.();
    } catch (e) { setError(achievementErrorMessage(e, 'تعذر الإلغاء')); }
    finally { setBusy(null); }
  };

  const total = (rows ?? []).reduce((s, r) => s + r.points_awarded, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-6" onClick={onClose}>
      <div id="earners-modal" className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-5 sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-lg font-extrabold"><Users className="h-5 w-5 text-amber-600" /> من حصل على الإنجاز</h3>
          <button type="button" onClick={onClose} aria-label="إغلاق" className="rounded-full p-1.5 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>

        <div className="mb-3 flex items-center gap-3 rounded-2xl bg-amber-50/60 p-3">
          <AchievementThumb url={achievement.image_url} name={achievement.name} size={48} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-extrabold">{achievement.name}</p>
            <p className="text-[11px] font-bold text-slate-500">
              {rows ? `${rows.length} مرة` : '…'} · <Star className="inline h-3 w-3 text-gold-500" /> {total} نقطة ممنوحة
            </p>
          </div>
        </div>

        {error && <p className="mb-2 rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600">{error}</p>}

        {rows === null ? (
          <div className="flex justify-center py-10"><Loader2 className="h-7 w-7 animate-spin text-amber-500" /></div>
        ) : rows.length === 0 ? (
          <p className="py-10 text-center text-sm font-bold text-slate-400">لم يحصل عليه أحد بعد</p>
        ) : (
          <ul id="earners-list" className="divide-y divide-amber-50 overflow-hidden rounded-2xl border border-amber-50">
            {rows.map((r) => (
              <li key={r.id} id={`earner-${r.id}`} className="flex items-center gap-3 bg-white px-3 py-2.5">
                <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-xl bg-gradient-to-br from-primary-600 to-accent-600 text-white">
                  {r.person_image ? <Image src={r.person_image} alt={r.person_name} fill sizes="44px" className="object-cover" /> : <User className="absolute inset-0 m-auto h-5 w-5" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-extrabold">{r.person_name}</p>
                  <p className="truncate text-[11px] font-bold text-slate-400">{r.class_name} · {r.service_name}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-slate-400">
                    {fmtDateTime(r.awarded_at)}
                    <span className="inline-flex items-center gap-0.5">
                      {r.source === 'attendance' ? <><Zap className="h-3 w-3 text-emerald-500" /> تلقائي</> : <><Hand className="h-3 w-3 text-primary-500" /> {r.awarded_by_name ?? 'يدوي'}</>}
                    </span>
                    {r.event_name && <span>· {r.event_name}</span>}
                  </p>
                </div>
                <span className="badge shrink-0 bg-gold-100 text-gold-700"><Star className="h-3 w-3" /> +{r.points_awarded}</span>
                {canRevoke(r) && (
                  <button type="button" aria-label="إلغاء الإنجاز" title="إلغاء الإنجاز" disabled={busy === r.id} onClick={() => revoke(r)}
                    className="rounded-full bg-red-50 p-2 text-red-500 hover:bg-red-100 disabled:opacity-40">
                    {busy === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
