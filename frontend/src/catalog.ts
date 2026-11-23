import { collectCodes, evaluate, parsePrereq, type Req } from './prereq';

export type Campus = 'UTSG' | 'UTM' | 'UTSC' | 'Other';

export interface RawCourse {
  code: string;
  title: string;
  campus: Campus;
  division: string;
  description: string;
  prereq: string;
  coreq: string;
  exclusion: string;
  breadth: string[];
}

export interface Course extends RawCourse {
  req: Req | null;
  /** prereq text contains requirements we can't check (credits, program enrolment, ...) */
  reqNotes: boolean;
  coreqReq: Req | null;
  exclusionCodes: string[];
}

/** `equivalent`: not taken, but an equivalent course was (e.g. the same course on another campus). */
export type Status = 'completed' | 'equivalent' | 'available' | 'locked' | 'unknown';

export interface Catalog {
  courses: Map<string, Course>;
  list: Course[];
  /** course code -> courses that mention it in their prerequisites */
  unlocks: Map<string, string[]>;
  /** course code -> courses that count as the same course for prerequisites (see findEquivalents) */
  equivalents: Map<string, Set<string>>;
}

const CODE_RE = /[A-Z]{3}[A-Z0-9]\d{2}[HY]\d?/g;

export function campusOf(code: string): Campus {
  const d = code[code.length - 1];
  if (d === '1') return 'UTSG';
  if (d === '5') return 'UTM';
  if (d === '3') return 'UTSC';
  return 'Other';
}

export const CAMPUS_LABEL: Record<Campus, string> = {
  UTSG: 'St. George',
  UTM: 'Mississauga',
  UTSC: 'Scarborough',
  Other: 'Other',
};

export async function loadCatalog(): Promise<Catalog> {
  const res = await fetch(`${import.meta.env.BASE_URL}courses.json`);
  if (!res.ok) throw new Error(`Failed to load course data (${res.status})`);
  const raw: RawCourse[] = await res.json();
  return buildCatalog(raw);
}

export function buildCatalog(raw: RawCourse[]): Catalog {
  const known = new Set(raw.map((c) => c.code));
  // "CSC263H" (no campus suffix) -> "CSC263H1" when that exists
  const resolve = (code: string) => {
    if (known.has(code) || /\d$/.test(code)) return code;
    for (const suffix of ['1', '5', '3']) if (known.has(code + suffix)) return code + suffix;
    return code;
  };

  const courses = new Map<string, Course>();
  const unlocks = new Map<string, string[]>();
  for (const r of raw) {
    const { req, hasNotes } = parsePrereq(r.prereq, resolve);
    const course: Course = {
      ...r,
      req,
      reqNotes: hasNotes,
      coreqReq: parsePrereq(r.coreq, resolve).req,
      exclusionCodes: [...new Set((r.exclusion.match(CODE_RE) || []).map(resolve))],
    };
    courses.set(r.code, course);
    for (const code of collectCodes(req)) {
      const list = unlocks.get(code);
      if (list) list.push(r.code);
      else unlocks.set(code, [r.code]);
    }
  }
  return { courses, list: [...courses.values()], unlocks, equivalents: findEquivalents(courses) };
}

/**
 * Pairs of courses that count as the same course when checking prerequisites.
 *
 * The calendar's "exclusions" are NOT a safe source on their own: an exclusion only means
 * "can't take both for credit" (CSC148H1 excludes CSC207H1, MAT223H1 excludes MAT224H1).
 * Same-campus pairs with different numbers are often different courses that merely overlap
 * (CSC108H1 / CSC111H1, MAT130H1 / MAT135H1, SPA301H1 / SPA305H1), so they never count.
 * A pair counts only if it is linked by an exclusion, has the same subject, level and length
 * (H/Y), neither is a prerequisite of the other, and either
 *  - it has the same course number (CSC263H1 / CSC263H5 / CSCB63H3, CSC148H1 / CSCA48H3), or
 *  - the courses are on different campuses and exclude each other (CSC311H5 / CSCC11H3).
 * Enriched versions (CSC240H1 for CSC236H1) are left out: the calendar lists them explicitly.
 */
export function findEquivalents(courses: Map<string, Course>): Map<string, Set<string>> {
  const eq = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (!eq.has(a)) eq.set(a, new Set());
    if (!eq.has(b)) eq.set(b, new Set());
    eq.get(a)!.add(b);
    eq.get(b)!.add(a);
  };
  const subject = (c: string) => c.slice(0, 3);
  const number = (c: string) => c.slice(4, 6); // "CSC263H1" -> "63", "CSCB63H3" -> "63"
  const weight = (c: string) => c[6]; // H or Y
  const sameShape = (a: string, b: string) =>
    subject(a) === subject(b) && courseLevel(a) === courseLevel(b) && weight(a) === weight(b);
  const prereqOf = (a: string, b: string) => collectCodes(courses.get(b)?.req ?? null).has(a);

  for (const a of courses.values()) {
    for (const b of a.exclusionCodes) {
      if (a.code === b || !sameShape(a.code, b)) continue;
      if (prereqOf(a.code, b) || prereqOf(b, a.code)) continue;
      const mutual = courses.get(b)?.exclusionCodes.includes(a.code) ?? false;
      if (number(a.code) === number(b) || (mutual && campusOf(a.code) !== campusOf(b))) link(a.code, b);
    }
  }
  return eq;
}

const satisfiedCache = new WeakMap<Catalog, WeakMap<Set<string>, Set<string>>>();

/** Completed courses plus everything equivalent to them: use this for every prerequisite check. */
export function satisfiedSet(catalog: Catalog, done: Set<string>): Set<string> {
  let perCatalog = satisfiedCache.get(catalog);
  if (!perCatalog) satisfiedCache.set(catalog, (perCatalog = new WeakMap()));
  const cached = perCatalog.get(done);
  if (cached) return cached;
  const out = new Set(done);
  for (const code of done) for (const e of catalog.equivalents.get(code) ?? []) out.add(e);
  perCatalog.set(done, out);
  return out;
}

/** Which completed course makes `code` count as done (for "equivalent" courses). */
export function equivalentSource(catalog: Catalog, code: string, done: Set<string>): string | undefined {
  for (const e of catalog.equivalents.get(code) ?? []) if (done.has(e)) return e;
  return undefined;
}

export function courseStatus(catalog: Catalog, code: string, done: Set<string>): Status {
  if (done.has(code)) return 'completed';
  const has = satisfiedSet(catalog, done);
  if (has.has(code)) return 'equivalent';
  const c = catalog.courses.get(code);
  if (!c) return 'unknown';
  return evaluate(c.req, has) ? 'available' : 'locked';
}

/** completed or equivalent */
export const isSatisfied = (s: Status) => s === 'completed' || s === 'equivalent';

/** Course level as a number: 100, 200, ... (A/B/C/D at UTSC map to 100-400). */
export function courseLevel(code: string): number {
  const ch = code[3];
  const map: Record<string, number> = { A: 100, B: 200, C: 300, D: 400 };
  if (map[ch]) return map[ch];
  const n = Number(ch);
  return Number.isFinite(n) ? n * 100 : 0;
}
