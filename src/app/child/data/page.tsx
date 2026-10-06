'use client';

// ---------- Child portal — البيانات ----------
// The child's data card: photo, QR (national id), fields. He can:
//   • upload a new photo (crop → webp → storage) → photo request (pending)
//   • request a change of name / birthdate / gender / phone / address
// Both go to data_change_requests and are approved / denied by the class
// servant, service manager or church manager. Request history is shown.

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import QRCode from 'qrcode';
import {
  Database, QrCode, Camera, Pencil, Loader2, Check, X, Clock, User, Phone, MapPin,
  CalendarDays, IdCard, Download, AlertCircle, CheckCircle2, History, Ban, Trash2,
} from 'lucide-react';
import ChildShell from '@/components/child/ChildShell';
import { Avatar, PageTitle, fmtDateTime, usePortalList } from '@/components/child/ChildBits';
import PhotoCropModal from '@/components/PhotoCropModal';
import { ModalFrame } from '@/components/PersonDataModals';
import { useChild } from '@/lib/child-context';
import { createClient } from '@/lib/supabase/client';
import { uploadPhoto } from '@/lib/upload';
import {
  fetchChildRequests, submitChildRequest, cancelChildRequest, childErrorMessage, ageFromBirthdate,
  REQUEST_STATUS_LABELS, REQUEST_KIND_LABELS, FIELD_LABELS,
  type DataChangeRequest, type RequestStatus,
} from '@/lib/child-portal';
import { GENDER_LABELS, PHONE_LOCAL_LENGTH, PHONE_PREFIX, type Gender } from '@/lib/types';

const STATUS_STYLE: Record<RequestStatus, string> = {
  pending: 'bg-gold-100 text-gold-700',
  approved: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-600',
  cancelled: 'bg-slate-100 text-slate-500',
};

/** Normalize a raw phone into +2XXXXXXXXXXX or null; undefined = invalid */
const normalizePhone = (raw: string): string | null | undefined => {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  let local = digits;
  if (local.startsWith('20') && local.length === 13) local = local.slice(2);
  else if (local.startsWith('2') && local.length === 12) local = local.slice(1);
  if (local.length === PHONE_LOCAL_LENGTH - 1 && local.startsWith('1')) local = `0${local}`;
  if (local.length !== PHONE_LOCAL_LENGTH) return undefined;
  return `${PHONE_PREFIX}${local}`;
};

const displayValue = (field: string, v: string | null | undefined) => {
  if (v === null || v === undefined || v === '') return '—';
  if (field === 'gender') return GENDER_LABELS[v as Gender] ?? v;
  return v;
};

export default function ChildDataPage() {
  return (
    <ChildShell>
      <DataContent />
    </ChildShell>
  );
}

