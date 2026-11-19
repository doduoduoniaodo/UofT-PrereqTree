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

export type Status = 'completed' | 'available' | 'locked' | 'unknown';

export interface Catalog {
  courses: Map<string, Course>;
  list: Course[];
  /** course code -> courses that mention it in their prerequisites */
  unlocks: Map<string, string[]>;
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
  return { courses, list: [...courses.values()], unlocks };
}

export function courseStatus(catalog: Catalog, code: string, done: Set<string>): Status {
  if (done.has(code)) return 'completed';
  const c = catalog.courses.get(code);
  if (!c) return 'unknown';
  return evaluate(c.req, done) ? 'available' : 'locked';
}

/** Course level as a number: 100, 200, ... (A/B/C/D at UTSC map to 100-400). */
export function courseLevel(code: string): number {
  const ch = code[3];
  const map: Record<string, number> = { A: 100, B: 200, C: 300, D: 400 };
  if (map[ch]) return map[ch];
  const n = Number(ch);
  return Number.isFinite(n) ? n * 100 : 0;
}
