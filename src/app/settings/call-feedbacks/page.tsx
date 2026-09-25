'use client';

// ---------- إدارة نتائج الافتقاد (migration 0023) ----------
// Managers define the outcomes a servant can pick after calling a child:
// name + color + icon, bound to church → service → class → event (each of
// service / class / event may be "all"). They appear as colored buttons in
// the call-feedback modal and as the badge on the child's card.

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
  PhoneCall, Plus, ArrowRight, Loader2, X, Pencil, Save, Trash2, Palette, ChevronUp, ChevronDown, Eye,
} from 'lucide-react';
import AppShell from '@/components/AppShell';
import { useAuth } from '@/lib/auth-context';
import { usePermissions } from '@/lib/permissions-context';
import { createClient } from '@/lib/supabase/client';
import { useDebouncedRealtime } from '@/lib/realtime';
import { invalidateLookup } from '@/lib/queries';
import { ScopeGroups, ScopeGroupFilters, useScopeGroups, toLookups } from '@/components/ScopeGroups';
import type { CallFeedback, ClassRoom, Service, Church, AppEvent } from '@/lib/types';
import { describeEventSchedule } from '@/lib/time';
import {
  CALL_FEEDBACK_COLORS, CALL_FEEDBACK_ICON_KEYS, isHexColor, feedbackStyle, feedbackTintStyle,
} from '@/lib/call-feedback';
import { CallFeedbackIcon } from '@/components/CallFeedback';

// Sentinel for "all services / all classes / all events" (null in DB)
const ALL = 'all';

