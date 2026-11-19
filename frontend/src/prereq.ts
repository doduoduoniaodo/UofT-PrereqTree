// Parses UofT prerequisite text into an AND/OR requirement tree.
//
// UofT calendars use a few conventions that differ by campus:
//   St. George (A&S):  "/" = or,  "," and ";" = and,  (...) groups
//   UTM / UTSC:        "or" / "and" words, (...) and [...] groups
// Free-text requirements ("1.0 credit in POL courses", "permission of
// instructor") can't be checked automatically; they are dropped from the
// tree and reported through `hasNotes` so the UI can flag them.

export type Req =
  | { kind: 'course'; code: string }
  | { kind: 'and' | 'or'; items: Req[] };

export interface ParsedReq {
  req: Req | null;
  hasNotes: boolean;
}

type Note = { kind: 'note'; text: string };
type Raw = Req | Note | { kind: 'and' | 'or'; items: Raw[] };

const CODE_RE = /[A-Z]{3}[A-Z0-9]\d{2}[HY]\d?/y;

// Separator precedence, lowest (binds loosest) first.
const Sep = { Semi: 0, AndWord: 1, OrWord: 2, Comma: 3, Implicit: 3, Slash: 4 } as const;
type Sep = (typeof Sep)[keyof typeof Sep];
const SEP_OP: Record<Sep, 'and' | 'or'> = { 0: 'and', 1: 'and', 2: 'or', 3: 'and', 4: 'or' };

type Tok =
  | { t: 'code'; v: string }
  | { t: 'open' }
  | { t: 'close' }
  | { t: 'sep'; v: Sep }
  | { t: 'text'; v: string };

function normalize(text: string): string {
  return (
    text
      .replace(/&amp;/g, '&')
      .replace(/&nbsp;/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      // grade qualifiers: "60% or higher in X", "a minimum grade of 70% in X", "X (70%)"
      .replace(/\(\s*(minimum\s+(grade\s+)?(of\s+)?)?\d+(\.\d+)?\s*%\s*(or\s+(higher|above|better)\s*)?\)/gi, ' ')
      // "[excluding MATA02H3]" is not a requirement
      .replace(/[[(]\s*(excluding|except|not\s+including)\b[^\])]*[\])]/gi, ' ')
      .replace(
        /\b(a\s+)?(minimum\s+)?(grade\s+)?(of\s+)?(at\s+least\s+)?\d+(\.\d+)?\s*%\s*(or\s+(higher|above|better|more)\s*)?(\s*in\s+)?/gi,
        ' ',
      )
      .replace(/\b(a\s+)?(minimum\s+)?grade\s+of\s+[A-D][+-]?\s*(or\s+(higher|above|better)\s*)?(\s*in\s+)?/gi, ' ')
  );
}

function tokenize(text: string): Tok[] {
  const toks: Tok[] = [];
  let buf = '';
  const flush = () => {
    if (/[A-Za-z0-9]/.test(buf)) toks.push({ t: 'text', v: buf.trim() });
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
        flush();
        toks.push({ t: 'code', v: m[0] });
        i += m[0].length;
        continue;
      }
      const word = /^(and|or)\b/i.exec(text.slice(i, i + 4));
      if (word) {
        flush();
        toks.push({ t: 'sep', v: word[1].toLowerCase() === 'and' ? Sep.AndWord : Sep.OrWord });
        i += word[1].length;
        continue;
      }
    }
    if (ch === '(' || ch === '[') {
      flush();
      toks.push({ t: 'open' });
    } else if (ch === ')' || ch === ']') {
      flush();
      toks.push({ t: 'close' });
    } else if (ch === '/') {
      flush();
      toks.push({ t: 'sep', v: Sep.Slash });
    } else if (ch === ',') {
      flush();
      toks.push({ t: 'sep', v: Sep.Comma });
    } else if (ch === ';') {
      flush();
      toks.push({ t: 'sep', v: Sep.Semi });
    } else {
      buf += ch;
    }
    i++;
  }
  flush();

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

function parseLevel(toks: Tok[], pos: { i: number }): Raw | null {
  const items: (Raw | null)[] = [];
  const seps: Sep[] = [];
  let expectItem = true;

  const pushItem = (item: Raw | null) => {
    if (!expectItem) seps.push(Sep.Implicit);
    items.push(item);
    expectItem = false;
  };

  while (pos.i < toks.length) {
    const tok = toks[pos.i++];
    if (tok.t === 'close') break;
    if (tok.t === 'open') pushItem(parseLevel(toks, pos));
    else if (tok.t === 'code') pushItem({ kind: 'course', code: tok.v });
    else if (tok.t === 'text') pushItem({ kind: 'note', text: tok.v });
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
  return combine(items, seps);
}

function combine(items: (Raw | null)[], seps: Sep[]): Raw | null {
  if (items.length === 1) return items[0];
  const lowest = Math.min(...seps);
  const groups: (Raw | null)[] = [];
  let start = 0;
  for (let k = 0; k <= seps.length; k++) {
    if (k === seps.length || seps[k] === lowest) {
      groups.push(combine(items.slice(start, k + 1), seps.slice(start, k)));
      start = k + 1;
    }
  }
  const valid = groups.filter((g): g is Raw => g !== null);
  if (valid.length === 0) return null;
  return { kind: SEP_OP[lowest as Sep], items: valid };
}

function simplify(raw: Raw | null, flags: { notes: boolean }): Req | null {
  if (!raw) return null;
  if (raw.kind === 'note') {
    flags.notes = true;
    return null;
  }
  if (raw.kind === 'course') return raw;
  const out: Req[] = [];
  const seen = new Set<string>();
  for (const child of raw.items) {
    const s = simplify(child as Raw, flags);
    if (!s) continue;
    const flat = s.kind === raw.kind ? (s as { items: Req[] }).items : [s];
    for (const f of flat) {
      const key = reqKey(f);
      if (!seen.has(key)) {
        seen.add(key);
        out.push(f);
      }
    }
  }
  if (out.length === 0) return null;
  if (out.length === 1) return out[0];
  return { kind: raw.kind, items: out };
}

function reqKey(r: Req): string {
  return r.kind === 'course' ? r.code : `${r.kind}(${r.items.map(reqKey).join(',')})`;
}

/** Resolve codes like "CSC263H" (no campus digit) against the catalog. */
function resolveCodes(r: Req, known: (code: string) => string): Req {
  if (r.kind === 'course') return { kind: 'course', code: known(r.code) };
  return { kind: r.kind, items: r.items.map((i) => resolveCodes(i, known)) };
}

export function parsePrereq(text: string, resolve: (code: string) => string = (c) => c): ParsedReq {
  if (!text || !text.trim()) return { req: null, hasNotes: false };
  const flags = { notes: false };

  // "...; Prerequisite for Faculty of Applied Science students: ..." -> alternatives
  const parts = normalize(text).split(/\bPre-?requisites?\s+for\s+[^:]{3,120}:/i);
  const alts: Req[] = [];
  for (const part of parts) {
    const toks = tokenize(part);
    const raw = parseLevel(toks, { i: 0 });
    const req = simplify(raw, flags);
    if (req) alts.push(req);
  }
  let req: Req | null = null;
  if (alts.length === 1) req = alts[0];
  else if (alts.length > 1) req = simplify({ kind: 'or', items: alts }, flags);
  return { req: req ? resolveCodes(req, resolve) : null, hasNotes: flags.notes };
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
