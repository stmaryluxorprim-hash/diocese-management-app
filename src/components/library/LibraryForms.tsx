'use client';

// ---------- Library — add / edit modals ----------
// SubjectFormModal : name · description · cover URL · audience
// BookFormModal    : title · author · description · cover URL · PDF URL · audience
// LectureFormModal : title · speaker · description · date · kind · media URL ·
//                    thumbnail URL · audience
// Everything is a LINK — there is no upload. `AudiencePicker` reuses the
// church → service → class lookups and locks what the profile can't reach.

import { useMemo, useState, type ReactNode } from 'react';
import { X, Save, Loader2, Library, BookOpen, Video, Mic, Link as LinkIcon, Globe, Users, Layers, School, Image as ImageIcon } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { saveClassGroup, type Grouped } from '@/lib/class-groups';
import { useAuth } from '@/lib/auth-context';
import {
  saveSubject, saveBook, saveLecture, deleteBook, deleteLecture, libraryErrorMessage, isValidUrl, autoThumbnail, AUDIENCE_LABELS, detectProvider, PROVIDER_LABELS,
  type Audience, type AudienceFields, type LibrarySubject, type LibraryBook, type LibraryLecture, type LectureKind,
} from '@/lib/library';
import { Cover } from '@/components/library/LibraryBits';
import { MultiClassSelect } from '@/components/MultiClassSelect';
import { classSel } from '@/lib/class-multi';
import type { Church, Service, ClassRoom } from '@/lib/types';

// ---------- shared bits ----------
function Modal({ title, icon, onClose, children, id }: { title: string; icon: ReactNode; onClose: () => void; children: ReactNode; id: string }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-6" onClick={onClose}>
      <div id={id} className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-5 sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-lg font-extrabold">{icon}{title}</h3>
          <button type="button" onClick={onClose} aria-label="إغلاق" className="rounded-full p-1.5 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Seg<T extends string>({ value, options, onChange, idPrefix, tone = 'lime' }: {
  value: T; options: { value: T; label: string; icon?: ReactNode }[]; onChange: (v: T) => void; idPrefix: string; tone?: 'lime' | 'rose' | 'sky';
}) {
  const active = { lime: 'bg-lime-700 ring-lime-300', rose: 'bg-rose-600 ring-rose-300', sky: 'bg-sky-600 ring-sky-300' }[tone];
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <button key={o.value} id={`${idPrefix}-${o.value}`} type="button" onClick={() => onChange(o.value)} aria-pressed={value === o.value}
          className={`flex h-10 items-center justify-center gap-1.5 rounded-xl text-xs font-extrabold transition active:scale-95 ${
            value === o.value ? `${active} text-white shadow ring-2` : 'bg-white text-slate-600 border border-slate-200'}`}>
          {o.icon} {o.label}
        </button>
      ))}
    </div>
  );
}

function UrlField({ id, label, value, onChange, required, placeholder, hint }: {
  id: string; label: string; value: string; onChange: (v: string) => void; required?: boolean; placeholder?: string; hint?: string;
}) {
  const provider = value.trim() ? detectProvider(value) : null;
  const bad = !!value.trim() && !isValidUrl(value);
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-bold text-slate-500">{label}{required && ' *'}</label>
      <div className="relative">
        <LinkIcon className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input id={id} className={`input-field pr-9 text-xs ${bad ? '!border-red-300' : ''}`} dir="ltr" type="url" inputMode="url"
          placeholder={placeholder ?? 'https://…'} value={value} onChange={(e) => onChange(e.target.value)} required={required} />
      </div>
      <p className="mt-1 text-[11px] font-bold text-slate-400">
        {bad ? <span className="text-red-500">الرابط غير صالح — يجب أن يبدأ بـ http أو https</span>
          : provider ? <span className="text-lime-700">{PROVIDER_LABELS[provider]}</span> : hint}
      </p>
    </div>
  );
}