export default function CallFeedbacksPage() {
  const { profile } = useAuth();
  const { activityCan } = usePermissions();
  const canAdd = activityCan('feedbacks', 'add');
  const canEdit = activityCan('feedbacks', 'edit');
  const canDelete = activityCan('feedbacks', 'delete');
  const canReorder = activityCan('feedbacks', 'reorder');
  const supabase = createClient();
  const [feedbacks, setFeedbacks] = useState<CallFeedback[]>([]);
  const [classes, setClasses] = useState<ClassRoom[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [churches, setChurches] = useState<Church[]>([]);
  const [events, setEvents] = useState<AppEvent[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<CallFeedback | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [{ data: fb }, { data: cl }, { data: sv }, { data: ch }, { data: ev }] = await Promise.all([
      supabase.from('call_feedbacks').select('*').order('sort_order').order('name'),
      supabase.from('classes').select('*').order('name'),
      supabase.from('services').select('*').order('name'),
      supabase.from('churches').select('*').order('name'),
      supabase.from('events').select('*').order('name'),
    ]);
    setFeedbacks(fb ?? []);
    setClasses(cl ?? []);
    setServices(sv ?? []);
    setChurches(ch ?? []);
    setEvents(ev ?? []);
    setLoading(false);
    invalidateLookup('call_feedbacks');
  }, [supabase]);

  useEffect(() => {
    if (profile?.status === 'approved') load();
  }, [profile?.status, load]);

  useDebouncedRealtime(supabase, 'call-feedbacks-page', [{ table: 'call_feedbacks' }], load, { enabled: !!profile });

  // church → service → class tree + filter; the event (4th level) stays a badge on the card
  const lookups = useMemo(() => toLookups(churches, services, classes), [churches, services, classes]);
  const { scope, setScope, search, setSearch, visible } = useScopeGroups(
    feedbacks,
    (fb, q) => fb.name.toLowerCase().includes(q),
  );
  const scopeBadge = (fb: CallFeedback) =>
    fb.service_id === null ? 'كل الخدمات' : fb.class_id === null ? 'كل الفصول' : null;
  const eventLabel = (fb: CallFeedback) =>
    fb.event_id === null ? 'كل المناسبات' : (events.find((e) => e.id === fb.event_id)?.name ?? 'مناسبة محذوفة');

  const remove = async (fb: CallFeedback) => {
    if (!confirm(`حذف نتيجة الافتقاد «${fb.name}»؟ المكالمات المسجلة بها ستبقى بدون نتيجة.`)) return;
    await supabase.from('call_feedbacks').delete().eq('id', fb.id);
    load();
  };

  // Reorder within the list (sort_order)
  const move = async (fb: CallFeedback, dir: -1 | 1) => {
    const idx = feedbacks.findIndex((f) => f.id === fb.id);
    const other = feedbacks[idx + dir];
    if (!other) return;
    const a = idx, b = idx + dir;
    await Promise.all([
      supabase.from('call_feedbacks').update({ sort_order: b }).eq('id', fb.id),
      supabase.from('call_feedbacks').update({ sort_order: a }).eq('id', other.id),
    ]);
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
            <PhoneCall className="h-5 w-5 text-teal-600" />
            نتائج الافتقاد
            <span className="badge bg-teal-100 text-teal-700">{feedbacks.length}</span>
          </h2>
        </div>
        {canAdd && (
          <button id="add-feedback-btn" onClick={() => setShowAdd(true)} className="btn-primary !py-2 !px-3 flex items-center gap-1 text-sm">
            <Plus className="h-4 w-4" /> إضافة
          </button>
        )}
      </section>

      {!canAdd && !canEdit && !canDelete && !canReorder && (
        <p className="mb-3 flex items-center gap-2 rounded-2xl bg-slate-50 px-4 py-2.5 text-xs font-bold text-slate-500">
          <Eye className="h-4 w-4" /> عرض فقط — الإضافة والتعديل تحتاج ملف صلاحيات من مسؤولك
        </p>
      )}

      <p className="mb-4 rounded-2xl bg-teal-50 px-4 py-3 text-xs font-bold text-teal-700">
        بعد الاتصال بالمخدوم للافتقاد يختار الخادم نتيجة الافتقاد (مثال: سيأتي، مريض، لم يرد، مسافر...).
        لكل نتيجة اسم ولون وأيقونة، ونطاقها كنيسة ← خدمة ← فصل ← مناسبة (أو «الكل»). تظهر كشارة بعد شارة الحالة في بطاقة المخدوم.
      </p>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary-500" /></div>
      ) : (
        <>
        <ScopeGroupFilters idPrefix="feedbacks" scope={scope} onScope={setScope} lookups={lookups}
          search={search} onSearch={setSearch} placeholder="بحث باسم النتيجة..." />
        <ScopeGroups
          idPrefix="feedbacks"
          rows={visible}
          lookups={lookups}
          tone="teal"
          itemName={null}
          emptyText={feedbacks.length === 0 ? 'لا توجد نتائج اتصال بعد' : 'لا توجد نتائج مطابقة'}
          renderItem={(fb) => { const i = feedbacks.findIndex((f) => f.id === fb.id); return (
            <li key={fb.id} className="card flex items-start gap-3">
              <div
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl shadow-sm ring-2 ring-black/5"
                style={feedbackStyle(fb.color)}
              >
                <CallFeedbackIcon icon={fb.icon} className="h-6 w-6" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-extrabold">{fb.name}</p>
                  <span className="badge ring-1 ring-black/10" style={feedbackStyle(fb.color)}>
                    <CallFeedbackIcon icon={fb.icon} /> {fb.name}
                  </span>
                </div>
                <p className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-slate-400">
                  {scopeBadge(fb) && <span className="badge bg-slate-100 text-slate-500">{scopeBadge(fb)}</span>}
                  <span className="badge bg-violet-50 text-violet-600">{eventLabel(fb)}</span>
                </p>
              </div>
              {(canEdit || canDelete || canReorder) && (
              <div className="flex shrink-0 flex-col gap-1">
                {(canEdit || canDelete) && (
                <div className="flex gap-1.5">
                  {canEdit && (
                  <button
                    onClick={() => setEditing(fb)}
                    aria-label={`تعديل ${fb.name}`}
                    className="rounded-xl bg-teal-50 p-2 text-teal-600 transition hover:bg-teal-100"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  )}
                  {canDelete && (
                  <button
                    onClick={() => remove(fb)}
                    aria-label={`حذف ${fb.name}`}
                    className="rounded-xl bg-red-50 p-2 text-red-600 transition hover:bg-red-100"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                  )}
                </div>
                )}
                {canReorder && (
                <div className="flex gap-1.5">
                  <button
                    onClick={() => move(fb, -1)}
                    disabled={i === 0}
                    aria-label="تحريك لأعلى"
                    className="flex-1 rounded-xl bg-slate-50 p-1.5 text-slate-500 transition hover:bg-slate-100 disabled:opacity-30"
                  >
                    <ChevronUp className="mx-auto h-4 w-4" />
                  </button>
                  <button
                    onClick={() => move(fb, 1)}
                    disabled={i === feedbacks.length - 1}
                    aria-label="تحريك لأسفل"
                    className="flex-1 rounded-xl bg-slate-50 p-1.5 text-slate-500 transition hover:bg-slate-100 disabled:opacity-30"
                  >
                    <ChevronDown className="mx-auto h-4 w-4" />
                  </button>
                </div>
                )}
              </div>
              )}
            </li>
          ); }}
        />
        </>
      )}

      {showAdd && (
        <FeedbackModal
          mode="add"
          nextOrder={feedbacks.length}
          churches={churches}
          services={services}
          classes={classes}
          events={events}
          onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); load(); }}
        />
      )}
      {editing && (
        <FeedbackModal
          mode="edit"
          feedback={editing}
          nextOrder={feedbacks.length}
          churches={churches}
          services={services}
          classes={classes}
          events={events}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </AppShell>
  );
}

