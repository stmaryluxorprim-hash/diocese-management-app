'use client';

// ---------- MultiClassSelect — the class selector of the whole app ----------
// A dropdown that lets the user tick SEVERAL classes. `value` is the list of
// chosen class ids; an EMPTY list means «كل الفصول». Looks like the old
// <select> (same `input-field` box) so it drops into every filter row.

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { classesLabel, toggleClass } from '@/lib/class-multi';

export interface MultiClassSelectProps {
  id?: string;
  value: string[];
  onChange: (ids: string[]) => void;
  options: { id: string; name: string }[];
  /** text of the «no narrowing» state */
  allLabel?: string;
  ariaLabel?: string;
  disabled?: boolean;
  /** extra classes for the trigger box */
  className?: string;
  /** optional leading icon (like ScopeSelect) */
  icon?: ReactNode;
  /** show the «all» row + «clear» (default true) */
  showAll?: boolean;
}

export function MultiClassSelect({
  id, value, onChange, options, allLabel = 'كل الفصول', ariaLabel = 'اختيار الفصول', disabled, className = '', icon, showAll = true,
}: MultiClassSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const uid = useId();
  const listId = `${id ?? uid}-list`;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('touchstart', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('touchstart', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const locked = !!disabled;
  const label = classesLabel(value, options, allLabel);
  const active = value.length > 0;

  const flip = (cid: string) => {
    const next = toggleClass(value, cid);
    // picking every option is the same as «all» — except with a single option,
    // where collapsing would make the tick vanish (the class could never be selected)
    onChange(options.length > 1 && next.length === options.length ? [] : next);
  };

  return (
    <div ref={rootRef} className="relative">
      {icon && <span className="pointer-events-none absolute right-2 top-1/2 z-10 -translate-y-1/2">{icon}</span>}
      <button
        id={id}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        disabled={locked}
        onClick={() => setOpen((o) => !o)}
        className={`input-field flex items-center justify-between gap-1 !px-2 text-xs font-bold ${icon ? '!pr-7' : ''} ${
          active ? '!border-primary-300 !bg-primary-50 text-primary-800' : ''} ${locked ? 'cursor-not-allowed opacity-70' : ''} ${className}`}
      >
        <span className="truncate">{label}</span>
        <span className="flex shrink-0 items-center gap-1">
          {value.length > 1 && (
            <span className="rounded-full bg-primary-600 px-1.5 text-[10px] font-extrabold leading-4 text-white">{value.length}</span>
          )}
          <ChevronDown className={`h-3.5 w-3.5 text-slate-400 transition ${open ? 'rotate-180' : ''}`} />
        </span>
      </button>

      {open && !locked && (
        <div
          id={listId}
          role="listbox"
          aria-multiselectable="true"
          className="absolute right-0 z-50 mt-1 max-h-64 min-w-full w-max max-w-[85vw] overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl"
        >
          {showAll && (
            <button
              type="button"
              role="option"
              aria-selected={!active}
              id={id ? `${id}-all` : undefined}
              onClick={() => onChange([])}
              className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-start text-xs font-extrabold transition hover:bg-slate-50 ${!active ? 'text-primary-700' : 'text-slate-600'}`}
            >
              <Box checked={!active} />
              <span className="flex-1 truncate">{allLabel}</span>
            </button>
          )}
          {options.length === 0 && <p className="px-2.5 py-2 text-center text-[11px] text-slate-400">لا توجد فصول</p>}
          {options.map((o) => {
            const on = value.includes(o.id);
            return (
              <button
                key={o.id}
                type="button"
                role="option"
                aria-selected={on}
                id={id ? `${id}-opt-${o.id}` : undefined}
                onClick={() => flip(o.id)}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-start text-xs font-bold transition hover:bg-slate-50 ${on ? 'bg-primary-50/60 text-primary-800' : 'text-slate-700'}`}
              >
                <Box checked={on} />
                <span className="flex-1 truncate">{o.name}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Box({ checked }: { checked: boolean }) {
  return (
    <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${checked ? 'border-primary-600 bg-primary-600 text-white' : 'border-slate-300 bg-white'}`}>
      {checked && <Check className="h-3 w-3" strokeWidth={3} />}
    </span>
  );
}
