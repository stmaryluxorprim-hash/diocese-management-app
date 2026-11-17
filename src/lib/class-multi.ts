// ---------- class-multi — helpers for the MULTI-select class selector ----------
// Every class selector of the app lets the user pick several classes at once.
// Convention used everywhere: an EMPTY array means «كل الفصول» (no class
// narrowing), a non-empty array is the set of chosen class ids.

export const ALL_CLASSES: string[] = [];

/** true when the selection narrows nothing */
export const isAllClasses = (sel: readonly string[] | null | undefined): boolean => !sel || sel.length === 0;

/** does a row bound to `classId` fall inside the selection? (empty selection = everything) */
export const inClasses = (sel: readonly string[] | null | undefined, classId: string | null | undefined): boolean =>
  isAllClasses(sel) || (!!classId && sel!.includes(classId));

/**
 * Same as `inClasses` but a record with NO class (church- / service-wide:
 * «كل الفصول») always matches — used for events, causes, exams, occasions …
 */
export const inClassesOrWide = (sel: readonly string[] | null | undefined, classId: string | null | undefined): boolean =>
  isAllClasses(sel) || classId === null || classId === undefined || sel!.includes(classId);

/** toggle one id in a selection */
export const toggleClass = (sel: readonly string[], id: string): string[] =>
  sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id];

/** keep only ids that still exist in `visible` (after the church / service changed) */
export const pruneClasses = (sel: readonly string[], visible: readonly { id: string }[]): string[] => {
  const ok = new Set(visible.map((v) => v.id));
  const next = sel.filter((x) => ok.has(x));
  return next.length === sel.length ? (sel as string[]) : next;
};

/** all chosen (or all visible when none chosen) ids */
export const effectiveClassIds = (sel: readonly string[], visible: readonly { id: string }[]): string[] =>
  sel.length > 0 ? [...sel] : visible.map((v) => v.id);

/** the single class when exactly one is chosen, else null (for APIs that only take one) */
export const singleClass = (sel: readonly string[] | null | undefined): string | null =>
  sel && sel.length === 1 ? sel[0] : null;

/** stable key for effect deps / cache keys */
export const classesKey = (sel: readonly string[] | null | undefined): string => (sel ? [...sel].sort().join(',') : '');

/** label shown on the closed dropdown */
export function classesLabel(sel: readonly string[], options: readonly { id: string; name: string }[], allLabel = 'كل الفصول'): string {
  if (sel.length === 0) return allLabel;
  if (sel.length === 1) return options.find((o) => o.id === sel[0])?.name ?? allLabel;
  return `${sel.length} فصول`;
}

/**
 * The class ids a scope narrows to, from either the new `classes` list or the
 * legacy single `class` ('all' / '' / undefined → no narrowing → []).
 */
export function classIdsOf(scope: { class?: string | null; classes?: readonly string[] | null } | null | undefined): string[] {
  if (!scope) return [];
  if (scope.classes && scope.classes.length > 0) return [...scope.classes];
  if (scope.class && scope.class !== 'all') return [scope.class];
  return [];
}

/**
 * RPC class arguments for the `stats_*` functions: exactly one class goes in
 * the legacy `p_class`, two or more in `p_classes`, none → both null.
 */
export function classRpcArgs(scope: { class?: string | null; classes?: readonly string[] | null } | null | undefined): {
  p_class: string | null;
  p_classes: string[] | null;
} {
  const ids = classIdsOf(scope);
  return { p_class: ids.length === 1 ? ids[0] : null, p_classes: ids.length > 1 ? ids : null };
}

/**
 * Class targets for a FORM that saves one record per class.
 * Empty selection → [null] (a single record with no class = «كل الفصول»),
 * otherwise one entry per chosen class id.
 */
export function classTargets(sel: readonly string[] | null | undefined): (string | null)[] {
  return sel && sel.length > 0 ? [...sel] : [null];
}

/** initial form selection from a record's single class id (null / ALL / '' → []) */
export function classSel(id: string | null | undefined): string[] {
  return id && id !== 'all' ? [id] : [];
}