// ---------- audience picker ----------
export function useAudienceState(init?: (AudienceFields & { class_ids?: string[] }) | null) {
  const { profile } = useAuth();
  const isOwner = profile?.role === 'owner';
  const [audience, setAudience] = useState<Audience>(init?.audience ?? 'everyone');
  const [churchId, setChurchId] = useState(init?.church_id ?? profile?.church_id ?? '');
  const [serviceId, setServiceId] = useState(init?.service_id ?? profile?.service_id ?? '');
  const [classIds, setClassIds] = useState<string[]>(init ? (init.class_ids ?? classSel(init.class_id)) : classSel(profile?.class_id));
  const churchLocked = !isOwner && !!profile?.church_id;
  const serviceLocked = !isOwner && profile?.role !== 'church_manager' && !!profile?.service_id;
  const classLocked = profile?.role === 'class_servant' && !!profile?.class_id;
  const scoped = audience === 'service' || audience === 'class';
  const fields = (): AudienceFields => ({
    audience,
    church_id: scoped ? churchId || null : null,
    service_id: scoped ? serviceId || null : null,
    class_id: audience === 'class' ? classIds[0] ?? null : null,
  });
  // one entry per chosen class (audience «فصل»); a single entry otherwise
  const fieldsAll = (): AudienceFields[] =>
    audience === 'class' && classIds.length > 1 ? classIds.map((cid) => ({ ...fields(), class_id: cid })) : [fields()];
  const validate = (): string | null => {
    if (scoped && (!churchId || !serviceId)) return 'اختر الكنيسة والخدمة';
    if (audience === 'class' && classIds.length === 0) return 'اختر فصلاً واحداً على الأقل';
    return null;
  };
  return { audience, setAudience, churchId, setChurchId, serviceId, setServiceId, classIds, setClassIds, churchLocked, serviceLocked, classLocked, fields, fieldsAll, validate };
}

