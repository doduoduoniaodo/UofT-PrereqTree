// Parses UofT prerequisite text into an AND/OR requirement tree.
//
// UofT calendars use a few conventions that differ by campus:
//   St. George (A&S):  "/" = or,  "," and ";" = and,  (...) groups
//   UTM / UTSC:        "or" / "and" words, (...) and [...] groups
//
// Two kinds of extra information are kept alongside the course codes:
//  - grade minimums ("60% or higher in CSC148H1", "CSC110Y1 (70% or higher)") on the course
//    they apply to (`grade`);
//  - requirements that can't be checked automatically ("1.0 credit in POL courses", "permission
//    of the instructor", "enrolment in a CS program") as `notes` on the part of the tree they
//    belong to. They never affect `evaluate`: we can't know them, so the UI shows them as things
//    to check.

/** A requirement we can't check. `also`: needed in addition; `or`: an alternative way in. */
export interface ReqNote {
  text: string;
  mode: 'also' | 'or';
}

export type Req = (
  | { kind: 'course'; code: string; /** minimum grade, e.g. "60%" or "B-" */ grade?: string }
  | { kind: 'and' | 'or'; items: Req[] }
) & { notes?: ReqNote[] };

export interface ParsedReq {
  req: Req | null;
  /** the text has requirements that can't be checked (anywhere in the tree) */
  hasNotes: boolean;
  /** standalone conditions when the text names no courses at all, e.g. "1.0 credit in POL courses" */
  conditions: string[];
}

type Span = { s: number; e: number };
type RawCourse = { kind: 'course'; code: string; grade?: string } & Span;
type RawNote = { kind: 'note'; text: string } & Span;
type RawGroup = { kind: 'and' | 'or'; items: Raw[] } & Span;
type Raw = RawCourse | RawNote | RawGroup;

const CODE = '[A-Z]{3}[A-Z0-9]\\d{2}[HY]\\d?';
const CODE_RE = new RegExp(CODE, 'y');
/** grades are folded into the text as CODE⟨60%⟩ before tokenizing */
const GRADE_MARK = /^⟨([^⟩]+)⟩/;

// Separator precedence, lowest (binds loosest) first. `Implicit` is two things written next to
// each other ("8.0 credits including VPAB13H3"): an "and" that binds a bit tighter than a comma,
// and is never turned into an "or" by the "A, B, or C" rule.
const Sep = { Semi: 0, AndWord: 1, OrWord: 2, Comma: 3, Implicit: 3.5, Slash: 4 } as const;
type Sep = (typeof Sep)[keyof typeof Sep];
const SEP_OP: Record<Sep, 'and' | 'or'> = { 0: 'and', 1: 'and', 2: 'or', 3: 'and', 3.5: 'and', 4: 'or' };

type Tok = Span &
  ({ t: 'code'; v: string; grade?: string } | { t: 'open' } | { t: 'close' } | { t: 'sep'; v: Sep } | { t: 'text'; v: string });

const PCT = '(\\d+(?:\\.\\d+)?)\\s*%';
const HIGHER = '(?:\\s*or\\s+(?:higher|above|better|more))?';

function normalize(text: string): string {
  return (
    text
      .replace(/&amp;/g, '&')
      .replace(/&nbsp;/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[⟨⟩]/g, ' ')
      // "[excluding MATA02H3]" is not a requirement
      .replace(/[[(]\s*(excluding|except|not\s+including)\b[^\])]*[\])]/gi, ' ')
      // grade minimums -> CODE⟨60%⟩
      // "CSC110Y1 (70% or higher)", "MAT133Y1(70%)", "EAS151H1 (minimum of 60%)"
      .replace(
        new RegExp(`(${CODE})\\s*\\(\\s*(?:a\\s+)?(?:minimum\\s+)?(?:final\\s+)?(?:grade\\s+)?(?:of\\s+)?${PCT}${HIGHER}\\s*\\)`, 'gi'),
        '$1⟨$2%⟩',
      )
      // "ARC401H1 with a final grade of 80%"
      .replace(
        new RegExp(`(${CODE})\\s+with\\s+(?:a\\s+)?(?:minimum\\s+)?(?:final\\s+)?(?:grade|mark)\\s+of\\s+(?:at\\s+least\\s+)?${PCT}${HIGHER}`, 'gi'),
        '$1⟨$2%⟩',
      )
      // "60% or higher in CSC148H1", "a minimum grade of 60% in CHM120H5", "Minimum 70% in ARC100H1"
      .replace(
        new RegExp(
          `\\b(?:a\\s+)?(?:minimum\\s+)?(?:final\\s+)?(?:grade\\s+)?(?:of\\s+)?(?:at\\s+least\\s+)?${PCT}${HIGHER}\\s*(?:in\\s+)?(${CODE})`,
          'gi',
        ),
        '$2⟨$1%⟩',
      )
      // "a minimum grade of B- in CSC148H1"
      .replace(
        new RegExp(`\\b(?:a\\s+)?(?:minimum\\s+)?grade\\s+of\\s+(?:at\\s+least\\s+)?([A-D][+-]?)${HIGHER}\\s+in\\s+(${CODE})`, 'gi'),
        '$2⟨$1⟩',
      )
  );
}

