'use client';

// ---------- REPORTS & TABLES (تقارير وجداول) ----------
// ONE page, two tabs:
//   تقرير جديد — the 4-step wizard:
//     1 البيانات  : source · scope (church → service → class) · filters → load
//     2 الحقول    : pick / order / rename / width / align · row filters · sort · live preview · quick Excel
//     3 التصميم   : pages · elements (title · text · logo · image · table · chart · line · rect) · header / footer · page numbers
//     4 التصدير   : full preview · PDF · Excel · Print · save as template
//   القوالب — saved designs; «استخدام» loads the design and jumps to step 1
//             so the user only picks the new scope / filters and runs it.
// URL: ?tab=templates · ?template=<id>

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2, FilePlus2, LayoutTemplate, ChevronLeft, ChevronRight, AlertTriangle } from 'lucide-react';
import AppShell from '@/components/AppShell';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth-context';
import { usePermissions } from '@/lib/permissions-context';
import { useDebouncedRealtime } from '@/lib/realtime';
import { cachedLookup } from '@/lib/queries';
import type { Church, Service, ClassRoom, AppEvent, Cause, CallFeedback } from '@/lib/types';
import { fetchResultExams, type ResultExam } from '@/lib/results';
import {
  type ReportDefinition, type ReportQuery, type ReportDesign, type ReportTemplate, type ReportRow, type FieldDef, type ReportContext,
  defaultDefinition, normalizeDefinition, reportClassIds,
} from '@/lib/reports/types';
import { singleClass } from '@/lib/class-multi';
import { REPORT_SOURCES, SOURCE_BY_KEY, subjectFieldsFor, type ReportLookups } from '@/lib/reports/sources';
import { applyQuery, buildVariables } from '@/lib/reports/engine';
import { exportExcel, safeFile } from '@/lib/reports/export-excel';
import { fetchTemplates, saveTemplate, deleteTemplate, reportErrorMessage, isMigrationMissing, MIGRATION_HINT } from '@/lib/reports/templates';
import { ReportHeader, Stepper, Toast, type StepKey } from '@/components/reports/ReportBits';
import { DataStep } from '@/components/reports/DataStep';
import { FieldsStep } from '@/components/reports/FieldsStep';
import { DesignStep } from '@/components/reports/DesignStep';
import { ExportStep } from '@/components/reports/ExportStep';
import { TemplatesList, SaveTemplateModal, type SaveTemplateValues } from '@/components/reports/TemplatesPanel';

type Tab = 'new' | 'templates';

