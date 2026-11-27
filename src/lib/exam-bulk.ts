// ---------- Bulk question parser (إضافة أسئلة بالجملة) ----------
// Pure text -> drafts helper (no React / Supabase) so it can be unit tested.
//
// Accepted text:
//   السؤال الأول
//   إجابة
//   إجابة
//   إجابة
//   إجابة
//   السؤال الثاني
//   ...
// • Blank line between questions  -> every block = 1 question + N answers (N varies).
// • No blank lines                -> fixed number of answers per question (default 4).
// • Correct answer (optional) is marked with * ✓ ✔ at the start/end of the line,
//   or «(صح)» / «(صحيحة)» at the end.
// • Numbering ("1-", "1)", "١.") on questions and letters ("أ-", "b)") on answers are stripped.

import { MAX_OPTIONS, MIN_OPTIONS } from '@/lib/exams';

export interface BulkDraft {
  key: string;
  text: string;
  options: string[];
  /** -1 = not chosen yet */
  correct: number;
  points: string;
  seconds: string;
}

export interface BulkParseOptions {
  /** 'auto' = blank-line blocks when the text has blank lines, else 4 per question */
  answersPerQuestion: 'auto' | number;
  /** when an answer isn't marked, treat the first one as correct */
  firstIsCorrect: boolean;
  points: string;
  seconds: string;
}

export interface BulkParseResult {
  drafts: BulkDraft[];
  /** human readable mode actually used */
  mode: { kind: 'blocks' } | { kind: 'fixed'; n: number };
  /** trailing lines that didn't fill a full question (fixed mode) */
  leftover: string[];
}

const QNUM = /^\s*\(?[0-9٠-٩]+\s*[-–—.)\/:،]\s*/;
const QNUM_WORD = /^\s*(?:سؤال|س)\s*[0-9٠-٩]*\s*[:：\-–—.)]\s*/;
const OPT_LETTER = /^\s*\(?(?:أ|ا|ب|ج|د|هـ|ه|و|[a-fA-F])\s*[-–—.)\/:]\s*/;
const BULLET = /^\s*[•·▪●○◦\-–—]\s+/;
const LEAD_MARK = /^\s*(?:\*+|[✓✔✅☑]+|\+)\s*/;
const TRAIL_MARK = /\s*(?:\*+|[✓✔✅☑]+|\(\s*(?:صح|صحيحة|الصحيحة|الإجابة الصحيحة)\s*\)|\[\s*(?:صح|صحيحة)\s*\])\s*$/;

function cleanQuestion(line: string): string {
  return line.replace(QNUM, '').replace(QNUM_WORD, '').trim();
}

export function cleanOption(line: string): { text: string; marked: boolean } {
  let s = line.trim();
  let marked = false;
  for (let i = 0; i < 3; i++) {
    const before = s;
    if (LEAD_MARK.test(s)) { s = s.replace(LEAD_MARK, ''); marked = true; }
    if (TRAIL_MARK.test(s)) { s = s.replace(TRAIL_MARK, ''); marked = true; }
    s = s.replace(OPT_LETTER, '').replace(BULLET, '');
    if (s === before) break;
  }
  return { text: s.trim(), marked };
}

let seq = 0;
const nextKey = () => `bq-${Date.now().toString(36)}-${seq++}`;

function toDraft(qLine: string, optLines: string[], o: BulkParseOptions): BulkDraft {
  const cleaned = optLines.map(cleanOption);
  let correct = cleaned.findIndex((c) => c.marked);
  if (correct < 0 && o.firstIsCorrect && cleaned.length > 0) correct = 0;
  return {
    key: nextKey(),
    text: cleanQuestion(qLine),
    options: cleaned.map((c) => c.text),
    correct,
    points: o.points,
    seconds: o.seconds,
  };
}

export function parseBulkQuestions(raw: string, o: BulkParseOptions): BulkParseResult {
  const lines = raw.replace(/\r/g, '').split('\n').map((l) => l.trim());
  const hasBlank = lines.some((l, i) => l === '' && i > 0 && i < lines.length - 1 && lines.slice(0, i).some(Boolean) && lines.slice(i + 1).some(Boolean));
  const useBlocks = o.answersPerQuestion === 'auto' ? hasBlank : false;

  if (useBlocks) {
    const blocks: string[][] = [];
    let cur: string[] = [];
    for (const l of lines) {
      if (l === '') { if (cur.length) { blocks.push(cur); cur = []; } } else cur.push(l);
    }
    if (cur.length) blocks.push(cur);
    return {
      mode: { kind: 'blocks' },
      leftover: [],
      drafts: blocks.map((b) => toDraft(b[0], b.slice(1), o)),
    };
  }

  const n = o.answersPerQuestion === 'auto' ? 4 : o.answersPerQuestion;
  const flat = lines.filter(Boolean);
  const drafts: BulkDraft[] = [];
  const step = n + 1;
  let i = 0;
  for (; i + step <= flat.length; i += step) {
    drafts.push(toDraft(flat[i], flat.slice(i + 1, i + step), o));
  }
  return { mode: { kind: 'fixed', n }, leftover: flat.slice(i), drafts };
}

/** Validation message for one draft (null = OK). Mirrors QuestionFormModal + DB trigger. */
export function validateDraft(d: BulkDraft): string | null {
  if (!d.text.trim()) return 'نص السؤال فارغ';
  if (d.options.length < MIN_OPTIONS) return `أقل عدد للاختيارات ${MIN_OPTIONS}`;
  if (d.options.length > MAX_OPTIONS) return `أقصى عدد للاختيارات ${MAX_OPTIONS}`;
  const t = d.options.map((x) => x.trim());
  if (t.some((x) => !x)) return 'يوجد اختيار فارغ';
  if (new Set(t).size !== t.length) return 'يوجد اختياران بنفس النص';
  if (d.correct < 0 || d.correct >= d.options.length) return 'حدّد الإجابة الصحيحة';
  const p = Number(d.points);
  if (d.points === '' || !Number.isFinite(p) || p < 0 || p > 1000) return 'الدرجة بين 0 و 1000';
  if (d.seconds !== '') {
    const s = Number(d.seconds);
    if (!Number.isFinite(s) || s < 5 || s > 3600) return 'الوقت بين 5 و 3600 ثانية';
  }
  return null;
}
