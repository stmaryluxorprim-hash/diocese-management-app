'use client';

// ---------- App customization context (تخصيص التطبيق) ----------
// Loads the owner's customization from `app_settings` (migrations 0035/0036):
//   • 'navigation' — the 5 taskbar slots + header icons
//   • 'widgets'    — the home-page widgets (order · size · heading)
//   • 'names'      — custom display names of every destination
//   • 'codes'      — the code system (templates per generator + scope abbreviations, 0040)
// keeps them fresh in realtime and RESOLVES them for the signed-in user: a
// taskbar slot / widget bound to a module hidden from him is skipped or falls
// back, header widgets vanish when the module isn't granted, and every label
// goes through the custom names so renaming a module in the taskbar renames
// it on its page and in every menu.
//
// Falls back to the defaults when the migration isn't applied yet.

import {
  createContext, useContext, useEffect, useMemo, useState, useCallback, type ReactNode,
} from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth-context';
import { useDebouncedRealtime } from '@/lib/realtime';
import { useBootstrapConfig } from '@/lib/bootstrap';
import { useModules } from '@/lib/modules-context';
import {
  DEFAULT_NAVIGATION, NAVIGATION_SETTING_KEY, NAMES_SETTING_KEY, normalizeNavigation, normalizeNames,
  resolveTaskbar, resolveMenuRest, resolveHeader, destLabel, CORE_KEYS, OWNER_DEST,
  type NavigationConfig, type NamesConfig, type ResolvedNavItem, type ResolvedHeaderItem,
} from '@/lib/navigation';
import {
  DEFAULT_WIDGETS, WIDGETS_SETTING_KEY, normalizeWidgets, resolveWidgets,
  type WidgetsConfig, type ResolvedWidget,
} from '@/lib/widgets';
import {
  DEFAULT_CODES, CODES_SETTING_KEY, normalizeCodes, generateCode as renderCode,
  type CodesConfig, type CodeKind, type CodeContext,
} from '@/lib/code-templates';

interface CustomizationState {
  navigation: NavigationConfig;
  /** true when a saved navigation layout exists (false = defaults) */
  customized: boolean;
  widgetsConfig: WidgetsConfig;
  widgetsCustomized: boolean;
  /** custom display names { destination key → label } */
  names: NamesConfig;
  /** the code system (نظام الأكواد) */
  codes: CodesConfig;
  codesCustomized: boolean;
  /** generate a code for a generator using the owner's design (legacy when unset) */
  generateCode: (kind: CodeKind, ctx?: CodeContext) => string;
  /** destination keys the signed-in user may see */
  allowed: Set<string>;
  taskbar: ResolvedNavItem[];
  menuRest: ResolvedNavItem[];
  header: ResolvedHeaderItem[];
  /** home-page widgets resolved for this user */
  widgets: ResolvedWidget[];
  /** display name of a destination (custom → default) */
  label: (key: string) => string;
  loading: boolean;
  reload: () => Promise<void>;
  /** OWNER ONLY — persist (RLS rejects everybody else) */
  saveNavigation: (cfg: NavigationConfig) => Promise<string | null>;
  resetNavigation: () => Promise<string | null>;
  saveWidgets: (cfg: WidgetsConfig) => Promise<string | null>;
  resetWidgets: () => Promise<string | null>;
  saveNames: (names: NamesConfig) => Promise<string | null>;
  saveCodes: (cfg: CodesConfig) => Promise<string | null>;
  resetCodes: () => Promise<string | null>;
}

const defaultAllowed = new Set<string>(CORE_KEYS);

const CustomizationContext = createContext<CustomizationState>({
  navigation: DEFAULT_NAVIGATION,
  customized: false,
  widgetsConfig: DEFAULT_WIDGETS,
  widgetsCustomized: false,
  names: {},
  codes: DEFAULT_CODES,
  codesCustomized: false,
  generateCode: (kind, ctx) => renderCode(null, kind, ctx),
  allowed: defaultAllowed,
  taskbar: resolveTaskbar(DEFAULT_NAVIGATION, defaultAllowed),
  menuRest: [],
  header: resolveHeader(DEFAULT_NAVIGATION, defaultAllowed),
  widgets: resolveWidgets(DEFAULT_WIDGETS, new Set(), undefined),
  label: (key) => destLabel(key, {}),
  loading: true,
  reload: async () => {},
  saveNavigation: async () => 'not ready',
  resetNavigation: async () => 'not ready',
  saveWidgets: async () => 'not ready',
  resetWidgets: async () => 'not ready',
  saveNames: async () => 'not ready',
  saveCodes: async () => 'not ready',
  resetCodes: async () => 'not ready',
});

