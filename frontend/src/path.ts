import { campusOf, satisfiedSet, type Catalog } from './catalog';
import type { Req } from './prereq';

/** The cheapest way to become eligible for (and take) a course, given what's already done. */
export interface Route {
  target: string;
  /** false when no route exists (e.g. circular prerequisites in the data) */
  possible: boolean;
  /**
   * Courses still to take, in order. Everything in a step only needs courses from earlier
   * steps (or ones already done), so a step's courses can be taken in the same term.
   * The last step is the target itself.
   */
  steps: string[][];
  /** courses still to take before the target */
  before: string[];
  /** credits still to take, including the target */
  credits: number;
  /** completed (or equivalent) courses the route relies on */
  uses: string[];
  /** route courses whose calendar entry also has requirements that can't be checked automatically */
  unchecked: string[];
  /** route courses missing from the catalog data (their own prerequisites are unknown) */
  unknown: string[];
  /** every course on the route, including the target and the courses it relies on */
  all: Set<string>;
  /**
   * Which course the route uses to satisfy which: [prerequisite, course] pairs, e.g.
   * ["MAT149H1", "STA237H1"]. Used to light up exactly the route's arrows on the map.
   */
  links: [string, string][];
}

/**
 * Cost multipliers on a course's credits, so the route prefers what a student of the target
 * course would actually take: same campus, same faculty, and courses that still exist
 * (codes missing from the catalog are often retired, and their own prerequisites are unknown).
 */
const OTHER_CAMPUS_PENALTY = 10;
const OTHER_DIVISION_PENALTY = 10;
const UNKNOWN_COURSE_PENALTY = 6;

export const creditsOf = (code: string) => (code[6] === 'Y' ? 1 : 0.5);

interface Plan {
  take: Set<string>;
  uses: Set<string>;
  /** the courses this requirement directly relies on (taken or still to take; not their own prerequisites) */
  direct: string[];
}

const EMPTY: Plan = { take: new Set(), uses: new Set(), direct: [] };

export function findRoute(catalog: Catalog, target: string, done: Set<string>): Route {
  const has = satisfiedSet(catalog, done);
  const home = campusOf(target);
  const homeDivision = catalog.courses.get(target)?.division;
  const weight = (code: string) => {
    const course = catalog.courses.get(code);
    let w = creditsOf(code);
    if (!course) w *= UNKNOWN_COURSE_PENALTY;
    if (home !== 'Other' && campusOf(code) !== home) w *= OTHER_CAMPUS_PENALTY;
    else if (course && homeDivision && course.division !== homeDivision) w *= OTHER_DIVISION_PENALTY;
    return w;
  };
  const cost = (set: Set<string>) => {
    let sum = 0;
    for (const c of set) sum += weight(c);
    return sum;
  };

  const memo = new Map<string, Plan | null>();
  const directOf = new Map<string, string[]>();
  const visiting = new Set<string>();

  const planCourse = (code: string): Plan | null => {
    if (has.has(code)) return { take: new Set(), uses: new Set([code]), direct: [] };
    if (memo.has(code)) return memo.get(code)!;
    if (visiting.has(code)) return null; // circular
    visiting.add(code);
    const sub = planReq(catalog.courses.get(code)?.req ?? null);
    visiting.delete(code);
    const plan = sub && { take: new Set([...sub.take, code]), uses: sub.uses, direct: [code] };
    if (sub) directOf.set(code, sub.direct);
    memo.set(code, plan);
    return plan;
  };

  const planReq = (req: Req | null): Plan | null => {
    if (!req) return EMPTY;
    if (req.kind === 'course') {
      const p = planCourse(req.code);
      return p && { ...p, direct: [req.code] };
    }
    const parts = req.items.map(planReq);
    if (req.kind === 'and') {
      if (parts.some((p) => !p)) return null;
      const take = new Set<string>();
      const uses = new Set<string>();
      const direct: string[] = [];
      for (const p of parts as Plan[]) {
        p.take.forEach((c) => take.add(c));
        p.uses.forEach((c) => uses.add(c));
        direct.push(...p.direct);
      }
      return { take, uses, direct };
    }
    // "one of": cheapest option, then fewest courses, then the calendar's own order
    let best: Plan | null = null;
    for (const p of parts) {
      if (!p) continue;
      if (!best || cost(p.take) < cost(best.take) || (cost(p.take) === cost(best.take) && p.take.size < best.take.size)) best = p;
    }
    return best;
  };

  const plan = planCourse(target);
  if (!plan) {
    return { target, possible: false, steps: [], before: [], credits: 0, uses: [], unchecked: [], unknown: [], all: new Set([target]), links: [] };
  }

  // step = 1 + the latest step among the course's direct prerequisites
  const stepOf = new Map<string, number>();
  const step = (code: string): number => {
    const known = stepOf.get(code);
    if (known !== undefined) return known;
    stepOf.set(code, 1); // cycle guard
    let s = 1;
    for (const d of directOf.get(code) ?? []) if (plan.take.has(d) && d !== code) s = Math.max(s, step(d) + 1);
    stepOf.set(code, s);
    return s;
  };
  const steps: string[][] = [];
  for (const c of plan.take) {
    const s = step(c);
    (steps[s - 1] ??= []).push(c);
  }
  const ordered = steps.filter(Boolean).map((s) => s.sort());

  const take = [...plan.take];
  const links: [string, string][] = [];
  for (const c of take) for (const d of new Set(directOf.get(c) ?? [])) if (d !== c) links.push([d, c]);
  return {
    target,
    possible: true,
    steps: ordered,
    before: take.filter((c) => c !== target).sort(),
    credits: take.reduce((sum, c) => sum + creditsOf(c), 0),
    uses: [...plan.uses].sort(),
    unchecked: take.filter((c) => catalog.courses.get(c)?.reqNotes),
    unknown: take.filter((c) => !catalog.courses.has(c)),
    all: new Set([...plan.take, ...plan.uses, target]),
    links,
  };
}
