// ---------- REPORTS & TABLES (تقارير وجداول) — definition schema ----------
// A report = QUERY (what data) + DESIGN (how it looks on paper).
// The whole thing is a JSON document (`ReportDefinition`) — it is what a
// saved template stores (`report_templates.definition`, migration 0050) and
// what the wizard edits step by step:
//
//   1. source + filters  →  2. fields (pick · order · rename · filter · sort)
//   →  3. design (pages · elements · header / footer)  →  4. export
//
// Everything is versioned (`version: 1`) so future features (more chart
// kinds, calculations, scheduled runs, grouping…) can migrate old templates.
// All positions & sizes on paper are in MILLIMETERS.

// ===================================================================
// Data sources & fields
// ===================================================================

/** The datasets a report can be built on (registry in sources.ts). */
export type ReportSourceKey =
  | 'enrollments'   // المخدومون — one row per enrollment (person in a class)
  | 'attendance'    // سجل الحضور — one row per attendance
  | 'points'        // سجل النقاط — one row per points change
  | 'contacts'      // الافتقاد — calls / messages
  | 'exam_results'  // نتائج الامتحانات — one row per student of ONE exam
  | 'servants';     // الخدام — one row per servant enrollment

export type FieldType = 'text' | 'number' | 'date' | 'datetime' | 'bool' | 'image';

/** A column the dataset can provide. */
export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  /** UI grouping in the field picker (البيانات الأساسية · النطاق · الحضور والنقاط …) */
  group: string;
  /** relative column width weight in a table (1 = normal) */
  width?: number;
  /** on by default when the source is first chosen */
  defaultOn?: boolean;
  /** number formatting hint */
  digits?: number;
  /** may be summed / averaged in totals & charts */
  numeric?: boolean;
}

/** A field the user chose for the table (order = array order). */
export interface SelectedField {
  key: string;
  /** column title (defaults to FieldDef.label) */
  title?: string;
  /** width weight override */
  width?: number;
  /** text alignment override */
  align?: 'right' | 'center' | 'left';
}

export type FilterOp =
  | 'contains' | 'not_contains' | 'eq' | 'neq'
  | 'gt' | 'gte' | 'lt' | 'lte'
  | 'empty' | 'not_empty';

export interface RowFilter {
  id: string;
  field: string;
  op: FilterOp;
  value: string;
}

export interface SortRule {
  field: string;
  dir: 'asc' | 'desc';
}

/** church → service → class; '' = all (RLS still bounds what comes back) */
export interface ReportScope {
  church: string;
  service: string;
  /** legacy single class of older saved templates — read through `reportClassIds` */
  class: string;
  /** MULTI-select of classes (empty / undefined = all); wins over `class` */
  classes?: string[];
}

/** the class ids a report scope narrows to ([] = every class) */
export const reportClassIds = (scope: Pick<ReportScope, 'class' | 'classes'>): string[] =>
  scope.classes && scope.classes.length > 0 ? scope.classes : scope.class ? [scope.class] : [];

/**
 * Source-specific filters. Optional keys — each source reads the ones it
 * understands (see `ReportSource.filters` in sources.ts).
 */
export interface ReportFilters {
  from?: string;         // YYYY-MM-DD
  to?: string;           // YYYY-MM-DD
  event?: string;        // events.id
  cause?: string;        // causes.id
  exam?: string;         // result_exams.id
  gender?: 'male' | 'female' | '';
  status?: 'active' | 'stopped' | '';
  kind?: 'child' | 'servant' | 'all';
  contactKind?: 'call' | 'whatsapp' | 'sms' | 'internal' | '';
  pointsSign?: 'add' | 'remove' | '';
  role?: string;
  servantStatus?: string;
}

export interface ReportQuery {
  source: ReportSourceKey;
  scope: ReportScope;
  filters: ReportFilters;
  fields: SelectedField[];
  rowFilters: RowFilter[];
  sort: SortRule[];
  /** hard cap on rows pulled from the DB */
  limit: number;
}

// ===================================================================
// Design
// ===================================================================

export type PaperKey = 'A4' | 'A5' | 'A3' | 'Letter';
export type Orientation = 'portrait' | 'landscape';

export const PAPERS: Record<PaperKey, { label: string; w: number; h: number }> = {
  A4: { label: 'A4', w: 210, h: 297 },
  A5: { label: 'A5', w: 148, h: 210 },
  A3: { label: 'A3', w: 297, h: 420 },
  Letter: { label: 'Letter', w: 215.9, h: 279.4 },
};

export type ElementType =
  | 'title'     // big heading text
  | 'text'      // paragraph — supports {variables}
  | 'image'     // uploaded / linked picture
  | 'logo'      // church logo (scope)
  | 'table'     // the data table (flows over pages)
  | 'chart'     // bar / pie / line over the data
  | 'line'      // horizontal rule
  | 'rect';     // background box

export type TextAlign = 'right' | 'center' | 'left';

