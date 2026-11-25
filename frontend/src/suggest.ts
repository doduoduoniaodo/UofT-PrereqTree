import { campusOf, courseLevel, courseStatus, equivalentSource, satisfiedSet, type Campus, type Catalog } from './catalog';
import { checksFor, collectCodes, evaluate } from './prereq';
import { findRoute } from './path';

/** A course worth taking next, and why. */
export interface Suggestion {
  code: string;
  score: number;
  /** courses on the map this is the next step toward (it may be one of them itself) */
  toward: string[];
  /** locked courses that taking it would make available */
  opens: string[];
  /** completed courses it builds on */
  buildsOn: string[];
  /** grade minimums / conditions to double-check before enrolling */
  checks: string[];
}

const W = {
  toward: 100, // next step toward a course you've put on the map
  opens: 3, // per course it opens up (capped)
  opensCap: 15,
  subject: 8, // same subject as something you've done or selected
  campus: 5, // on your campus
  level: 4, // not far beyond the level you've reached
  buildsOn: 2, // per completed course it builds on (capped)
  buildsOnCap: 3,
};

/**
 * Courses you can take now, ranked by how much they help:
 *  1. the first step of the fastest route to each course on the map;
 *  2. courses that build on what you've completed, weighted by how many locked courses they open
 *     up and how well they fit your subjects, campus and level.
 * Courses that exclude something you've completed are left out.
 */
export function suggestNext(
  catalog: Catalog,
  done: Set<string>,
  targets: string[],
  { campus = 'ALL', limit = 12 }: { campus?: Campus | 'ALL'; limit?: number } = {},
): Suggestion[] {
  const has = satisfiedSet(catalog, done);
  const toward = new Map<string, string[]>();
  const candidates = new Set<string>();

  // 1. next steps toward the courses on the map
  for (const t of targets) {
    if (has.has(t) || !catalog.courses.has(t)) continue;
    const route = findRoute(catalog, t, done);
    if (!route.possible || !route.steps.length) continue;
    for (const c of route.steps[0]) {
      candidates.add(c);
      toward.set(c, [...(toward.get(c) ?? []), t]);
    }
  }
  // 2. courses that build on what you've done
  for (const d of has) for (const u of catalog.unlocks.get(d) ?? []) candidates.add(u);

  // the campus to favour: the filter if set, else where your courses mostly are
  const counts = new Map<Campus, number>();
  for (const c of [...targets, ...done]) counts.set(campusOf(c), (counts.get(campusOf(c)) ?? 0) + 1);
  const home: Campus = campus !== 'ALL' ? campus : ([...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'UTSG');
  // all your courses are on one campus: don't suggest another campus's version of things
  const oneCampus = counts.size === 1;
  const subjects = new Set([...targets, ...done].map((c) => c.slice(0, 3)));
  const maxLevel = Math.max(100, ...[...done].map(courseLevel));

  const out: Suggestion[] = [];
  for (const code of candidates) {
    const course = catalog.courses.get(code);
    if (!course || courseStatus(catalog, code, done) !== 'available') continue;
    const towardThis = toward.get(code) ?? [];
    if (towardThis.length === 0 && campusOf(code) !== home && (campus !== 'ALL' || oneCampus)) continue;
    if (course.exclusionCodes.some((x) => has.has(x))) continue; // can't take both for credit

    const withThis = satisfiedSet(catalog, new Set([...done, code]));
    const opens = (catalog.unlocks.get(code) ?? []).filter((u) => {
      const req = catalog.courses.get(u)?.req ?? null;
      return !has.has(u) && !evaluate(req, has) && evaluate(req, withThis);
    });
    // name the courses actually completed (CSC148H5 rather than its equivalent CSC148H1)
    const buildsOn = [
      ...new Set([...collectCodes(course.req)].filter((c) => has.has(c)).map((c) => (done.has(c) ? c : (equivalentSource(catalog, c, done) ?? c)))),
    ];
    if (towardThis.length === 0 && opens.length === 0 && buildsOn.length === 0) continue;

    const score =
      W.toward * towardThis.length +
      W.opens * Math.min(opens.length, W.opensCap) +
      (subjects.has(code.slice(0, 3)) ? W.subject : 0) +
      (campusOf(code) === home ? W.campus : 0) +
      (courseLevel(code) <= maxLevel + 100 ? W.level : 0) +
      W.buildsOn * Math.min(buildsOn.length, W.buildsOnCap);

    out.push({
      code,
      score,
      toward: towardThis,
      opens,
      buildsOn,
      checks: [...checksFor(course.req, has), ...course.conditions],
    });
  }
  return out
    .sort((a, b) => b.score - a.score || courseLevel(a.code) - courseLevel(b.code) || a.code.localeCompare(b.code))
    .slice(0, limit);
}

/** Why a course is suggested, most important first, e.g. ["Next step toward CSC384H1", "Opens up 4 courses"]. */
export function reasonsFor(s: Suggestion): string[] {
  const out: string[] = [];
  const others = s.toward.filter((t) => t !== s.code);
  if (s.toward.includes(s.code)) out.push('On your map, and you can take it now');
  if (others.length) out.push(`Next step toward ${others.join(', ')}`);
  if (s.opens.length) out.push(`Opens up ${s.opens.length} course${s.opens.length === 1 ? '' : 's'}`);
  if (s.buildsOn.length) out.push(`Builds on ${s.buildsOn.join(', ')}`);
  return out;
}
