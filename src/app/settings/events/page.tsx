'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
  CalendarDays, Plus, ArrowRight, Loader2, X, Pencil, Save, Trash2, Star, Clock, Eye, Lock,
} from 'lucide-react';
import AppShell from '@/components/AppShell';
import { collapseGroups, deleteClassGroup, saveClassGroup, type Grouped } from '@/lib/class-groups';
import { MultiClassSelect } from '@/components/MultiClassSelect';
import { classTargets } from '@/lib/class-multi';
import { useAuth } from '@/lib/auth-context';
import { usePermissions } from '@/lib/permissions-context';
import { createClient } from '@/lib/supabase/client';
import { useDebouncedRealtime } from '@/lib/realtime';
import { ScopeGroups, ScopeGroupFilters, useScopeGroups, toLookups } from '@/components/ScopeGroups';
import type { AppEvent, ClassRoom, Service, Church, EventRecurrence, PointsMode } from '@/lib/types';
import { POINTS_MODE_LABELS } from '@/lib/types';
import { WEEKDAY_LABELS, describeEventSchedule } from '@/lib/time';
import { defaultLevelLabel } from '@/lib/defaults';

// Sentinel for "all services / all classes" in select controls (null in DB)
const ALL = 'all';

export default function EventsPage() {
  const { profile } = useAuth();
  const { activityCan } = usePermissions();
  const canAdd = activityCan('events', 'add');
  const canEdit = activityCan('events', 'edit');
  const canDelete = activityCan('events', 'delete');
  const canSetDefault = activityCan('events', 'set_default');
  const supabase = createClient();
  const [events, setEvents] = useState<AppEvent[]>([]);
  const [classes, setClasses] = useState<ClassRoom[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [churches, setChurches] = useState<Church[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<Grouped<AppEvent> | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [{ data: ev }, { data: cl }, { data: sv }, { data: ch }] = await Promise.all([
      supabase.from('events').select('*').order('created_at', { ascending: false }),
      supabase.from('classes').select('*').order('sort_order').order('name'),
      supabase.from('services').select('*').order('sort_order').order('name'),
      supabase.from('churches').select('*').order('sort_order').order('name'),
    ]);
    setEvents(ev ?? []);
    setClasses(cl ?? []);
    setServices(sv ?? []);
    setChurches(ch ?? []);
    setLoading(false);
  }, [supabase]);

  // Initial fetch — the realtime hook below only reloads on DB change events,
  // so without this the page would sit on the spinner until something changed.
  useEffect(() => {
    if (profile?.status === 'approved') load();
  }, [profile?.status, load]);

  useDebouncedRealtime(supabase, 'events-page', [{ table: 'events' }], load, { enabled: !!profile });

  // church → service → class tree + filter (a church-wide event sits under its church)
  const lookups = useMemo(() => toLookups(churches, services, classes), [churches, services, classes]);
  const grouped = useMemo(() => collapseGroups(events), [events]);
  const { scope, setScope, search, setSearch, visible } = useScopeGroups(
    grouped,
    (ev, q) => ev.name.toLowerCase().includes(q) || (ev.description ?? '').toLowerCase().includes(q),
  );
  const className = (id: string) => classes.find((c) => c.id === id)?.name ?? '—';
  const scopeBadge = (ev: Grouped<AppEvent>) =>
    ev.service_id === null ? 'كل الخدمات' : ev.class_id === null ? 'كل الفصول'
      : ev.class_ids.length > 1 ? ev.class_ids.map(className).join('، ') : null;

  const remove = async (ev: AppEvent) => {
    if (!confirm(`حذف المناسبة «${ev.name}»؟ سجلات الحضور المرتبطة بها ستبقى بدون مناسبة.`)) return;
    await deleteClassGroup(supabase, 'events', ev);
    load();
  };

  return (
    <AppShell>
      <section className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link href="/settings" aria-label="رجوع" className="rounded-full p-1.5 hover:bg-slate-100">
            <ArrowRight className="h-5 w-5" />
          </Link>
          <h2 className="flex items-center gap-2 text-lg font-extrabold">
            <CalendarDays className="h-5 w-5 text-violet-600" />
            المناسبات
            <span className="badge bg-violet-100 text-violet-700">{grouped.length}</span>
          </h2>
        </div>
        {canAdd && (
          <button onClick={() => setShowAdd(true)} className="btn-primary !py-2 !px-3 flex items-center gap-1 text-sm">
            <Plus className="h-4 w-4" /> إضافة
          </button>
        )}
      </section>

      {!canAdd && !canEdit && !canDelete && (
        <p className="mb-3 flex items-center gap-2 rounded-2xl bg-slate-50 px-4 py-2.5 text-xs font-bold text-slate-500">
          <Eye className="h-4 w-4" /> عرض فقط — الإضافة والتعديل تحتاج ملف صلاحيات من مسؤولك
        </p>
      )}

      <p className="mb-4 rounded-2xl bg-violet-50 px-4 py-3 text-xs font-bold text-violet-700">
        الحضور يُسجَّل على مناسبة (قداس، اجتماع، رحلة...). المناسبة قد تكون مرة واحدة أو أسبوعية،
        ونطاقها فصل محدد أو كل الفصول أو كل الخدمات، ولها نقاط تُمنح عند الحضور.
        جميع المواعيد بتوقيت القاهرة.
      </p>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary-500" /></div>
      ) : (
        <>
        <ScopeGroupFilters idPrefix="events" scope={scope} onScope={setScope} lookups={lookups}
          search={search} onSearch={setSearch} placeholder="بحث باسم المناسبة..." />
        <ScopeGroups
          idPrefix="events"
          rows={visible}
          lookups={lookups}
          tone="violet"
          itemName={(ev) => ev.name}
          emptyText={grouped.length === 0 ? 'لا توجد مناسبات بعد' : 'لا توجد مناسبات مطابقة'}
          renderItem={(ev) => (
            <li key={ev.id} className="card flex items-start gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-violet-50 ring-2 ring-violet-100">
                <CalendarDays className="h-6 w-6 text-violet-400" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-extrabold">{ev.name}</p>
                  <span className="badge bg-amber-100 text-amber-700 flex items-center gap-1">
                    <Star className="h-3 w-3" />
                    {ev.points_mode === 'open' ? 'مفتوح' : `${ev.points} نقطة`}
                    {ev.points_mode === 'editable' && ' ✎'}
                  </span>
                  {ev.is_default && (
                    <span className="badge bg-emerald-100 text-emerald-700">{defaultLevelLabel(ev)}</span>
                  )}
                  {scopeBadge(ev) && <span className="badge bg-slate-100 text-slate-500">{scopeBadge(ev)}</span>}
                </div>
                <p className="text-xs font-bold text-violet-600 mt-1 flex items-center gap-1">
                  <Clock className="h-3 w-3" /> {describeEventSchedule(ev)}
                </p>
                {ev.description && <p className="text-xs text-slate-500 mt-1">{ev.description}</p>}
              </div>
              {(canEdit || canDelete) && (
                <div className="flex shrink-0 gap-1.5">
                  {canEdit && (
                    <button
                      onClick={() => setEditing(ev)}
                      aria-label={`تعديل ${ev.name}`}
                      className="rounded-xl bg-violet-50 p-2 text-violet-600 hover:bg-violet-100 transition"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                  )}
                  {canDelete && (
                    <button
                      onClick={() => remove(ev)}
                      aria-label={`حذف ${ev.name}`}
                      className="rounded-xl bg-red-50 p-2 text-red-600 hover:bg-red-100 transition"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              )}
            </li>
          )}
        />
        </>
      )}

      {showAdd && (
        <EventModal
          mode="add"
          churches={churches}
          services={services}
          classes={classes}
          canSetDefault={canSetDefault}
          onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); load(); }}
        />
      )}
      {editing && (
        <EventModal
          mode="edit"
          event={editing}
          churches={churches}
          services={services}
          classes={classes}
          canSetDefault={canSetDefault}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </AppShell>
  );
}