export interface TextStyle {
  fontSize: number;      // pt
  bold: boolean;
  italic?: boolean;
  color: string;         // #rrggbb
  align: TextAlign;
  bg?: string;           // background color ('' = none)
  borderColor?: string;  // '' = none
  radius?: number;       // mm
}

export type ChartKind = 'bar' | 'column' | 'pie' | 'donut' | 'line';
export type Aggregate = 'count' | 'sum' | 'avg' | 'min' | 'max';

export interface ChartConfig {
  kind: ChartKind;
  /** group rows by this field (category) */
  categoryField: string;
  /** numeric field to aggregate — '' with aggregate 'count' = row count */
  valueField: string;
  aggregate: Aggregate;
  /** keep the N biggest groups (0 = all) */
  topN: number;
  showLegend: boolean;
  showValues: boolean;
  title?: string;
  colors?: string[];
}

export interface TableConfig {
  fontSize: number;        // pt
  rowHeight: number;       // mm
  headerHeight: number;    // mm
  headerBg: string;
  headerColor: string;
  striped: boolean;
  borders: boolean;
  showIndex: boolean;      // running number column
  showTotals: boolean;     // sum row for numeric columns
  /** continue on new pages when rows overflow (repeats the header) */
  flow: boolean;
  /** cell border color */
  borderColor: string;
}

export interface ReportElement {
  id: string;
  type: ElementType;
  x: number; y: number; w: number; h: number;   // mm
  /** text / title: content — supports {variable} placeholders */
  text?: string;
  style?: TextStyle;
  /** image: url; logo ignores it */
  imageUrl?: string;
  imageFit?: 'contain' | 'cover' | 'stretch';
  table?: TableConfig;
  chart?: ChartConfig;
  /** line / rect color + thickness */
  color?: string;
  thickness?: number;       // mm
  /** stacking order (higher = on top) */
  z?: number;
}

export interface ReportPage {
  id: string;
  /** null → design default */
  orientation: Orientation | null;
  elements: ReportElement[];
}

export interface HeaderFooter {
  enabled: boolean;
  height: number;       // mm
  text: string;         // supports {variables} · {page} · {pages}
  style: TextStyle;
  showLogo?: boolean;   // header only
  showLine: boolean;    // separator line
}

export interface ReportDesign {
  paper: PaperKey;
  orientation: Orientation;
  margins: { top: number; right: number; bottom: number; left: number }; // mm
  header: HeaderFooter;
  footer: HeaderFooter;
  pageNumbers: { enabled: boolean; format: string; align: TextAlign }; // e.g. 'صفحة {page} من {pages}'
  fontFamily: string;
  pages: ReportPage[];
  /** the report's own title (variable {report_title}) */
  title: string;
}

// ===================================================================
// Whole document
// ===================================================================

export interface ReportDefinition {
  version: 1;
  query: ReportQuery;
  design: ReportDesign;
}

// ===================================================================
// Saved templates (migration 0050)
// ===================================================================

export interface ReportTemplate {
  id: string;
  church_id: string | null;
  service_id: string | null;
  class_id: string | null;
  name: string;
  description: string | null;
  source: string;
  definition: ReportDefinition;
  is_default: boolean;
  created_at: string;
  created_by: string | null;
  edited_at: string;
  edited_by: string | null;
}

// ===================================================================
// Runtime rows
// ===================================================================

/** One record of a dataset — keys = FieldDef.key */
export type ReportRow = Record<string, unknown>;

/** Names the engine needs to label scope / variables */
export interface ReportContext {
  churchName: string;
  serviceName: string;
  className: string;
  churchLogoUrl: string | null;
  eventName?: string;
  examName?: string;
  userName?: string;
  sourceLabel: string;
}

// ===================================================================
// Helpers / defaults
// ===================================================================

export const uid = () => Math.random().toString(36).slice(2, 10);

export const DEFAULT_TEXT_STYLE: TextStyle = {
  fontSize: 11, bold: false, italic: false, color: '#1e293b', align: 'right', bg: '', borderColor: '', radius: 0,
};

export const DEFAULT_TABLE: TableConfig = {
  fontSize: 9, rowHeight: 7, headerHeight: 8, headerBg: '#4f46e5', headerColor: '#ffffff',
  striped: true, borders: true, showIndex: true, showTotals: false, flow: true, borderColor: '#cbd5e1',
};

export const DEFAULT_CHART: ChartConfig = {
  kind: 'column', categoryField: '', valueField: '', aggregate: 'count', topN: 10,
  showLegend: true, showValues: true, title: '',
};

export const CHART_COLORS = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#64748b'];

export const FILTER_OP_LABELS: Record<FilterOp, string> = {
  contains: 'يحتوي', not_contains: 'لا يحتوي', eq: 'يساوي', neq: 'لا يساوي',
  gt: 'أكبر من', gte: 'أكبر من أو يساوي', lt: 'أصغر من', lte: 'أصغر من أو يساوي',
  empty: 'فارغ', not_empty: 'غير فارغ',
};

export const CHART_KIND_LABELS: Record<ChartKind, string> = {
  column: 'أعمدة', bar: 'أشرطة أفقية', pie: 'دائري', donut: 'حلقي', line: 'خطي',
};