export function AudiencePicker({ a, churches, services, classes, idPrefix }: {
  a: ReturnType<typeof useAudienceState>; churches: Church[]; services: Service[]; classes: ClassRoom[]; idPrefix: string;
}) {
  const visibleServices = useMemo(() => services.filter((s) => s.church_id === a.churchId), [services, a.churchId]);
  const visibleClasses = useMemo(() => classes.filter((c) => c.church_id === a.churchId && c.service_id === a.serviceId), [classes, a.churchId, a.serviceId]);
  const scoped = a.audience === 'service' || a.audience === 'class';
  return (
    <div>
      <label className="mb-1 block text-xs font-bold text-slate-500">من يرى هذا المحتوى؟</label>
      <Seg idPrefix={`${idPrefix}-aud`} value={a.audience} onChange={a.setAudience} options={[
        { value: 'everyone', label: AUDIENCE_LABELS.everyone, icon: <Globe className="h-3.5 w-3.5" /> },
        { value: 'servants', label: 'الخدام', icon: <Users className="h-3.5 w-3.5" /> },
        { value: 'service', label: 'خدمة', icon: <Layers className="h-3.5 w-3.5" /> },
        { value: 'class', label: 'فصل', icon: <School className="h-3.5 w-3.5" /> },
      ]} />
      {scoped && (
        <div className="mt-2 grid grid-cols-3 gap-2">
          <select id={`${idPrefix}-church`} className={`input-field !px-2 text-xs font-bold ${a.churchLocked ? 'pointer-events-none bg-primary-50 opacity-80' : ''}`}
            value={a.churchId} onChange={(e) => { a.setChurchId(e.target.value); a.setServiceId(''); a.setClassIds([]); }}>
            <option value="">الكنيسة</option>
            {churches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select id={`${idPrefix}-service`} className={`input-field !px-2 text-xs font-bold ${a.serviceLocked ? 'pointer-events-none bg-primary-50 opacity-80' : ''}`}
            value={a.serviceId} onChange={(e) => { a.setServiceId(e.target.value); a.setClassIds([]); }} disabled={!a.churchId}>
            <option value="">الخدمة</option>
            {visibleServices.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <MultiClassSelect id={`${idPrefix}-class`} className={a.classLocked ? 'pointer-events-none bg-primary-50 opacity-80' : ''}
            value={a.classIds} onChange={a.setClassIds} options={visibleClasses} showAll={false}
            allLabel={a.audience === 'class' ? 'الفصول' : '—'} disabled={a.audience !== 'class' || !a.serviceId} />
        </div>
      )}
      <p className="mt-1 text-[11px] font-bold text-slate-400">
        {a.audience === 'everyone' && 'يظهر لكل الخدام ولكل المخدومين في بوابتهم'}
        {a.audience === 'servants' && 'يظهر للخدام فقط — لا يظهر في بوابة المخدوم'}
        {a.audience === 'service' && 'يظهر لخدام هذه الخدمة ومخدوميها فقط'}
        {a.audience === 'class' && 'يظهر لخدام هذا الفصل ومخدوميه فقط'}
      </p>
    </div>
  );
}

interface Lookups { churches: Church[]; services: Service[]; classes: ClassRoom[] }

const SaveButton = ({ saving, label, cls = '!from-lime-700 !to-lime-600', id }: { saving: boolean; label: string; cls?: string; id: string }) => (
  <button id={id} type="submit" disabled={saving} className={`btn-primary flex w-full items-center justify-center gap-2 ${cls}`}>
    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} {label}
  </button>
);
const ErrorLine = ({ error }: { error: string }) => error ? <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{error}</p> : null;

// ---------- SUBJECT ----------
export function SubjectFormModal({ item, lookups, onClose, onSaved }: {
  item: LibrarySubject | null; lookups: Lookups; onClose: () => void; onSaved: (s: LibrarySubject) => void;
}) {
  const [supabase] = useState(() => createClient());
  const [name, setName] = useState(item?.name ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [imageUrl, setImageUrl] = useState(item?.image_url ?? '');
  const a = useAudienceState(item);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!name.trim()) return setError('اسم الموضوع مطلوب');
    if (imageUrl.trim() && !isValidUrl(imageUrl)) return setError('رابط الصورة غير صالح');
    const v = a.validate(); if (v) return setError(v);
    setSaving(true);
    try {
      const [first, ...rest] = a.fieldsAll();
      const body = { name: name.trim(), description: description.trim() || null, image_url: imageUrl.trim() || null };
      const saved = await saveSubject(supabase, item?.id ?? null, { ...body, ...first });
      for (const f of rest) await saveSubject(supabase, null, { ...body, ...f });
      onSaved(saved);
    } catch (err) { setError(libraryErrorMessage(err, 'تعذر الحفظ، تأكد من الصلاحيات')); setSaving(false); }
  };

  return (
    <Modal id="library-subject-form" title={item ? 'تعديل الموضوع' : 'إضافة موضوع'} icon={<Library className="h-5 w-5 text-lime-700" />} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div className="flex items-center gap-3">
          <Cover url={imageUrl.trim() || null} alt={name || 'موضوع'} className="h-20 w-24 shrink-0 rounded-2xl ring-1 ring-black/5" icon={<Library className="h-8 w-8" />} />
          <div className="flex-1"><UrlField id="lib-subject-image" label="رابط صورة الغلاف" value={imageUrl} onChange={setImageUrl} hint="صورة من أي رابط مباشر (اختياري)" /></div>
        </div>
        <input id="lib-subject-name" className="input-field" placeholder="اسم الموضوع * (مثال: الكتاب المقدس)" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
        <textarea id="lib-subject-desc" className="input-field" placeholder="وصف الموضوع (اختياري)" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        <AudiencePicker a={a} idPrefix="lib-subject" {...lookups} />
        <ErrorLine error={error} />
        <SaveButton id="lib-subject-save" saving={saving} label={item ? 'حفظ التعديلات' : 'إضافة الموضوع'} />
      </form>
    </Modal>
  );
}