function tokenize(text: string): Tok[] {
  const toks: Tok[] = [];
  let buf = '';
  let bufStart = 0;
  const flush = (end: number) => {
    if (/[A-Za-z0-9]/.test(buf)) toks.push({ t: 'text', v: buf.trim(), s: bufStart, e: end });
    buf = '';
  };
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const prevIsWord = i > 0 && /[A-Za-z0-9]/.test(text[i - 1]);
    if (!prevIsWord) {
      CODE_RE.lastIndex = i;
      const m = CODE_RE.exec(text);
      if (m && !/[A-Za-z0-9]/.test(text[i + m[0].length] ?? '')) {
        flush(i);
        let end = i + m[0].length;
        const g = GRADE_MARK.exec(text.slice(end));
        if (g) end += g[0].length;
        toks.push({ t: 'code', v: m[0], grade: g?.[1], s: i, e: end });
        i = end;
        continue;
      }
      const word = /^(and|or)\b/i.exec(text.slice(i, i + 4));
      if (word) {
        flush(i);
        toks.push({ t: 'sep', v: word[1].toLowerCase() === 'and' ? Sep.AndWord : Sep.OrWord, s: i, e: i + word[1].length });
        i += word[1].length;
        continue;
      }
    }
    const single: Record<string, Tok['t'] | Sep> = { '(': 'open', '[': 'open', ')': 'close', ']': 'close' };
    if (single[ch]) {
      flush(i);
      toks.push({ t: single[ch] as 'open' | 'close', s: i, e: i + 1 });
    } else if (ch === '/' || ch === ',' || ch === ';') {
      flush(i);
      toks.push({ t: 'sep', v: ch === '/' ? Sep.Slash : ch === ',' ? Sep.Comma : Sep.Semi, s: i, e: i + 1 });
    } else {
      if (!buf) bufStart = i;
      buf += ch;
    }
    i++;
  }
  flush(text.length);

  // ", or" / ", and" -> just the word
  const out: Tok[] = [];
  for (const tok of toks) {
    const prev = out[out.length - 1];
    if (tok.t === 'sep' && prev?.t === 'sep') {
      if (prev.v === Sep.Comma && (tok.v === Sep.OrWord || tok.v === Sep.AndWord)) {
        out[out.length - 1] = tok;
      }
      // otherwise keep the first separator, drop the duplicate
      continue;
    }
    out.push(tok);
  }
  return out;
}

function parseLevel(toks: Tok[], pos: { i: number }, src: string): Raw | null {
  const items: Raw[] = [];
  const seps: Sep[] = [];
  let expectItem = true;

  const pushItem = (item: Raw | null, joinWith: Sep = Sep.Implicit) => {
    if (!item) return;
    if (!expectItem) seps.push(joinWith);
    items.push(item);
    expectItem = false;
  };

  while (pos.i < toks.length) {
    const tok = toks[pos.i++];
    if (tok.t === 'close') break;
    if (tok.t === 'open') {
      // "AST320H1 (or AST221H1 and AST222H1)": a bracket opening with "or" is an alternative
      const next = toks[pos.i];
      const leadingOr = next?.t === 'sep' && next.v === Sep.OrWord;
      pushItem(parseLevel(toks, pos, src), leadingOr ? Sep.OrWord : Sep.Implicit);
    }
    else if (tok.t === 'code') pushItem({ kind: 'course', code: tok.v, grade: tok.grade, s: tok.s, e: tok.e });
    else if (tok.t === 'text') pushItem({ kind: 'note', text: tok.v, s: tok.s, e: tok.e });
    else if (tok.t === 'sep') {
      if (!expectItem) {
        seps.push(tok.v);
        expectItem = true;
      }
    }
  }
  if (expectItem && seps.length) seps.pop(); // trailing separator
  if (items.length === 0) return null;

  // "A, B, or C" -> commas act as "or"
  const kinds = new Set(seps);
  if (seps[seps.length - 1] === Sep.OrWord && kinds.has(Sep.Comma) && !kinds.has(Sep.AndWord) && !kinds.has(Sep.Semi)) {
    for (let k = 0; k < seps.length; k++) if (seps[k] === Sep.Comma) seps[k] = Sep.OrWord;
  }
  return combine(items, seps, src);
}