export const AGGREGATE_LABELS: Record<Aggregate, string> = {
  count: 'العدد', sum: 'المجموع', avg: 'المتوسط', min: 'الأدنى', max: 'الأعلى',
};

export const ELEMENT_LABELS: Record<ElementType, string> = {
  title: 'عنوان', text: 'نص', image: 'صورة', logo: 'شعار الكنيسة', table: 'جدول', chart: 'رسم بياني', line: 'خط', rect: 'مربع',
};

/** paper size of a page after orientation */
export function pageSize(design: ReportDesign, page?: ReportPage | null): { w: number; h: number; orientation: Orientation } {
  const p = PAPERS[design.paper] ?? PAPERS.A4;
  const orientation = page?.orientation ?? design.orientation;
  return orientation === 'landscape' ? { w: p.h, h: p.w, orientation } : { w: p.w, h: p.h, orientation };
}

export function defaultDesign(title = 'تقرير'): ReportDesign {
  return {
    paper: 'A4',
    orientation: 'portrait',
    margins: { top: 12, right: 12, bottom: 12, left: 12 },
    header: {
      enabled: true, height: 14, text: '{church_name} — {service_name}', showLogo: true, showLine: true,
      style: { ...DEFAULT_TEXT_STYLE, fontSize: 10, bold: true, color: '#475569', align: 'right' },
    },
    footer: {
      enabled: true, height: 10, text: 'طُبع في {today}', showLine: true,
      style: { ...DEFAULT_TEXT_STYLE, fontSize: 8, color: '#64748b', align: 'right' },
    },
    pageNumbers: { enabled: true, format: 'صفحة {page} من {pages}', align: 'center' },
    fontFamily: 'Cairo',
    title,
    pages: [{
      id: uid(),
      orientation: null,
      elements: [
        {
          id: uid(), type: 'title', x: 12, y: 30, w: 186, h: 14, text: '{report_title}',
          style: { ...DEFAULT_TEXT_STYLE, fontSize: 20, bold: true, color: '#312e81', align: 'center' },
        },
        {
          id: uid(), type: 'text', x: 12, y: 46, w: 186, h: 8,
          text: '{scope_label} · {period_label} · إجمالي السجلات: {count}',
          style: { ...DEFAULT_TEXT_STYLE, fontSize: 10, color: '#64748b', align: 'center' },
        },
        { id: uid(), type: 'table', x: 12, y: 58, w: 186, h: 220, table: { ...DEFAULT_TABLE } },
      ],
    }],
  };
}

export function defaultQuery(source: ReportSourceKey = 'enrollments'): ReportQuery {
  return {
    source,
    scope: { church: '', service: '', class: '', classes: [] },
    filters: { kind: 'child', status: 'active' },
    fields: [],
    rowFilters: [],
    sort: [],
    limit: 5000,
  };
}

export function defaultDefinition(source: ReportSourceKey = 'enrollments'): ReportDefinition {
  return { version: 1, query: defaultQuery(source), design: defaultDesign() };
}

/** Upgrade / sanitise a definition coming from storage (older versions, missing keys). */
export function normalizeDefinition(raw: unknown): ReportDefinition {
  const d = (raw ?? {}) as Partial<ReportDefinition>;
  const base = defaultDefinition((d.query?.source as ReportSourceKey) ?? 'enrollments');
  const query: ReportQuery = {
    ...base.query, ...(d.query ?? {}),
    scope: (() => {
      const sc = { ...base.query.scope, ...(d.query?.scope ?? {}) };
      // older templates stored ONE class → lift it into the list
      const ids = reportClassIds(sc);
      return { ...sc, class: ids.length === 1 ? ids[0] : '', classes: ids };
    })(),
    filters: { ...base.query.filters, ...(d.query?.filters ?? {}) },
    fields: Array.isArray(d.query?.fields) ? d.query!.fields : [],
    rowFilters: Array.isArray(d.query?.rowFilters) ? d.query!.rowFilters : [],
    sort: Array.isArray(d.query?.sort) ? d.query!.sort : [],
  };
  const design: ReportDesign = {
    ...base.design, ...(d.design ?? {}),
    margins: { ...base.design.margins, ...(d.design?.margins ?? {}) },
    header: { ...base.design.header, ...(d.design?.header ?? {}), style: { ...base.design.header.style, ...(d.design?.header?.style ?? {}) } },
    footer: { ...base.design.footer, ...(d.design?.footer ?? {}), style: { ...base.design.footer.style, ...(d.design?.footer?.style ?? {}) } },
    pageNumbers: { ...base.design.pageNumbers, ...(d.design?.pageNumbers ?? {}) },
    pages: Array.isArray(d.design?.pages) && d.design!.pages.length > 0
      ? d.design!.pages.map((p) => ({ id: p.id ?? uid(), orientation: p.orientation ?? null, elements: Array.isArray(p.elements) ? p.elements : [] }))
      : base.design.pages,
  };
  return { version: 1, query, design };
}