function DataContent() {
  const { token, profile } = useChild();
  const supabase = useMemo(() => createClient(), []);

  const { rows: requests, reload: reloadRequests } = usePortalList<DataChangeRequest>(
    token ? () => fetchChildRequests(supabase, token) : null,
    `req-${token}`
  );

  // 20261016120000: no `postgres_changes` any more (publication emptied;
  // the child has no auth session for the private bus). `usePortalList`
  // already reloads the requests when the tab regains focus, the profile
  // refreshes on focus in ChildProvider, and a decision also arrives as a
  // push notification — so the list is fresh whenever the child looks.
  // QR
  const [qr, setQr] = useState('');
  useEffect(() => {
    if (!profile) return;
    QRCode.toDataURL(profile.person.national_id, { margin: 1, width: 512, errorCorrectionLevel: 'M' })
      .then(setQr)
      .catch(() => setQr(''));
  }, [profile?.person.national_id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Photo flow
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [flash, setFlash] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 5000);
    return () => clearTimeout(t);
  }, [flash]);

  const [editOpen, setEditOpen] = useState(false);
  const [cancelBusy, setCancelBusy] = useState<string | null>(null);

  if (!profile || !token) return null;
  const { person } = profile;
  const pendingPhoto = requests?.find((r) => r.kind === 'photo' && r.status === 'pending');
  const pendingData = requests?.find((r) => r.kind === 'data' && r.status === 'pending');
  const age = ageFromBirthdate(person.birthdate);

  const onPickPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (pendingPhoto) {
      setFlash({ type: 'err', text: 'لديك طلب تغيير صورة قيد المراجعة بالفعل' });
      return;
    }
    setCropSrc(URL.createObjectURL(f));
  };

  const onCropped = async (blob: Blob) => {
    if (cropSrc) URL.revokeObjectURL(cropSrc);
    setCropSrc(null);
    setPhotoBusy(true);
    try {
      const url = await uploadPhoto(supabase, 'child-requests', blob, `${person.id}.webp`);
      await submitChildRequest(supabase, token, 'photo', { image_url: url });
      setFlash({ type: 'ok', text: 'تم إرسال الصورة الجديدة — ستظهر بعد موافقة الخادم' });
      reloadRequests();
    } catch (e) {
      setFlash({ type: 'err', text: childErrorMessage(e, 'تعذر رفع الصورة، حاول مجدداً') });
    } finally {
      setPhotoBusy(false);
    }
  };

  const cancelReq = async (r: DataChangeRequest) => {
    setCancelBusy(r.id);
    try {
      await cancelChildRequest(supabase, token, r.id);
      reloadRequests();
    } catch (e) {
      setFlash({ type: 'err', text: childErrorMessage(e) });
    } finally {
      setCancelBusy(null);
    }
  };

  const fields = [
    { key: 'name', icon: <User className="h-4 w-4 text-primary-600" />, value: person.name },
    { key: 'gender', icon: <User className="h-4 w-4 text-primary-600" />, value: displayValue('gender', person.gender) },
    { key: 'birthdate', icon: <CalendarDays className="h-4 w-4 text-primary-600" />, value: person.birthdate ? `${person.birthdate}${age !== null ? ` (${age} سنة)` : ''}` : '—' },
    { key: 'phone', icon: <Phone className="h-4 w-4 text-primary-600" />, value: person.phone ?? '—', ltr: true },
    { key: 'address', icon: <MapPin className="h-4 w-4 text-primary-600" />, value: person.address ?? '—' },
  ];

  return (
    <>
      <PageTitle
        icon={<Database className="h-5 w-5 text-primary-600" />}
        title="بياناتي"
        sub="كارتك وصورتك وبياناتك — أي تعديل يُرسل للخادم للموافقة"
      />

      {flash && (
        <p className={`mb-3 flex items-start gap-2 rounded-xl px-3 py-2.5 text-sm font-bold ${
          flash.type === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'
        }`}>
          {flash.type === 'ok' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}
          {flash.text}
        </p>
      )}

      {/* ID card: photo + QR */}
      <section id="child-card" className="card mb-4 overflow-hidden !p-0">
        <div className="bg-gradient-to-l from-primary-600 to-accent-600 px-4 py-3 text-white flex items-center gap-2">
          <IdCard className="h-5 w-5" />
          <span className="font-extrabold">كارت المخدوم</span>
        </div>
        <div className="flex items-center gap-4 p-4">
          {/* Photo + change button */}
          <div className="relative">
            <Avatar person={person} size={112} className="ring-4 ring-white shadow-lg" />
            <label
              id="child-photo-btn"
              className={`absolute -bottom-2 -left-2 flex h-10 w-10 cursor-pointer items-center justify-center rounded-full shadow-lg transition active:scale-95 ${
                photoBusy || pendingPhoto ? 'bg-slate-200 text-slate-400' : 'bg-gold-500 text-white hover:bg-gold-600'
              }`}
              title={pendingPhoto ? 'صورة قيد المراجعة' : 'تغيير الصورة'}
            >
              {photoBusy ? <Loader2 className="h-5 w-5 animate-spin" /> : pendingPhoto ? <Clock className="h-5 w-5" /> : <Camera className="h-5 w-5" />}
              <input type="file" accept="image/*" className="hidden" onChange={onPickPhoto} disabled={photoBusy || !!pendingPhoto} />
            </label>
          </div>
          {/* QR */}
          <div className="flex flex-1 flex-col items-center">
            {qr ? (
              <Image src={qr} alt="QR" width={128} height={128} unoptimized className="rounded-xl border border-slate-100" />
            ) : (
              <div className="flex h-32 w-32 items-center justify-center rounded-xl bg-slate-50"><QrCode className="h-8 w-8 text-slate-300" /></div>
            )}
            <p className="mt-1 text-[10px] font-bold text-slate-400" dir="ltr">{person.national_id}</p>
          </div>
        </div>
        <div className="border-t border-indigo-50 px-4 py-2.5 flex items-center justify-between">
          <p className="truncate font-extrabold">{person.name}</p>
          {qr && (
            <a
              id="child-qr-download"
              href={qr}
              download={`qr-${person.national_id}.png`}
              className="flex items-center gap-1 rounded-lg bg-primary-50 px-2.5 py-1.5 text-xs font-bold text-primary-700 hover:bg-primary-100"
            >
              <Download className="h-3.5 w-3.5" /> حفظ الكود
            </a>
          )}
        </div>
        {pendingPhoto && (
          <div className="flex items-center gap-3 border-t border-gold-100 bg-gold-50 px-4 py-2.5 text-xs font-bold text-gold-700">
            <div className="relative h-10 w-10 overflow-hidden rounded-lg ring-1 ring-gold-200">
              <Image src={pendingPhoto.changes.image_url ?? ''} alt="الصورة الجديدة" fill sizes="40px" className="object-cover" />
            </div>
            <span className="flex-1">صورة جديدة قيد المراجعة — ستظهر بعد موافقة الخادم</span>
            <button
              onClick={() => cancelReq(pendingPhoto)}
              disabled={cancelBusy === pendingPhoto.id}
              className="rounded-lg bg-white px-2 py-1 text-red-600 hover:bg-red-50"
              aria-label="إلغاء طلب الصورة"
            >
              {cancelBusy === pendingPhoto.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            </button>
          </div>
        )}
      </section>

      {/* Data fields */}
      <section className="mb-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-extrabold text-slate-500">البيانات</h3>
          <button
            id="child-edit-data-btn"
            onClick={() => setEditOpen(true)}
            disabled={!!pendingData}
            className="flex items-center gap-1 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-extrabold text-white shadow hover:bg-primary-700 disabled:bg-slate-200 disabled:text-slate-400"
          >
            {pendingData ? <Clock className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
            {pendingData ? 'طلب قيد المراجعة' : 'طلب تعديل'}
          </button>
        </div>
        <div className="card !p-0 divide-y divide-indigo-50 overflow-hidden">
          {fields.map((f) => {
            const proposed = pendingData?.changes[f.key];
            return (
              <div key={f.key} className="flex items-center gap-3 px-4 py-3">
                <span className="rounded-lg bg-slate-50 p-2">{f.icon}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-bold text-slate-400">{FIELD_LABELS[f.key]}</p>
                  <p className="truncate text-sm font-extrabold" dir={f.ltr ? 'ltr' : undefined} style={f.ltr ? { textAlign: 'right' } : undefined}>{f.value}</p>
                  {pendingData && f.key in pendingData.changes && (
                    <p className="mt-0.5 truncate text-[11px] font-bold text-gold-700">
                      ← مطلوب: {displayValue(f.key, proposed)}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Requests history */}
      <section className="mb-4">
        <h3 className="mb-2 flex items-center gap-1.5 text-sm font-extrabold text-slate-500">
          <History className="h-4 w-4" /> طلباتي
        </h3>
        {!requests ? (
          <div className="flex justify-center py-6"><Loader2 className="h-6 w-6 animate-spin text-primary-500" /></div>
        ) : requests.length === 0 ? (
          <div className="card text-center text-sm font-bold text-slate-400">لا توجد طلبات بعد</div>
        ) : (
          <div className="space-y-2">
            {requests.map((r) => (
              <div key={r.id} className="card !p-3">
                <div className="flex items-center gap-2">
                  <span className={`badge ${STATUS_STYLE[r.status]}`}>{REQUEST_STATUS_LABELS[r.status]}</span>
                  <span className="text-xs font-extrabold">{REQUEST_KIND_LABELS[r.kind]}</span>
                  <span className="mr-auto text-[11px] font-bold text-slate-400">{fmtDateTime(r.created_at)}</span>
                </div>
                {r.kind === 'photo' ? (
                  <div className="mt-2 flex items-center gap-3">
                    <div className="relative h-14 w-14 overflow-hidden rounded-xl ring-1 ring-slate-200">
                      {r.changes.image_url && <Image src={r.changes.image_url} alt="الصورة المقترحة" fill sizes="56px" className="object-cover" />}
                    </div>
                    <p className="text-xs text-slate-500">صورة جديدة للكارت</p>
                  </div>
                ) : (
                  <ul className="mt-2 space-y-1 text-xs">
                    {Object.keys(r.changes).map((k) => (
                      <li key={k} className="flex flex-wrap items-center gap-1">
                        <span className="font-bold text-slate-500">{FIELD_LABELS[k] ?? k}:</span>
                        <span className="text-slate-400 line-through">{displayValue(k, r.previous[k])}</span>
                        <span className="text-slate-300">←</span>
                        <span className="font-extrabold">{displayValue(k, r.changes[k])}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {r.note && <p className="mt-1.5 text-[11px] text-slate-500">ملاحظتك: {r.note}</p>}
                {r.decision_note && (
                  <p className="mt-1.5 rounded-lg bg-slate-50 px-2 py-1 text-[11px] font-bold text-slate-600">رد الخادم: {r.decision_note}</p>
                )}
                {r.status === 'pending' && (
                  <button
                    onClick={() => cancelReq(r)}
                    disabled={cancelBusy === r.id}
                    className="mt-2 flex items-center gap-1 text-xs font-bold text-red-600 hover:underline"
                  >
                    {cancelBusy === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />}
                    إلغاء الطلب
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {cropSrc && (
        <PhotoCropModal
          src={cropSrc}
          onDone={onCropped}
          onClose={() => { URL.revokeObjectURL(cropSrc); setCropSrc(null); }}
        />
      )}

      {editOpen && (
        <EditRequestModal
          person={person}
          onClose={() => setEditOpen(false)}
          onSubmit={async (changes, note) => {
            await submitChildRequest(supabase, token, 'data', changes, note);
            setEditOpen(false);
            setFlash({ type: 'ok', text: 'تم إرسال طلب التعديل — سيراجعه الخادم' });
            reloadRequests();
          }}
        />
      )}
    </>
  );
}

// ---------- Request-a-change modal ----------
function EditRequestModal({
  person, onClose, onSubmit,
}: {
  person: { name: string; birthdate: string | null; gender: Gender | null; phone: string | null; address: string | null };
  onClose: () => void;
  onSubmit: (changes: Record<string, string | null>, note: string) => Promise<void>;
}) {
  const [name, setName] = useState(person.name);
  const [gender, setGender] = useState<Gender | ''>(person.gender ?? '');
  const [birthdate, setBirthdate] = useState(person.birthdate ?? '');
  const [phone, setPhone] = useState(person.phone ?? '');
  const [address, setAddress] = useState(person.address ?? '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setError('');
    if (!name.trim()) { setError('الاسم مطلوب'); return; }
    const normPhone = normalizePhone(phone);
    if (normPhone === undefined) { setError(`رقم الهاتف يجب أن يكون ${PHONE_LOCAL_LENGTH} رقماً (01xxxxxxxxx)`); return; }

    const changes: Record<string, string | null> = {};
    if (name.trim() !== person.name) changes.name = name.trim();
    if ((gender || null) !== person.gender) changes.gender = gender || null;
    if ((birthdate || null) !== person.birthdate) changes.birthdate = birthdate || null;
    if (normPhone !== person.phone) changes.phone = normPhone;
    if ((address.trim() || null) !== person.address) changes.address = address.trim() || null;
    if (Object.keys(changes).length === 0) { setError('لم تغيّر أي بيانات'); return; }

    setBusy(true);
    try {
      await onSubmit(changes, note.trim());
    } catch (e) {
      setError(childErrorMessage(e));
      setBusy(false);
    }
  };

  return (
    <ModalFrame title="طلب تعديل البيانات" icon={<Pencil className="h-5 w-5 text-primary-600" />} onClose={onClose}>
      <div className="space-y-3">
        <p className="rounded-xl bg-primary-50 px-3 py-2 text-xs font-bold text-primary-700">
          غيّر ما تريد ثم أرسل الطلب — لن يسري التعديل إلا بعد موافقة خادم الفصل أو مسؤول الخدمة أو مدير الكنيسة.
        </p>
        <div>
          <label htmlFor="req-name" className="mb-1 block text-xs font-bold text-slate-500">الاسم</label>
          <input id="req-name" className="input-field" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor="req-gender" className="mb-1 block text-xs font-bold text-slate-500">النوع</label>
            <select id="req-gender" className="input-field" value={gender} onChange={(e) => setGender(e.target.value as Gender | '')}>
              <option value="">—</option>
              <option value="male">ذكر</option>
              <option value="female">أنثى</option>
            </select>
          </div>
          <div>
            <label htmlFor="req-birthdate" className="mb-1 block text-xs font-bold text-slate-500">تاريخ الميلاد</label>
            <input id="req-birthdate" type="date" className="input-field" value={birthdate} onChange={(e) => setBirthdate(e.target.value)} />
          </div>
        </div>
        <div>
          <label htmlFor="req-phone" className="mb-1 block text-xs font-bold text-slate-500">الهاتف</label>
          <input id="req-phone" className="input-field" dir="ltr" placeholder="01xxxxxxxxx" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div>
          <label htmlFor="req-address" className="mb-1 block text-xs font-bold text-slate-500">العنوان</label>
          <input id="req-address" className="input-field" value={address} onChange={(e) => setAddress(e.target.value)} />
        </div>
        <div>
          <label htmlFor="req-note" className="mb-1 block text-xs font-bold text-slate-500">ملاحظة للخادم (اختياري)</label>
          <textarea id="req-note" className="input-field" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{error}</p>}
        <div className="flex gap-2">
          <button onClick={onClose} className="btn-secondary flex-1 flex items-center justify-center gap-1">
            <X className="h-4 w-4" /> إلغاء
          </button>
          <button id="req-submit" onClick={submit} disabled={busy} className="btn-primary flex-1 flex items-center justify-center gap-1">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} إرسال الطلب
          </button>
        </div>
      </div>
    </ModalFrame>
  );
}