const hasCourse = (r: Raw): boolean => r.kind === 'course' || (r.kind !== 'note' && r.items.some(hasCourse));

function combine(items: Raw[], seps: Sep[], src: string): Raw {
  if (items.length === 1) return items[0];
  const lowest = Math.min(...seps);
  const groups: Raw[] = [];
  let start = 0;
  for (let k = 0; k <= seps.length; k++) {
    if (k === seps.length || seps[k] === lowest) {
      groups.push(combine(items.slice(start, k + 1), seps.slice(start, k), src));
      start = k + 1;
    }
  }
  // Neighbouring conditions are one sentence that happened to contain "and"/"or":
  // "Enrolment in the Major program in Media and Communication Studies".
  const merged: Raw[] = [];
  for (const g of groups) {
    const last = merged[merged.length - 1];
    if (g.kind === 'note' && last?.kind === 'note') merged[merged.length - 1] = { kind: 'note', text: src.slice(last.s, g.e), s: last.s, e: g.e };
    else merged.push(g);
  }
  if (merged.length === 1) return merged[0];
  const group: RawGroup = { kind: SEP_OP[lowest as Sep], items: merged, s: merged[0].s, e: merged[merged.length - 1].e };
  // A run of conditions with no courses reads best as the original sentence:
  // "CGPA of at least 3.5, or enrolment in a CSC Subject POSt" rather than two fragments.
  if (!hasCourse(group)) return { kind: 'note', text: src.slice(group.s, group.e), s: group.s, e: group.e };
  return group;
}

/** Tidy a fragment of calendar text into a readable condition, or null if nothing is left. */
function cleanNote(text: string): string | null {
  let t = text.replace(/[⟨⟩[\]]/g, ' ');
  // brackets cut off by a merge ("3.5) or placement test") read as noise
  if ((t.match(/\(/g) ?? []).length !== (t.match(/\)/g) ?? []).length) t = t.replace(/[()]/g, ' ');
  t = t
    .replace(/\s+/g, ' ')
    .replace(/\s+([,;:.])/g, '$1')
    .replace(/^[\s,;:.\-–]+|[\s,;:.\-–]+$/g, '')
    .replace(/^(and|or)\s+/i, '')
    .replace(/\s+(and|or)$/i, '')
    // a lead-in to the courses that follow: "8.0 credits including" -> "8.0 credits"
    .replace(/[\s,]+(including|incl\.?|in|from|of|with|for|at)$/i, '')
    .trim();
  if (t.length < 3 || !/[a-z]/i.test(t)) return null;
  if (/^(including|incl\.?|in|from|of|with|for|at|the following( courses)?)$/i.test(t)) return null;
  return t[0].toUpperCase() + t.slice(1);
}

interface Simplified {
  req: Req | null;
  /** notes not yet attached to a node (their parent decides the mode) */
  loose: string[];
}

function simplify(raw: Raw, flags: { notes: boolean }): Simplified {
  if (raw.kind === 'note') {
    const text = cleanNote(raw.text);
    if (text) flags.notes = true;
    return { req: null, loose: text ? [text] : [] };
  }
  if (raw.kind === 'course') {
    const req: Req = { kind: 'course', code: raw.code };
    if (raw.grade) req.grade = raw.grade;
    return { req, loose: [] };
  }
  const mode: ReqNote['mode'] = raw.kind === 'and' ? 'also' : 'or';
  const items: Req[] = [];
  const notes: ReqNote[] = [];
  const seen = new Set<string>();
  for (const child of raw.items) {
    const s = simplify(child, flags);
    for (const text of s.loose) notes.push({ text, mode });
    if (!s.req) continue;
    let flat: Req[] = [s.req];
    if (s.req.kind === raw.kind) {
      flat = s.req.items;
      notes.push(...(s.req.notes ?? []));
    }
    for (const f of flat) {
      const key = reqKey(f);
      if (!seen.has(key)) {
        seen.add(key);
        items.push(f);
      }
    }
  }
  if (items.length === 0) return { req: null, loose: notes.map((n) => n.text) };
  // In an "and", a condition needed alongside one item is needed alongside all of them:
  // (A and note) and B == (A and B) and note. Show it once, on the group.
  if (raw.kind === 'and' && items.length > 1) {
    for (let k = 0; k < items.length; k++) {
      const also = items[k].notes?.filter((n) => n.mode === 'also') ?? [];
      if (!also.length) continue;
      notes.push(...also);
      const rest = items[k].notes!.filter((n) => n.mode !== 'also');
      const copy = { ...items[k] };
      if (rest.length) copy.notes = rest;
      else delete copy.notes;
      items[k] = copy;
    }
  }
  if (items.length === 1) {
    const only = items[0];
    return { req: notes.length ? { ...only, notes: [...(only.notes ?? []), ...notes] } : only, loose: [] };
  }
  const req: Req = { kind: raw.kind, items };
  if (notes.length) req.notes = notes;
  return { req, loose: [] };
}