// ---------- BOOK ----------
export function BookFormModal({ item, subjectId, subjects, lookups, onClose, onSaved }: {
  item: Grouped<LibraryBook> | null; subjectId: string; subjects: LibrarySubject[]; lookups: Lookups; onClose: () => void; onSaved: (b: LibraryBook) => void;
}) {
  const [supabase] = useState(() => createClient());
  const [subject, setSubject] = useState(item?.subject_id ?? subjectId);
  const [title, setTitle] = useState(item?.title ?? '');
  const [author, setAuthor] = useState(item?.author ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [coverUrl, setCoverUrl] = useState(item?.cover_url ?? '');
  const [pdfUrl, setPdfUrl] = useState(item?.pdf_url ?? '');
  const a = useAudienceState(item);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!subject) return setError('اختر الموضوع');
    if (!title.trim()) return setError('عنوان الكتاب مطلوب');
    if (!isValidUrl(pdfUrl)) return setError('رابط الكتاب (PDF) غير صالح');
    if (coverUrl.trim() && !isValidUrl(coverUrl)) return setError('رابط الغلاف غير صالح');
    const v = a.validate(); if (v) return setError(v);
    setSaving(true);
    try {
      const all = a.fieldsAll();
      const fieldsFor = (cid: string | null): AudienceFields => ({ ...all[0], class_id: cid });
      const body = {
        subject_id: subject, title: title.trim(), author: author.trim() || null, description: description.trim() || null,
        cover_url: coverUrl.trim() || null, pdf_url: pdfUrl.trim(),
      };
      // ONE book for all chosen classes: one row per class tied by group_id
      const saved = await saveClassGroup<LibraryBook>({
        existing: item?.group_rows,
        targets: all.map((f) => f.class_id),
        create: (cid, gid) => saveBook(supabase, null, { ...body, ...fieldsFor(cid) }, gid),
        update: (row, cid, gid) => saveBook(supabase, row.id, { ...body, ...fieldsFor(cid) }, gid),
        remove: (row) => deleteBook(supabase, row.id),
      });
      onSaved(saved[0]);
    } catch (err) { setError(libraryErrorMessage(err, 'تعذر الحفظ، تأكد من الصلاحيات')); setSaving(false); }
  };

  return (
    <Modal id="library-book-form" title={item ? 'تعديل الكتاب' : 'إضافة كتاب'} icon={<BookOpen className="h-5 w-5 text-lime-700" />} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div className="flex items-center gap-3">
          <Cover url={coverUrl.trim() || null} alt={title || 'كتاب'} className="h-28 w-20 shrink-0 rounded-xl ring-1 ring-black/5" icon={<BookOpen className="h-8 w-8" />} />
          <div className="flex-1"><UrlField id="lib-book-cover" label="رابط صورة الغلاف" value={coverUrl} onChange={setCoverUrl} hint="اختياري" /></div>
        </div>
        {subjects.length > 1 && (
          <select id="lib-book-subject" className="input-field text-sm font-bold" value={subject} onChange={(e) => setSubject(e.target.value)} required>
            <option value="">الموضوع *</option>
            {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
        <input id="lib-book-title" className="input-field" placeholder="عنوان الكتاب *" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} />
        <input id="lib-book-author" className="input-field" placeholder="المؤلف" value={author} onChange={(e) => setAuthor(e.target.value)} maxLength={120} />
        <textarea id="lib-book-desc" className="input-field" placeholder="وصف (اختياري)" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        <UrlField id="lib-book-pdf" label="رابط الكتاب (PDF)" value={pdfUrl} onChange={setPdfUrl} required hint="Google Drive · رابط PDF مباشر · أي رابط آخر" />
        <AudiencePicker a={a} idPrefix="lib-book" {...lookups} />
        <ErrorLine error={error} />
        <SaveButton id="lib-book-save" saving={saving} label={item ? 'حفظ التعديلات' : 'إضافة الكتاب'} />
      </form>
    </Modal>
  );
}

// ---------- LECTURE ----------
export function LectureFormModal({ item, subjectId, subjects, lookups, onClose, onSaved }: {
  item: Grouped<LibraryLecture> | null; subjectId: string; subjects: LibrarySubject[]; lookups: Lookups; onClose: () => void; onSaved: (l: LibraryLecture) => void;
}) {
  const [supabase] = useState(() => createClient());
  const [subject, setSubject] = useState(item?.subject_id ?? subjectId);
  const [title, setTitle] = useState(item?.title ?? '');
  const [speaker, setSpeaker] = useState(item?.speaker ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [date, setDate] = useState(item?.lecture_date ?? '');
  const [kind, setKind] = useState<LectureKind>(item?.kind ?? 'video');
  const [mediaUrl, setMediaUrl] = useState(item?.media_url ?? '');
  const [thumbUrl, setThumbUrl] = useState(item?.thumbnail_url ?? '');
  const a = useAudienceState(item);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const previewThumb = thumbUrl.trim() || (mediaUrl.trim() ? autoThumbnail(mediaUrl) : null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!subject) return setError('اختر الموضوع');
    if (!title.trim()) return setError('عنوان المحاضرة مطلوب');
    if (!isValidUrl(mediaUrl)) return setError('رابط المحاضرة غير صالح');
    if (thumbUrl.trim() && !isValidUrl(thumbUrl)) return setError('رابط الصورة غير صالح');
    const v = a.validate(); if (v) return setError(v);
    setSaving(true);
    try {
      const all = a.fieldsAll();
      const fieldsFor = (cid: string | null): AudienceFields => ({ ...all[0], class_id: cid });
      const body = {
        subject_id: subject, title: title.trim(), speaker: speaker.trim() || null, description: description.trim() || null,
        lecture_date: date || null, kind, media_url: mediaUrl.trim(), thumbnail_url: thumbUrl.trim() || null,
      };
      // ONE lecture for all chosen classes: one row per class tied by group_id
      const saved = await saveClassGroup<LibraryLecture>({
        existing: item?.group_rows,
        targets: all.map((f) => f.class_id),
        create: (cid, gid) => saveLecture(supabase, null, { ...body, ...fieldsFor(cid) }, gid),
        update: (row, cid, gid) => saveLecture(supabase, row.id, { ...body, ...fieldsFor(cid) }, gid),
        remove: (row) => deleteLecture(supabase, row.id),
      });
      onSaved(saved[0]);
    } catch (err) { setError(libraryErrorMessage(err, 'تعذر الحفظ، تأكد من الصلاحيات')); setSaving(false); }
  };

  return (
    <Modal id="library-lecture-form" title={item ? 'تعديل المحاضرة' : 'إضافة محاضرة'}
      icon={kind === 'video' ? <Video className="h-5 w-5 text-rose-600" /> : <Mic className="h-5 w-5 text-sky-600" />} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Seg idPrefix="lib-lecture-kind" value={kind} onChange={setKind} tone={kind === 'video' ? 'rose' : 'sky'} options={[
          { value: 'video', label: 'فيديو', icon: <Video className="h-4 w-4" /> },
          { value: 'voice', label: 'صوت', icon: <Mic className="h-4 w-4" /> },
        ]} />
        {subjects.length > 1 && (
          <select id="lib-lecture-subject" className="input-field text-sm font-bold" value={subject} onChange={(e) => setSubject(e.target.value)} required>
            <option value="">الموضوع *</option>
            {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
        <input id="lib-lecture-title" className="input-field" placeholder="عنوان المحاضرة *" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} />
        <input id="lib-lecture-speaker" className="input-field" placeholder="المتحدث" value={speaker} onChange={(e) => setSpeaker(e.target.value)} maxLength={120} />
        <textarea id="lib-lecture-desc" className="input-field" placeholder="وصف (اختياري)" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        <div>
          <label htmlFor="lib-lecture-date" className="mb-1 block text-xs font-bold text-slate-500">التاريخ</label>
          <input id="lib-lecture-date" type="date" className="input-field" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <UrlField id="lib-lecture-url" label={kind === 'video' ? 'رابط الفيديو' : 'رابط الصوت'} value={mediaUrl} onChange={setMediaUrl} required
          hint={kind === 'video' ? 'YouTube · Google Drive · رابط فيديو مباشر' : 'Google Drive · رابط MP3 مباشر · أي رابط صوتي'} />
        <div className="flex items-center gap-3">
          <Cover url={previewThumb} alt={title || 'محاضرة'} className="h-16 w-28 shrink-0 rounded-xl ring-1 ring-black/5" tone={kind === 'video' ? 'rose' : 'sky'} icon={<ImageIcon className="h-6 w-6" />} />
          <div className="flex-1">
            <UrlField id="lib-lecture-thumb" label="رابط الصورة المصغرة" value={thumbUrl} onChange={setThumbUrl}
              hint={mediaUrl && autoThumbnail(mediaUrl) ? 'اختياري — تُستخدم صورة YouTube / Drive تلقائياً' : 'اختياري'} />
          </div>
        </div>
        <AudiencePicker a={a} idPrefix="lib-lecture" {...lookups} />
        <ErrorLine error={error} />
        <SaveButton id="lib-lecture-save" saving={saving} label={item ? 'حفظ التعديلات' : 'إضافة المحاضرة'}
          cls={kind === 'video' ? '!from-rose-600 !to-rose-500' : '!from-sky-600 !to-sky-500'} />
      </form>
    </Modal>
  );
}