const SETTING_KEYS = [NAVIGATION_SETTING_KEY, WIDGETS_SETTING_KEY, NAMES_SETTING_KEY, CODES_SETTING_KEY];

export function CustomizationProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const { visibleModules, loading: modulesLoading } = useModules();
  const [supabase] = useState(() => createClient());
  const [navigation, setNavigation] = useState<NavigationConfig>(DEFAULT_NAVIGATION);
  const [customized, setCustomized] = useState(false);
  const [widgetsConfig, setWidgetsConfig] = useState<WidgetsConfig>(DEFAULT_WIDGETS);
  const [widgetsCustomized, setWidgetsCustomized] = useState(false);
  const [names, setNames] = useState<NamesConfig>({});
  const [codes, setCodes] = useState<CodesConfig>(DEFAULT_CODES);
  const [codesCustomized, setCodesCustomized] = useState(false);
  const [loading, setLoading] = useState(true);
  const approved = profile?.status === 'approved';

  const applyDefaults = () => {
    setNavigation(DEFAULT_NAVIGATION); setCustomized(false);
    setWidgetsConfig(DEFAULT_WIDGETS); setWidgetsCustomized(false);
    setNames({});
    setCodes(DEFAULT_CODES); setCodesCustomized(false);
  };

  const applyRows = (rows: { key: string; value: unknown }[]) => {
    const byKey = new Map(rows.map((r) => [r.key, r.value]));
    const nav = byKey.get(NAVIGATION_SETTING_KEY);
    setNavigation(nav ? normalizeNavigation(nav) : DEFAULT_NAVIGATION);
    setCustomized(!!nav);
    const wid = byKey.get(WIDGETS_SETTING_KEY);
    setWidgetsConfig(wid ? normalizeWidgets(wid) : DEFAULT_WIDGETS);
    setWidgetsCustomized(!!wid);
    setNames(normalizeNames(byKey.get(NAMES_SETTING_KEY)));
    const cod = byKey.get(CODES_SETTING_KEY);
    setCodes(cod ? normalizeCodes(cod) : DEFAULT_CODES);
    setCodesCustomized(!!cod);
  };

  const reload = useCallback(async () => {
    if (!approved) { applyDefaults(); setLoading(false); return; }
    const { data, error } = await supabase
      .from('app_settings')
      .select('key, value')
      .in('key', SETTING_KEYS);
    if (error || !data) applyDefaults(); // migration missing → defaults
    else applyRows(data as { key: string; value: unknown }[]);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, approved]);

  // 20261015120000: the four settings arrive with app_bootstrap() — no own
  // request on open; `reload()` is the realtime / fallback path only.
  const { config: boot, version: bootVersion } = useBootstrapConfig();
  useEffect(() => {
    if (!approved) { applyDefaults(); setLoading(false); return; }
    if (boot) { applyRows(boot.app_settings); setLoading(false); return; }
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approved, bootVersion, reload]);

  useDebouncedRealtime(
    supabase, 'app-settings', [{ table: 'app_settings' }], reload,
    { enabled: approved, delayMs: 400 }
  );

  const upsert = useCallback(async (key: string, value: unknown): Promise<string | null> => {
    const { error } = await supabase
      .from('app_settings')
      .upsert({ key, value, updated_by: profile?.id ?? null }, { onConflict: 'key' });
    return error ? error.message : null;
  }, [supabase, profile?.id]);

  const remove = useCallback(async (key: string): Promise<string | null> => {
    const { error } = await supabase.from('app_settings').delete().eq('key', key);
    return error ? error.message : null;
  }, [supabase]);

  const saveNames = useCallback(async (next: NamesConfig): Promise<string | null> => {
    const value = normalizeNames(next);
    const err = Object.keys(value).length === 0
      ? await remove(NAMES_SETTING_KEY)
      : await upsert(NAMES_SETTING_KEY, value);
    if (err) return err;
    setNames(value);
    return null;
  }, [upsert, remove]);

  const saveNavigation = useCallback(async (cfg: NavigationConfig): Promise<string | null> => {
    const value = normalizeNavigation(cfg);
    // A label typed on a taskbar slot IS the module's name everywhere: move
    // it into `names` (so the page title and every menu follow) and keep the
    // slot label-free — the resolver falls back to the global name.
    const nextNames: NamesConfig = { ...names };
    let namesChanged = false;
    for (const slot of value.taskbar) {
      if (slot.label !== undefined) {
        if (nextNames[slot.key] !== slot.label) { nextNames[slot.key] = slot.label; namesChanged = true; }
        delete slot.label;
      }
    }
    const err = await upsert(NAVIGATION_SETTING_KEY, value);
    if (err) return err;
    setNavigation(value);
    setCustomized(true);
    if (namesChanged) return saveNames(nextNames);
    return null;
  }, [upsert, names, saveNames]);

  const resetNavigation = useCallback(async (): Promise<string | null> => {
    const err = await remove(NAVIGATION_SETTING_KEY);
    if (err) return err;
    setNavigation(DEFAULT_NAVIGATION);
    setCustomized(false);
    return null;
  }, [remove]);

  const saveWidgets = useCallback(async (cfg: WidgetsConfig): Promise<string | null> => {
    const value = normalizeWidgets(cfg);
    const err = await upsert(WIDGETS_SETTING_KEY, value);
    if (err) return err;
    setWidgetsConfig(value);
    setWidgetsCustomized(true);
    return null;
  }, [upsert]);

  const resetWidgets = useCallback(async (): Promise<string | null> => {
    const err = await remove(WIDGETS_SETTING_KEY);
    if (err) return err;
    setWidgetsConfig(DEFAULT_WIDGETS);
    setWidgetsCustomized(false);
    return null;
  }, [remove]);

  const saveCodes = useCallback(async (cfg: CodesConfig): Promise<string | null> => {
    const value = normalizeCodes(cfg);
    const err = await upsert(CODES_SETTING_KEY, value);
    if (err) return err;
    setCodes(value);
    setCodesCustomized(true);
    return null;
  }, [upsert]);

  const resetCodes = useCallback(async (): Promise<string | null> => {
    const err = await remove(CODES_SETTING_KEY);
    if (err) return err;
    setCodes(DEFAULT_CODES);
    setCodesCustomized(false);
    return null;
  }, [remove]);

  // destination keys this user may see
  const allowed = useMemo(() => {
    const s = new Set<string>(CORE_KEYS);
    if (profile?.role === 'owner') s.add(OWNER_DEST.key);
    visibleModules.forEach((m) => s.add(m.key));
    return s;
  }, [profile?.role, visibleModules]);

  const moduleKeys = useMemo(() => new Set(visibleModules.map((m) => m.key)), [visibleModules]);

  const value = useMemo<CustomizationState>(() => {
    const taskbar = resolveTaskbar(navigation, allowed, names);
    return {
      navigation, customized, widgetsConfig, widgetsCustomized, names, allowed, taskbar,
      menuRest: resolveMenuRest(taskbar, allowed, names),
      header: resolveHeader(navigation, allowed, names),
      widgets: resolveWidgets(widgetsConfig, moduleKeys, profile?.role),
      label: (key: string) => destLabel(key, names),
      codes, codesCustomized,
      generateCode: (kind: CodeKind, ctx?: CodeContext) => renderCode(codesCustomized ? codes : null, kind, ctx),
      loading: loading || modulesLoading,
      reload, saveNavigation, resetNavigation, saveWidgets, resetWidgets, saveNames, saveCodes, resetCodes,
    };
  }, [
    navigation, customized, widgetsConfig, widgetsCustomized, names, codes, codesCustomized, allowed, moduleKeys,
    profile?.role, loading, modulesLoading, reload, saveNavigation, resetNavigation, saveWidgets, resetWidgets,
    saveNames, saveCodes, resetCodes,
  ]);

  return <CustomizationContext.Provider value={value}>{children}</CustomizationContext.Provider>;
}

export const useCustomization = () => useContext(CustomizationContext);

/**
 * Display name of a destination (core page · module · owner module) —
 * the custom name from تخصيص التطبيق when the owner set one, default
 * otherwise. Use it wherever a page / module NAME is drawn.
 */
export function useNavLabel(key: string): string {
  const { label } = useCustomization();
  return label(key);
}

/**
 * Code generator following the owner's code system (نظام الأكواد). Pass the
 * selected scope so church / service / class abbreviation parts resolve:
 *   const gen = useCodeGenerator('person');
 *   gen({ churchId, serviceId, classId })  → 'STM-C1-1702655732293'
 */
export function useCodeGenerator(kind: CodeKind): (ctx?: CodeContext) => string {
  const { generateCode } = useCustomization();
  return useCallback((ctx?: CodeContext) => generateCode(kind, ctx), [generateCode, kind]);
}