function reqKey(r: Req): string {
  return r.kind === 'course' ? r.code : `${r.kind}(${r.items.map(reqKey).join(',')})`;
}

/** Resolve codes like "CSC263H" (no campus digit) against the catalog. */
function resolveCodes(r: Req, known: (code: string) => string): Req {
  if (r.kind === 'course') return { ...r, code: known(r.code) };
  return { ...r, items: r.items.map((i) => resolveCodes(i, known)) };
}

export function parsePrereq(text: string, resolve: (code: string) => string = (c) => c): ParsedReq {
  if (!text || !text.trim()) return { req: null, hasNotes: false, conditions: [] };
  const flags = { notes: false };

  // "...; Prerequisite for Faculty of Applied Science students: ..." -> alternatives
  const parts = normalize(text).split(/\bPre-?requisites?\s+for\s+[^:]{3,120}:/i);
  const alts: Req[] = [];
  const conditions: string[] = [];
  for (const part of parts) {
    const raw = parseLevel(tokenize(part), { i: 0 }, part);
    if (!raw) continue;
    const { req, loose } = simplify(raw, flags);
    if (req) alts.push(req);
    else conditions.push(...loose);
  }
  let req: Req | null = null;
  if (alts.length === 1) req = alts[0];
  else if (alts.length > 1) req = { kind: 'or', items: alts };
  return { req: req ? resolveCodes(req, resolve) : null, hasNotes: flags.notes, conditions };
}

export function evaluate(req: Req | null, done: Set<string>): boolean {
  if (!req) return true;
  if (req.kind === 'course') return done.has(req.code);
  if (req.kind === 'and') return req.items.every((r) => evaluate(r, done));
  return req.items.some((r) => evaluate(r, done));
}

export function collectCodes(req: Req | null, out: Set<string> = new Set()): Set<string> {
  if (!req) return out;
  if (req.kind === 'course') out.add(req.code);
  else for (const r of req.items) collectCodes(r, out);
  return out;
}

export function formatReq(req: Req | null): string {
  if (!req) return '—';
  if (req.kind === 'course') return req.code;
  const sep = req.kind === 'and' ? ' AND ' : ' OR ';
  return req.items.map((r) => (r.kind === 'course' ? r.code : `(${formatReq(r)})`)).join(sep);
}

/** "60%" -> "≥60%", "B-" -> "≥B-" */
export const formatGrade = (grade: string) => `≥${grade}`;

/** Every condition note anywhere in the tree (for tooltips). */
export function allNotes(req: Req | null, out: string[] = []): string[] {
  if (!req) return out;
  for (const n of req.notes ?? []) if (!out.includes(n.text)) out.push(n.text);
  if (req.kind !== 'course') for (const r of req.items) allNotes(r, out);
  return out;
}

/** The grade minimum on `code` wherever it first appears in the tree. */
export function gradeIn(req: Req | null, code: string): string | undefined {
  if (!req) return undefined;
  if (req.kind === 'course') return req.code === code ? req.grade : undefined;
  for (const r of req.items) {
    const g = gradeIn(r, code);
    if (g) return g;
  }
  return undefined;
}

/**
 * What a student who meets the course requirements should still double-check, following the
 * branches they actually satisfy: grade minimums on the courses they're using ("≥60% in CSC148H1")
 * and conditions that apply in addition ("Enrolment in a Computer Science program").
 * Alternatives ("or permission of the instructor") aren't needed, so they aren't listed.
 */
export function checksFor(req: Req | null, has: Set<string>): string[] {
  if (!req) return [];
  const out: string[] = [];
  const add = (s: string) => {
    if (!out.includes(s)) out.push(s);
  };
  const walk = (r: Req) => {
    for (const n of r.notes ?? []) if (n.mode === 'also') add(n.text);
    if (r.kind === 'course') {
      if (r.grade && has.has(r.code)) add(`${formatGrade(r.grade)} in ${r.code}`);
    } else if (r.kind === 'and') r.items.forEach(walk);
    else {
      const met = r.items.find((i) => evaluate(i, has));
      if (met) walk(met);
    }
  };
  walk(req);
  return out;
}