function FeedbackModal({
  mode, feedback, nextOrder, churches, services, classes, events, onClose, onSaved,
}: {
  mode: 'add' | 'edit';
  feedback?: CallFeedback;
  nextOrder: number;
  churches: Church[];
  services: Service[];
  classes: ClassRoom[];
  events: AppEvent[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { profile } = useAuth();
  const supabase = createClient();
  const [name, setName] = useState(feedback?.name ?? '');
  const [churchId, setChurchId] = useState(feedback?.church_id ?? (churches.length === 1 ? churches[0].id : ''));
  const [serviceId, setServiceId] = useState(feedback ? (feedback.service_id ?? ALL) : '');
  const [classId, setClassId] = useState(feedback ? (feedback.class_id ?? ALL) : '');
  const [eventId, setEventId] = useState(feedback ? (feedback.event_id ?? ALL) : ALL);
  const [color, setColor] = useState(feedback?.color ?? CALL_FEEDBACK_COLORS[11]);
  const [icon, setIcon] = useState(feedback?.icon ?? 'phone');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const filteredServices = churchId ? services.filter((s) => s.church_id === churchId) : [];
  const filteredClasses = serviceId && serviceId !== ALL
    ? classes.filter((c) => c.church_id === churchId && c.service_id === serviceId)
    : [];
  // Events inside the chosen scope (an event whose service/class is "all" always qualifies)
  const filteredEvents = useMemo(
    () => events.filter(
      (ev) =>
        ev.church_id === churchId &&
        (serviceId === ALL || !serviceId || ev.service_id === null || ev.service_id === serviceId) &&
        (classId === ALL || !classId || ev.class_id === null || ev.class_id === classId)
    ),
    [events, churchId, serviceId, classId]
  );
  useEffect(() => {
    if (eventId !== ALL && !filteredEvents.some((e) => e.id === eventId)) setEventId(ALL);
  }, [filteredEvents, eventId]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!churchId) return setError('اختر الكنيسة');
    if (!serviceId) return setError('اختر الخدمة أو «كل الخدمات»');
    if (serviceId !== ALL && !classId) return setError('اختر الفصل أو «كل الفصول»');
    if (!name.trim()) return setError('اكتب اسم النتيجة');
    if (!isHexColor(color)) return setError('اختر لوناً صحيحاً');
    setSaving(true);

    const base = {
      church_id: churchId,
      service_id: serviceId === ALL ? null : serviceId,
      class_id: serviceId === ALL || classId === ALL ? null : classId,
      event_id: eventId === ALL ? null : eventId,
      name: name.trim(),
      color: color.toLowerCase(),
      icon,
    };

    const { error: err } = mode === 'add'
      ? await supabase.from('call_feedbacks').insert({ ...base, sort_order: nextOrder, created_by: profile?.id })
      : await supabase.from('call_feedbacks').update({ ...base, edited_by: profile?.id }).eq('id', feedback!.id);

    if (err) {
      setError(err.code === '42P01'
        ? 'جدول نتائج الافتقاد غير موجود — شغّل تحديث قاعدة البيانات (0023)'
        : 'تعذر الحفظ، تأكد من الصلاحيات');
      setSaving(false);
      return;
    }
    invalidateLookup('call_feedbacks');
    onSaved();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-6">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-5 sm:rounded-3xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-extrabold">{mode === 'add' ? 'إضافة نتيجة افتقاد' : 'تعديل نتيجة الافتقاد'}</h3>
          <button onClick={onClose} aria-label="إغلاق" className="rounded-full p-1.5 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Live preview */}
        <div className="mb-4 flex items-center justify-center gap-3 rounded-2xl bg-slate-50 px-3 py-3">
          <span className="badge ring-1 ring-black/10" style={feedbackStyle(color)}>
            <CallFeedbackIcon icon={icon} /> {name.trim() || 'اسم النتيجة'}
          </span>
          <span
            className="flex items-center gap-2 rounded-xl border-2 px-3 py-2 text-sm font-extrabold"
            style={feedbackTintStyle(color)}
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-lg" style={feedbackStyle(color)}>
              <CallFeedbackIcon icon={icon} className="h-4 w-4" />
            </span>
            {name.trim() || 'اسم النتيجة'}
          </span>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <input
            id="feedback-name"
            className="input-field"
            placeholder="اسم النتيجة * (مثال: سيأتي الأسبوع القادم)"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            required
          />

          {/* Scope: church → service → class → event */}
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-500">الكنيسة *</label>
            <select
              className="input-field"
              value={churchId}
              onChange={(e) => { setChurchId(e.target.value); setServiceId(''); setClassId(''); setEventId(ALL); }}
              required
            >
              <option value="">اختر الكنيسة</option>
              {churches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-500">الخدمة *</label>
            <select
              className="input-field"
              value={serviceId}
              onChange={(e) => { setServiceId(e.target.value); setClassId(''); }}
              required
            >
              <option value="">اختر الخدمة</option>
              <option value={ALL}>✳ كل الخدمات</option>
              {filteredServices.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          {serviceId && serviceId !== ALL && (
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-500">الفصل *</label>
              <select className="input-field" value={classId} onChange={(e) => setClassId(e.target.value)} required>
                <option value="">اختر الفصل</option>
                <option value={ALL}>✳ كل الفصول</option>
                {filteredClasses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}
          {churchId && serviceId && (serviceId === ALL || classId) && (
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-500">المناسبة *</label>
              <select id="feedback-event" className="input-field" value={eventId} onChange={(e) => setEventId(e.target.value)}>
                <option value={ALL}>✳ كل المناسبات</option>
                {filteredEvents.map((ev) => (
                  <option key={ev.id} value={ev.id}>{ev.name} — {describeEventSchedule(ev)}</option>
                ))}
              </select>
            </div>
          )}

          {/* Color */}
          <div>
            <label className="mb-1 flex items-center gap-1 text-xs font-bold text-slate-500">
              <Palette className="h-3.5 w-3.5" /> اللون *
            </label>
            <div id="feedback-colors" className="grid grid-cols-9 gap-1.5">
              {CALL_FEEDBACK_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={c}
                  aria-pressed={color.toLowerCase() === c}
                  onClick={() => setColor(c)}
                  style={{ backgroundColor: c }}
                  className={`h-8 w-full rounded-lg transition active:scale-95 ${
                    color.toLowerCase() === c ? 'ring-2 ring-offset-2 ring-slate-800' : 'ring-1 ring-black/10'
                  }`}
                />
              ))}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <input
                type="color"
                aria-label="لون مخصص"
                value={isHexColor(color) ? color : '#6366f1'}
                onChange={(e) => setColor(e.target.value)}
                className="h-9 w-12 cursor-pointer rounded-lg border border-slate-200 bg-white p-0.5"
              />
              <input
                className="input-field !py-2 font-mono text-xs"
                dir="ltr"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                placeholder="#6366f1"
              />
            </div>
          </div>

          {/* Icon */}
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-500">الأيقونة *</label>
            <div id="feedback-icons" className="grid grid-cols-8 gap-1.5">
              {CALL_FEEDBACK_ICON_KEYS.map((k) => {
                const active = icon === k;
                return (
                  <button
                    key={k}
                    type="button"
                    aria-label={k}
                    aria-pressed={active}
                    onClick={() => setIcon(k)}
                    style={active ? feedbackStyle(color) : undefined}
                    className={`flex h-9 w-full items-center justify-center rounded-lg transition active:scale-95 ${
                      active ? 'shadow ring-2 ring-black/10' : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    <CallFeedbackIcon icon={k} className="h-4 w-4" />
                  </button>
                );
              })}
            </div>
          </div>

          {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{error}</p>}
          <button type="submit" disabled={saving} className="btn-primary flex w-full items-center justify-center gap-2">
            {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : mode === 'add' ? <Plus className="h-5 w-5" /> : <Save className="h-5 w-5" />}
            {mode === 'add' ? 'حفظ النتيجة' : 'حفظ التعديلات'}
          </button>
        </form>
      </div>
    </div>
  );
}
