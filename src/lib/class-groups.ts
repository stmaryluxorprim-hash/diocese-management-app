// ---------- class-groups — ONE record that covers SEVERAL classes ----------
// The database keeps one class per row (RLS, attendance, points and stats all
// depend on it). A record chosen for several classes is therefore stored as one
// row per class sharing a `group_id` (migration 20261023120000). The UI treats
// those rows as a single item: lists collapse them (`collapseGroups`), forms
// save them together (`saveClassGroup`) and deletes remove the whole group.

import type { SupabaseClient } from '@supabase/supabase-js';

export interface GroupRow { id: string; class_id: string | null; group_id?: string | null }

/** a list item standing for a whole group (or a single ungrouped row) */
export type Grouped<T extends GroupRow> = T & {
  /** every class the item covers ([] = no class: church / service wide) */
  class_ids: string[];
  /** the underlying rows (the item itself is the first of them) */
  group_rows: T[];
};

/** collapse rows sharing a group_id into one item (first row represents the group) */
export function collapseGroups<T extends GroupRow>(rows: readonly T[]): Grouped<T>[] {
  const out: Grouped<T>[] = [];
  const byGroup = new Map<string, Grouped<T>>();
  for (const r of rows) {
    const gid = r.group_id ?? null;
    const hit = gid ? byGroup.get(gid) : undefined;
    if (hit) {
      hit.group_rows.push(r);
      if (r.class_id) hit.class_ids.push(r.class_id);
      continue;
    }
    const item = Object.assign({}, r, { class_ids: r.class_id ? [r.class_id] : [], group_rows: [r] }) as Grouped<T>;
    out.push(item);
    if (gid) byGroup.set(gid, item);
  }
  return out;
}

/** the classes a (possibly collapsed) item covers */
export const classIdsOfItem = (r: { class_id: string | null; class_ids?: string[] }): string[] =>
  r.class_ids ?? (r.class_id ? [r.class_id] : []);

/** does the item cover this class? (no class on the item = covers all) */
export const itemCoversClass = (r: { class_id: string | null; class_ids?: string[] }, classId: string): boolean => {
  const ids = classIdsOfItem(r);
  return ids.length === 0 || ids.includes(classId);
};

/** the rows of an item (a plain row stands for itself) */
export const rowsOf = <T extends GroupRow>(r: T | Grouped<T>): T[] => ('group_rows' in r && r.group_rows ? (r.group_rows as T[]) : [r as T]);

const newGroupId = (): string =>
  (globalThis.crypto && 'randomUUID' in globalThis.crypto) ? globalThis.crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const v = (Math.random() * 16) | 0;
      return (c === 'x' ? v : (v & 0x3) | 0x8).toString(16);
    });

/**
 * Save ONE logical record for `targets` (one entry per class; `[null]` = no class).
 *  - creating: one row per target, sharing a fresh group_id when there are several;
 *  - editing:  rows of the group whose class is still chosen are UPDATED, new classes
 *    get new rows, classes that were un-ticked have their row deleted. A single
 *    ungrouped row that changes class is simply moved (the old single-edit behaviour).
 * Rows come back in target order, so `[0]` is the primary row.
 */
export async function saveClassGroup<T extends GroupRow>(opts: {
  existing?: readonly T[];
  targets: readonly (string | null)[];
  create: (classId: string | null, groupId: string | null) => Promise<T>;
  update: (row: T, classId: string | null, groupId: string | null) => Promise<T>;
  remove?: (row: T) => Promise<void>;
}): Promise<T[]> {
  const existing = [...(opts.existing ?? [])];
  const targets = opts.targets.length ? [...opts.targets] : [null];
  const multi = targets.length > 1;
  const groupId = multi ? (existing.find((r) => r.group_id)?.group_id ?? newGroupId()) : null;

  const used = new Set<string>();
  const match = (cid: string | null): T | undefined => existing.find((r) => !used.has(r.id) && r.class_id === cid);
  const plan = targets.map((cid) => {
    const row = match(cid);
    if (row) used.add(row.id);
    return { cid, row };
  });
  const leftovers = existing.filter((r) => !used.has(r.id));
  // editing a single plain record and moving it to another class → reuse that row
  if (existing.length === 1) {
    const free = plan.find((p) => !p.row);
    if (free && leftovers[0]) { free.row = leftovers[0]; leftovers.length = 0; }
  }

  const out: T[] = [];
  for (const p of plan) {
    out.push(p.row ? await opts.update(p.row, p.cid, groupId) : await opts.create(p.cid, groupId));
  }
  if (opts.remove) for (const r of leftovers) await opts.remove(r);
  return out;
}

/** delete the whole item (all rows of its group, or the single row) */
export async function deleteClassGroup(supabase: SupabaseClient, table: string, item: GroupRow): Promise<{ error: { message: string } | null }> {
  const q = supabase.from(table).delete();
  return item.group_id ? await q.eq('group_id', item.group_id) : await q.eq('id', item.id);
}

/** apply a patch (e.g. is_active) to the whole item */
export async function updateClassGroup(supabase: SupabaseClient, table: string, item: GroupRow, patch: Record<string, unknown>): Promise<{ error: { message: string } | null }> {
  const q = supabase.from(table).update(patch);
  return item.group_id ? await q.eq('group_id', item.group_id) : await q.eq('id', item.id);
}