function EventModal({
  mode, event, churches, services, classes, canSetDefault, onClose, onSaved,
}: {
  mode: 'add' | 'edit';
  event?: Grouped<AppEvent>;
  churches: Church[];
  services: Service[];
  classes: ClassRoom[];
  /** `activity.events.set_default` — without it the default flag is read-only */
  canSetDefault: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { profile } = useAuth();
  const supabase = createClient();
  const [name, setName] = useState(event?.name ?? '');
  const [description, setDescription] = useState(event?.description ?? '');
  const [churchId, setChurchId] = useState(event?.church_id ?? '');
  const [serviceId, setServiceId] = useState(event ? (event.service_id ?? ALL) : '');
  const [classIds, setClassIds] = useState<string[]>(event ? event.class_ids : []); // [] = كل الفصول
  const [recurrence, setRecurrence] = useState<EventRecurrence>(event?.recurrence ?? 'once');
  const [eventDate, setEventDate] = useState(event?.event_date ?? '');
  const [weekdays, setWeekdays] = useState<number[]>(event?.weekdays ?? []);
  const [startTime, setStartTime] = useState(event?.start_time?.slice(0, 5) ?? '');
  const [endTime, setEndTime] = useState(event?.end_time?.slice(0, 5) ?? '');
  const [points, setPoints] = useState(String(event?.points ?? 1));
  const [pointsMode, setPointsMode] = useState<PointsMode>(event?.points_mode ?? 'fixed');
  const [isDefault, setIsDefault] = useState<boolean>(event?.is_default ?? false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const filteredServices = churchId ? services.filter((s) => s.church_id === churchId) : [];
  const filteredClasses = serviceId && serviceId !== ALL
    ? classes.filter((c) => c.church_id === churchId && c.service_id === serviceId)
    : [];

  const toggleWeekday = (d: number) => {
    setWeekdays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!churchId) return setError('اختر الكنيسة');
    if (!serviceId) return setError('اختر الخدمة أو «كل الخدمات»');
    if (recurrence === 'once' && !eventDate) return setError('حدد تاريخ المناسبة');
    if (recurrence === 'weekly' && weekdays.length === 0) return setError('اختر يوماً واحداً على الأقل');
    const pts = Math.max(0, Math.floor(Number(points) || 0));
    setSaving(true);

    const base = {
      church_id: churchId,
      service_id: serviceId === ALL ? null : serviceId,
      name: name.trim(),
      description: description.trim() || null,
      recurrence,
      event_date: recurrence === 'once' ? eventDate : null,
      weekdays: recurrence === 'weekly' ? weekdays : null,
      start_time: startTime || null,
      end_time: endTime || null,
      points: pts,
      points_mode: pointsMode,
      is_default: isDefault,
    };

    // One default PER SCOPE (0048): the DB trigger switches off the other
    // default of the SAME church / service / class; defaults of other levels
    // are untouched (class default beats service default beats church default).
    // ONE event that covers the chosen classes (none chosen / «كل الفصول» = no class).
    // Stored as one row per class tied by group_id; editing updates / adds / removes rows to match.
    const targets = serviceId === ALL ? [null] : classTargets(classIds);
    let err: { message: string } | null = null;
    try {
      await saveClassGroup<AppEvent>({
        existing: event?.group_rows,
        targets,
        create: async (cid, gid) => {
          const { data, error } = await supabase.from('events').insert({ ...base, class_id: cid, group_id: gid, created_by: profile?.id }).select('*').single();
          if (error) throw error;
          return data as AppEvent;
        },
        update: async (row, cid, gid) => {
          const { data, error } = await supabase.from('events').update({ ...base, class_id: cid, group_id: gid, edited_by: profile?.id }).eq('id', row.id).select('*').single();
          if (error) throw error;
          return data as AppEvent;
        },
        remove: async (row) => { const { error } = await supabase.from('events').delete().eq('id', row.id); if (error) throw error; },
      });
    } catch (e) { err = e as { message: string }; }

    if (err) {
      setError('تعذر الحفظ، تأكد من الصلاحيات');
      setSaving(false);
      return;
    }
    onSaved();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-6">
      <div className="w-full max-w-md rounded-t-3xl sm:rounded-3xl bg-white p-5 max-h-[90vh] overflow-y-auto">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-extrabold">{mode === 'add' ? 'إضافة مناسبة' : 'تعديل المناسبة'}</h3>
          <button onClick={onClose} aria-label="إغلاق" className="rounded-full p-1.5 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-500">الكنيسة *</label>
            <select
              className="input-field"
              value={churchId}
              onChange={(e) => { setChurchId(e.target.value); setServiceId(''); setClassIds([]); }}
              required
            >
              <option value="">اختر الكنيسة</option>
              {churches.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-500">الخدمة *</label>
            <select
              className="input-field"
              value={serviceId}
              onChange={(e) => { setServiceId(e.target.value); setClassIds([]); }}
              required
            >
              <option value="">اختر الخدمة</option>
              <option value={ALL}>✳ كل الخدمات</option>
              {filteredServices.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          {serviceId && serviceId !== ALL && (
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-500">الفصل *</label>
              <MultiClassSelect
                id="form-class"
                value={classIds}
                onChange={setClassIds}
                options={filteredClasses}
                allLabel="✳ كل الفصول"
                className="!py-2.5 !text-sm"
              />
            </div>
          )}
          <input className="input-field" placeholder="اسم المناسبة * (مثال: قداس الجمعة)" value={name}
            onChange={(e) => setName(e.target.value)} required />

          <div>
            <label className="mb-1 block text-xs font-bold text-slate-500">التكرار *</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setRecurrence('once')}
                className={`rounded-xl px-3 py-2 text-sm font-bold ring-2 transition ${
                  recurrence === 'once'
                    ? 'bg-violet-600 text-white ring-violet-600'
                    : 'bg-white text-slate-600 ring-slate-200 hover:ring-violet-300'
                }`}
              >
                مرة واحدة
              </button>
              <button
                type="button"
                onClick={() => setRecurrence('weekly')}
                className={`rounded-xl px-3 py-2 text-sm font-bold ring-2 transition ${
                  recurrence === 'weekly'
                    ? 'bg-violet-600 text-white ring-violet-600'
                    : 'bg-white text-slate-600 ring-slate-200 hover:ring-violet-300'
                }`}
              >
                أسبوعياً (أيام الأسبوع)
              </button>
            </div>
          </div>

          {recurrence === 'once' ? (
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-500">تاريخ المناسبة *</label>
              <input type="date" className="input-field" value={eventDate}
                onChange={(e) => setEventDate(e.target.value)} required />
            </div>
          ) : (
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-500">
                أيام الأسبوع * (يوم واحد = كل أسبوع، عدة أيام = أيام الأسبوع)
              </label>
              <div className="grid grid-cols-7 gap-1">
                {WEEKDAY_LABELS.map((label, d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => toggleWeekday(d)}
                    aria-pressed={weekdays.includes(d)}
                    className={`rounded-lg px-0.5 py-2 text-[10px] font-bold ring-1 transition ${
                      weekdays.includes(d)
                        ? 'bg-violet-600 text-white ring-violet-600'
                        : 'bg-white text-slate-500 ring-slate-200 hover:ring-violet-300'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-500">من الساعة</label>
              <input type="time" className="input-field" value={startTime}
                onChange={(e) => setStartTime(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-500">إلى الساعة</label>
              <input type="time" className="input-field" value={endTime}
                onChange={(e) => setEndTime(e.target.value)} />
            </div>
          </div>
          <p className="rounded-xl bg-slate-50 px-3 py-2 text-[11px] font-bold text-slate-500">
            المواعيد بتوقيت القاهرة. خارج اليوم أو الوقت المحدد سيظهر تنبيه عند محاولة تسجيل الحضور.
          </p>

          <div>
            <label className="mb-1 block text-xs font-bold text-slate-500">نظام النقاط *</label>
            <div className="grid grid-cols-3 gap-2">
              {(['fixed', 'editable', 'open'] as PointsMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setPointsMode(m)}
                  aria-pressed={pointsMode === m}
                  className={`rounded-xl px-2 py-2 text-xs font-bold ring-2 transition ${
                    pointsMode === m
                      ? 'bg-amber-500 text-white ring-amber-500'
                      : 'bg-white text-slate-600 ring-slate-200 hover:ring-amber-300'
                  }`}
                >
                  {POINTS_MODE_LABELS[m]}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[10px] font-bold text-slate-400">
              ثابت: لا يمكن تغيير الرقم · قابل للتعديل: الرقم افتراضي ويمكن تغييره · مفتوح: يُكتب الرقم كل مرة
            </p>
          </div>

          {pointsMode !== 'open' && (
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-500">نقاط الحضور *</label>
              <div className="flex items-center gap-2">
                <Star className="h-5 w-5 text-amber-500" />
                <input
                  type="number" min={0} className="input-field" value={points}
                  onChange={(e) => setPoints(e.target.value)} required
                />
              </div>
            </div>
          )}

          {/* Default radio — preselected on children & scanner pages for THIS scope (0048).
              Needs `activity.events.set_default`; otherwise shown locked. */}
          <label className={`flex flex-col gap-1 rounded-xl px-3 py-2.5 text-sm font-bold ${canSetDefault ? 'bg-emerald-50 text-emerald-700 cursor-pointer' : 'bg-slate-50 text-slate-400'}`}>
            <span className="flex items-center gap-2">
              <input
                id="event-default-radio"
                type="radio"
                checked={isDefault}
                disabled={!canSetDefault}
                onClick={() => { if (canSetDefault) setIsDefault((v) => !v); }}
                onChange={() => {}}
                className="h-4 w-4 accent-emerald-600"
              />
              {!canSetDefault && <Lock className="h-3.5 w-3.5" />}
              {serviceId === ALL || !serviceId
                ? 'جعلها المناسبة الافتراضية للكنيسة'
                : classIds.length !== 1
                  ? 'جعلها المناسبة الافتراضية للخدمة'
                  : 'جعلها المناسبة الافتراضية للفصل'}
            </span>
            <span className={`text-xs font-normal ${canSetDefault ? 'text-emerald-600/80' : 'text-slate-400'}`}>
              {canSetDefault
                ? 'تُختار تلقائياً عند تسجيل الحضور. الأولوية: افتراضي الفصل ← ثم الخدمة ← ثم الكنيسة.'
                : 'تحديد الافتراضية يحتاج صلاحية «تحديد المناسبة الافتراضية»'}
            </span>
          </label>

          <textarea className="input-field" placeholder="وصف المناسبة" rows={2} value={description}
            onChange={(e) => setDescription(e.target.value)} />
          {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{error}</p>}
          <button type="submit" disabled={saving} className="btn-primary w-full flex items-center justify-center gap-2">
            {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : mode === 'add' ? <Plus className="h-5 w-5" /> : <Save className="h-5 w-5" />}
            {mode === 'add' ? 'حفظ المناسبة' : 'حفظ التعديلات'}
          </button>
        </form>
      </div>
    </div>
  );
}
