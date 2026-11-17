'use client';

// ---------- NOTIFICATIONS MODULE — AUTOMATIONS (الإشعارات التلقائية) ----------
// Trigger → Recipient → Notification. List grouped by trigger; each row can
// be enabled / disabled / edited / deleted. Realtime on the table.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Zap, Plus, Pencil, Trash2, Power, PowerOff, Loader2, ArrowLeft, Users, UserCog, Sparkles } from 'lucide-react';
import AppShell from '@/components/AppShell';
import { NotifHeader, Toast } from '@/components/notifications/NotifBits';
import AutomationForm from '@/components/notifications/AutomationForm';
import { useStoreLookups, scopeLabel } from '@/components/store/StoreBits';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';
import { useDebouncedRealtime } from '@/lib/realtime';
import { collapseGroups, type Grouped } from '@/lib/class-groups';
import {
  TRIGGERS, RECIPIENT_LABELS, fetchAutomations, toggleAutomation, deleteAutomation, notifErrorMessage,
  type NotificationAutomation, type TriggerKey,
} from '@/lib/notifications';

export default function AutomationsPage() {
  const { profile } = useAuth();
  const [supabase] = useState(() => createClient());
  const approved = profile?.status === 'approved';
  const { churches, services, classes } = useStoreLookups(supabase, approved);
  const [rawRows, setRows] = useState<NotificationAutomation[] | null>(null);
  // rows sharing a group_id are ONE automation covering several classes
  const rows = useMemo(() => (rawRows ? collapseGroups(rawRows) : null), [rawRows]);
  const [editing, setEditing] = useState<Grouped<NotificationAutomation> | 'new' | null>(null);
  const [confirmDel, setConfirmDel] = useState<Grouped<NotificationAutomation> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3200); };

  const load = useCallback(async () => {
    if (!approved) return;
    try { setRows(await fetchAutomations(supabase)); setError(null); }
    catch (e) { setError(notifErrorMessage(e, 'تعذر التحميل')); setRows([]); }
  }, [supabase, approved]);
  useEffect(() => { load(); }, [load]);
  useDebouncedRealtime(supabase, 'notif-automations', [{ table: 'notification_automations' }], load, { enabled: approved, delayMs: 700 });

  const toggle = async (a: Grouped<NotificationAutomation>) => {
    setBusy(a.id);
    try { await toggleAutomation(supabase, a.id, !a.is_active, a.group_id); flash(a.is_active ? 'تم إيقاف الإشعار التلقائي' : 'تم تفعيل الإشعار التلقائي'); load(); }
    catch (e) { flash(notifErrorMessage(e)); }
    finally { setBusy(null); }
  };
  const remove = async () => {
    if (!confirmDel) return;
    setBusy(confirmDel.id);
    try { await deleteAutomation(supabase, confirmDel.id, confirmDel.group_id); flash('تم الحذف'); setConfirmDel(null); load(); }
    catch (e) { flash(notifErrorMessage(e)); }
    finally { setBusy(null); }
  };

  const grouped = useMemo(() => {
    const m = new Map<TriggerKey, Grouped<NotificationAutomation>[]>();
    (rows ?? []).forEach((a) => { const l = m.get(a.trigger_key) ?? []; l.push(a); m.set(a.trigger_key, l); });
    return m;
  }, [rows]);

  return (
    <AppShell>
      <NotifHeader title="تلقائي" />

      <section className="card mb-3 flex items-start gap-3 !p-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-600"><Zap className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-extrabold text-slate-800">حدث في التطبيق ← مستلم ← إشعار</p>
          <p className="mt-0.5 text-[11px] font-bold leading-relaxed text-slate-500">
            مثال: عند إضافة 5 نقاط ← المخدوم ← «🎉 تمت إضافة [النقاط] نقاط إلى رصيدك». يُرسل تلقائياً على جهاز المستلم وفي قائمة الواردة.
          </p>
        </div>
      </section>

      <button id="auto-new" type="button" onClick={() => setEditing('new')} className="btn-primary mb-3 flex w-full items-center justify-center gap-2 !from-violet-600 !to-violet-500">
        <Plus className="h-5 w-5" /> إشعار تلقائي جديد
      </button>

      {error && <p className="card mb-3 text-center text-xs font-bold text-amber-700">{error}</p>}

      {rows === null ? (
        <div className="flex justify-center py-12"><Loader2 className="h-7 w-7 animate-spin text-violet-500" /></div>
      ) : rows.length === 0 ? (
        <div className="card py-10 text-center">
          <Sparkles className="mx-auto mb-2 h-8 w-8 text-slate-300" />
          <p className="text-sm font-extrabold text-slate-600">لا توجد إشعارات تلقائية بعد</p>
          <p className="mt-1 text-xs font-bold text-slate-400">أنشئ أول واحد — مثلاً إشعار عند تسجيل الحضور</p>
        </div>
      ) : (
        <div className="space-y-4">
          {TRIGGERS.filter((t) => grouped.has(t.key)).map((t) => (
            <section key={t.key}>
              <p className="mb-1.5 flex items-center gap-1.5 px-1 text-xs font-extrabold text-slate-500"><Zap className="h-3.5 w-3.5 text-violet-500" /> {t.label}</p>
              <ul id={`auto-group-${t.key}`} className="space-y-2">
                {grouped.get(t.key)!.map((a) => (
                  <li key={a.id} className={`card !p-3 ${a.is_active ? '' : 'opacity-70'}`}>
                    <div className="flex items-start gap-3">
                      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${a.is_active ? 'bg-violet-600 text-white' : 'bg-slate-200 text-slate-500'}`}>
                        {a.recipient === 'class_servants' ? <UserCog className="h-5 w-5" /> : <Users className="h-5 w-5" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="flex-1 truncate text-sm font-extrabold text-slate-800">{a.name}</p>
                          <span className={`badge ${a.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'}`}>{a.is_active ? 'مفعّل' : 'موقوف'}</span>
                        </div>
                        <p className="mt-0.5 text-[11px] font-bold text-slate-500">
                          {t.label} <ArrowLeft className="inline h-3 w-3" /> {RECIPIENT_LABELS[a.recipient]} <ArrowLeft className="inline h-3 w-3" /> «{a.title_template}»
                        </p>
                        {a.body_template && <p className="mt-0.5 text-xs text-slate-500 line-clamp-2">{a.body_template}</p>}
                        <p className="mt-1 text-[11px] font-bold text-slate-400">
                          {a.church_id ? scopeLabel({ church_id: a.church_id, service_id: a.service_id, class_id: a.class_id, class_ids: a.class_ids }, churches, services, classes) : 'كل الكنائس'}
                          {t.config && a.config?.[t.config.key] !== undefined && ` · ${t.config.label}: ${String(a.config[t.config.key])}`}
                        </p>
                      </div>
                    </div>
                    <div className="mt-2 flex justify-end gap-2">
                      <button type="button" onClick={() => toggle(a)} disabled={busy === a.id}
                        className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-extrabold ${a.is_active ? 'bg-amber-50 text-amber-700 hover:bg-amber-100' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'}`}>
                        {a.is_active ? <PowerOff className="h-3.5 w-3.5" /> : <Power className="h-3.5 w-3.5" />} {a.is_active ? 'إيقاف' : 'تفعيل'}
                      </button>
                      <button type="button" onClick={() => setEditing(a)} className="flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1.5 text-[11px] font-extrabold text-slate-600 hover:bg-slate-200">
                        <Pencil className="h-3.5 w-3.5" /> تعديل
                      </button>
                      <button type="button" onClick={() => setConfirmDel(a)} className="flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1.5 text-[11px] font-extrabold text-slate-600 hover:bg-red-50 hover:text-red-600">
                        <Trash2 className="h-3.5 w-3.5" /> حذف
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {editing && (
        <AutomationForm
          supabase={supabase}
          initial={editing === 'new' ? null : editing}
          churches={churches} services={services} classes={classes}
          isOwner={profile?.role === 'owner'}
          userId={profile?.id}
          onClose={() => setEditing(null)}
          onSaved={(msg) => { setEditing(null); flash(msg); load(); }}
        />
      )}

      {confirmDel && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/45 p-4 sm:items-center" onClick={() => setConfirmDel(null)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <p className="text-center text-sm font-extrabold text-slate-800">حذف «{confirmDel.name}»؟</p>
            <p className="mt-1 text-center text-xs font-bold text-slate-400">لن تُرسل إشعارات تلقائية جديدة منه؛ السجل يبقى</p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setConfirmDel(null)} className="btn-secondary !py-2.5 text-sm">رجوع</button>
              <button id="auto-del-confirm" type="button" onClick={remove} disabled={!!busy} className="btn-primary !from-red-600 !to-red-500 !py-2.5 text-sm">
                {busy ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : 'حذف'}
              </button>
            </div>
          </div>
        </div>
      )}

      <Toast msg={toast} />
    </AppShell>
  );
}