export default function ReportsPage() {
  return (
    <AppShell>
      <Suspense fallback={<div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary-500" /></div>}>
        <ReportsInner />
      </Suspense>
    </AppShell>
  );
}

function ReportsInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { profile, church: myChurch } = useAuth();
  const { has } = usePermissions();
  const [supabase] = useState(() => createClient());
  const approved = profile?.status === 'approved';
  const isManager = profile?.role === 'owner' || profile?.role === 'church_manager' || profile?.role === 'service_manager';
  const canTemplates = isManager || has('reports.templates');

  const tab: Tab = params.get('tab') === 'templates' ? 'templates' : 'new';
  const setTab = (t: Tab) => router.replace(t === 'new' ? '/reports' : '/reports?tab=templates', { scroll: false });

  const [toast, setToast] = useState<string | null>(null);
  const [toastTone, setToastTone] = useState<'dark' | 'error'>('dark');
  const flash = useCallback((m: string, tone: 'dark' | 'error' = 'dark') => { setToast(m); setToastTone(tone); setTimeout(() => setToast(null), 3000); }, []);

  // ---------- lookups ----------
  const [lookups, setLookups] = useState<ReportLookups>({ churches: [], services: [], classes: [], events: [], causes: [], feedbacks: [] });
  const [exams, setExams] = useState<ResultExam[]>([]);
  const [examsLoading, setExamsLoading] = useState(false);
  useEffect(() => {
    if (!approved) return;
    (async () => {
      const [churches, services, classes, events, causes, feedbacks] = await Promise.all([
        cachedLookup<Church>(supabase, 'churches'), cachedLookup<Service>(supabase, 'services'), cachedLookup<ClassRoom>(supabase, 'classes'),
        cachedLookup<AppEvent>(supabase, 'events'), cachedLookup<Cause>(supabase, 'causes'), cachedLookup<CallFeedback>(supabase, 'call_feedbacks').catch(() => [] as CallFeedback[]),
      ]);
      setLookups({ churches, services, classes, events, causes, feedbacks });
    })();
  }, [supabase, approved]);

  // ---------- definition (the document being edited) ----------
  const [def, setDef] = useState<ReportDefinition>(() => defaultDefinition('enrollments'));
  const [templateId, setTemplateId] = useState<string | null>(null);   // editing an existing template
  const [step, setStep] = useState<StepKey>('data');
  const [rows, setRows] = useState<ReportRow[] | null>(null);
  const [running, setRunning] = useState(false);
  const [search, setSearch] = useState('');
  const [subjectFields, setSubjectFields] = useState<FieldDef[]>([]);
  const [migrationMissing, setMigrationMissing] = useState(false);

  const source = SOURCE_BY_KEY[def.query.source] ?? REPORT_SOURCES[0];
  const setQuery = useCallback((patch: Partial<ReportQuery>) => {
    setDef((d) => {
      const q = { ...d.query, ...patch };
      // switching source → fresh defaults for the fields (keep scope / period)
      if (patch.source && patch.source !== d.query.source) {
        const s = SOURCE_BY_KEY[patch.source];
        q.fields = s.fields.filter((f) => f.defaultOn).map((f) => ({ key: f.key }));
        q.rowFilters = []; q.sort = [];
        q.filters = { ...d.query.filters, event: '', cause: '', exam: '', kind: patch.source === 'enrollments' ? 'child' : d.query.filters.kind };
        setRows(null); setSubjectFields([]);
      }
      return { ...d, query: q };
    });
  }, []);
  const setDesign = useCallback((design: ReportDesign) => setDef((d) => ({ ...d, design })), []);

  // default fields when the page opens
  useEffect(() => {
    if (def.query.fields.length === 0 && templateId === null && rows === null) {
      setQuery({ fields: source.fields.filter((f) => f.defaultOn).map((f) => ({ key: f.key })) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def.query.source]);

  // exams list (for the exam_results source)
  useEffect(() => {
    if (!approved || def.query.source !== 'exam_results' || exams.length > 0) return;
    setExamsLoading(true);
    fetchResultExams(supabase).then(setExams).catch(() => setExams([])).finally(() => setExamsLoading(false));
  }, [approved, def.query.source, supabase, exams.length]);

  // per-subject fields of the chosen exam
  useEffect(() => {
    if (def.query.source !== 'exam_results' || !def.query.filters.exam) { setSubjectFields([]); return; }
    subjectFieldsFor(supabase, def.query.filters.exam).then((fs) => {
      setSubjectFields(fs);
      // add the subject columns right before the totals (only when the user hasn't customised)
      setDef((d) => {
        const have = new Set(d.query.fields.map((f) => f.key));
        const missing = fs.filter((f) => !have.has(f.key));
        if (missing.length === 0) return d;
        const fields = [...d.query.fields.filter((f) => !f.key.startsWith('subject:') || fs.some((s) => s.key === f.key))];
        const at = Math.max(0, fields.findIndex((f) => f.key === 'total_score'));
        fields.splice(at === -1 ? fields.length : at, 0, ...missing.map((f) => ({ key: f.key })));
        return { ...d, query: { ...d.query, fields } };
      });
    }).catch(() => setSubjectFields([]));
  }, [def.query.source, def.query.filters.exam, supabase]);

  const fieldDefs = useMemo<FieldDef[]>(() => {
    if (def.query.source !== 'exam_results' || subjectFields.length === 0) return source.fields;
    const at = source.fields.findIndex((f) => f.key === 'total_score');
    return [...source.fields.slice(0, at), ...subjectFields, ...source.fields.slice(at)];
  }, [source, subjectFields, def.query.source]);
  const defs = useMemo(() => new Map(fieldDefs.map((f) => [f.key, f])), [fieldDefs]);

  // ---------- run ----------
  const run = async () => {
    if (!approved) return;
    setRunning(true);
    try {
      const data = await source.load(supabase, def.query.scope, def.query.filters, lookups, def.query.limit);
      setRows(data);
      if (def.query.sort.length === 0 && source.defaultSort) setQuery({ sort: source.defaultSort });
      setStep('fields');
      setMigrationMissing(false);
      flash(`تم تحميل ${data.length.toLocaleString('ar-EG')} سجل`);
    } catch (e) {
      if (isMigrationMissing(e)) setMigrationMissing(true);
      flash(reportErrorMessage(e, 'فشل تحميل البيانات'), 'error');
    } finally { setRunning(false); }
  };

  const visibleRows = useMemo(() => (rows ? applyQuery(rows, def.query, defs, search) : []), [rows, def.query, defs, search]);
  const finalRows = useMemo(() => (rows ? applyQuery(rows, def.query, defs) : []), [rows, def.query, defs]);

  // ---------- context / variables ----------
  const ctx = useMemo<ReportContext>(() => {
    const { scope, filters } = def.query;
    const church = lookups.churches.find((c) => c.id === scope.church) ?? (lookups.churches.length === 1 ? lookups.churches[0] : null) ?? myChurch;
    return {
      churchName: scope.church ? church?.name ?? '' : lookups.churches.length === 1 ? lookups.churches[0].name : '',
      serviceName: lookups.services.find((s) => s.id === scope.service)?.name ?? '',
      className: reportClassIds(scope).map((id) => lookups.classes.find((c) => c.id === id)?.name ?? '').filter(Boolean).join('، '),
      churchLogoUrl: church?.logo_url ?? null,
      eventName: filters.event ? lookups.events.find((e) => e.id === filters.event)?.name : undefined,
      examName: filters.exam ? exams.find((x) => x.id === filters.exam)?.name : undefined,
      userName: profile?.full_name ?? '',
      sourceLabel: source.label,
    };
  }, [def.query, lookups, myChurch, exams, profile?.full_name, source.label]);
  const vars = useMemo(() => buildVariables(def.query, def.design, finalRows, ctx), [def.query, def.design, finalRows, ctx]);

  const quickExcel = async () => {
    try {
      await exportExcel(visibleRows, def.query.fields, defs, {
        fileName: safeFile(def.design.title || source.label), sheetName: source.label,
        headerLines: [def.design.title || source.label, vars.scope_label, vars.period_label], showIndex: true,
      });
    } catch (e) { flash(`فشل التصدير: ${(e as Error).message}`, 'error'); }
  };

  // ---------- templates ----------
  const [templates, setTemplates] = useState<ReportTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const loadTemplates = useCallback(async () => {
    if (!approved) return;
    try { setTemplates(await fetchTemplates(supabase)); setMigrationMissing(false); }
    catch (e) { if (isMigrationMissing(e)) setMigrationMissing(true); setTemplates([]); }
    finally { setTemplatesLoading(false); }
  }, [supabase, approved]);
  useEffect(() => { loadTemplates(); }, [loadTemplates]);
  useDebouncedRealtime(supabase, 'report-templates', [{ table: 'report_templates' }], loadTemplates, { enabled: approved && !migrationMissing });

  const [saveOpen, setSaveOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const useTemplate = useCallback((t: ReportTemplate) => {
    const d = normalizeDefinition(t.definition);
    setDef(d); setTemplateId(t.id); setRows(null); setSearch(''); setStep('data'); setTab('new');
    flash(`تم تحميل القالب «${t.name}» — اختر النطاق والفلاتر ثم حمّل البيانات`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ?template=<id> deep link
  useEffect(() => {
    const id = params.get('template');
    if (!id || templates.length === 0) return;
    const t = templates.find((x) => x.id === id);
    if (t && templateId !== t.id) { useTemplate(t); router.replace('/reports', { scroll: false }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, templates]);

  const onSaveTemplate = async (v: SaveTemplateValues) => {
    setSaving(true);
    try {
      const t = await saveTemplate(supabase, templateId, { ...v, description: v.description || null, definition: def }, profile?.id);
      setTemplateId(t.id);
      setSaveOpen(false);
      flash(templateId ? 'تم تحديث القالب' : 'تم حفظ القالب');
      loadTemplates();
    } catch (e) { flash(reportErrorMessage(e, 'فشل حفظ القالب'), 'error'); }
    finally { setSaving(false); }
  };
  const onDeleteTemplate = async (t: ReportTemplate) => {
    if (!confirm(`حذف القالب «${t.name}»؟`)) return;
    try { await deleteTemplate(supabase, t.id); if (templateId === t.id) setTemplateId(null); flash('تم حذف القالب'); loadTemplates(); }
    catch (e) { flash(reportErrorMessage(e, 'فشل الحذف'), 'error'); }
  };
  const startNew = () => { setDef(defaultDefinition('enrollments')); setTemplateId(null); setRows(null); setSearch(''); setStep('data'); setTab('new'); };

  const editingTemplate = templateId ? templates.find((t) => t.id === templateId) : undefined;
  const stepEnabled: Record<StepKey, boolean> = { data: true, fields: rows !== null, design: rows !== null, export: rows !== null };
  const stepIdx = ['data', 'fields', 'design', 'export'].indexOf(step);
  const next = () => { const order: StepKey[] = ['data', 'fields', 'design', 'export']; const n = order[stepIdx + 1]; if (n && stepEnabled[n]) setStep(n); };
  const prev = () => { const order: StepKey[] = ['data', 'fields', 'design', 'export']; const p = order[stepIdx - 1]; if (p) setStep(p); };

  const saveInitial: SaveTemplateValues = {
    name: editingTemplate?.name ?? def.design.title ?? '',
    description: editingTemplate?.description ?? '',
    church_id: editingTemplate ? editingTemplate.church_id : (def.query.scope.church || profile?.church_id || (lookups.churches.length === 1 ? lookups.churches[0].id : null)),
    service_id: editingTemplate ? editingTemplate.service_id : (def.query.scope.service || null),
    class_id: editingTemplate ? editingTemplate.class_id : (singleClass(reportClassIds(def.query.scope)) || null),
    is_default: editingTemplate?.is_default ?? false,
  };

  return (
    <>
      <ReportHeader
        title={tab === 'new' ? (editingTemplate ? `قالب: ${editingTemplate.name}` : 'تقرير جديد') : 'القوالب'}
        right={tab === 'new' && (editingTemplate || rows) ? (
          <button type="button" onClick={startNew} className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-[11px] font-extrabold text-slate-600">تقرير جديد</button>
        ) : undefined}
      />

      <nav id="report-tabs" className="mb-3 grid grid-cols-2 gap-2">
        {([{ key: 'new', label: 'تقرير جديد', icon: FilePlus2 }, { key: 'templates', label: 'القوالب', icon: LayoutTemplate, badge: templates.length }] as const).map((t) => (
          <button key={t.key} id={`report-tab-${t.key}`} type="button" onClick={() => setTab(t.key)} aria-current={tab === t.key ? 'page' : undefined}
            className={`flex h-11 items-center justify-center gap-2 rounded-xl text-sm font-extrabold transition active:scale-95 ${tab === t.key ? 'bg-fuchsia-600 text-white shadow ring-2 ring-fuchsia-300' : 'bg-white text-slate-600 border border-slate-200'}`}>
            <t.icon className="h-4 w-4" /> {t.label}
            {'badge' in t && t.badge > 0 && <span className={`badge ${tab === t.key ? 'bg-white/20 text-white' : 'bg-fuchsia-100 text-fuchsia-700'}`}>{t.badge}</span>}
          </button>
        ))}
      </nav>

      {migrationMissing && (
        <div className="mb-3 flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-xs font-bold text-amber-800 ring-1 ring-amber-200">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {MIGRATION_HINT}
        </div>
      )}

      {tab === 'templates' ? (
        <TemplatesList templates={templates} loading={templatesLoading} onUse={useTemplate} onDelete={onDeleteTemplate}
          onEdit={(t) => { useTemplate(t); }} canManage={canTemplates} lookups={lookups} />
      ) : (
        <>
          <Stepper step={step} onStep={setStep} enabled={stepEnabled} />

          {step === 'data' && (
            <DataStep query={def.query} onChange={setQuery} lookups={lookups} exams={exams} examsLoading={examsLoading} onRun={run} running={running} rowsCount={rows?.length ?? null} />
          )}
          {step === 'fields' && rows && (
            <FieldsStep query={def.query} onChange={setQuery} fieldDefs={fieldDefs} rows={rows} previewRows={visibleRows} totalRows={rows.length}
              onExportExcel={quickExcel} search={search} onSearch={setSearch} />
          )}
          {step === 'design' && rows && (
            <DesignStep design={def.design} onChange={setDesign} rows={finalRows} defs={defs} vars={vars} fields={def.query.fields} logoUrl={ctx.churchLogoUrl} supabase={supabase} flash={(m) => flash(m)} />
          )}
          {step === 'export' && rows && (
            <ExportStep def={def} rows={finalRows} defs={defs} vars={vars} logoUrl={ctx.churchLogoUrl} onSaveTemplate={() => setSaveOpen(true)} canSaveTemplate={canTemplates && !migrationMissing}
              flash={(m) => flash(m, 'error')} excelHeader={[def.design.title || source.label, vars.scope_label, vars.period_label]} />
          )}

          {/* prev / next */}
          {rows && (
            <div className="mt-3 flex gap-2 print:hidden">
              <button type="button" onClick={prev} disabled={stepIdx === 0} className="btn-secondary flex flex-1 items-center justify-center gap-1 !py-2.5 text-sm disabled:opacity-40"><ChevronRight className="h-4 w-4" /> السابق</button>
              <button id="report-next" type="button" onClick={next} disabled={stepIdx === 3} className="btn-primary flex flex-1 items-center justify-center gap-1 !from-fuchsia-600 !to-fuchsia-500 !py-2.5 text-sm disabled:opacity-40">التالي <ChevronLeft className="h-4 w-4" /></button>
            </div>
          )}
        </>
      )}

      {saveOpen && (
        <SaveTemplateModal initial={saveInitial} existing={!!editingTemplate} onClose={() => setSaveOpen(false)} onSave={onSaveTemplate} saving={saving}
          lookups={lookups} canShareAll={profile?.role === 'owner'} />
      )}
      <Toast msg={toast} tone={toastTone} />
    </>
  );
}
