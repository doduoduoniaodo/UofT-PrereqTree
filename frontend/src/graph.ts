import dagre from 'dagre';
import { MarkerType, type Edge, type Node } from '@xyflow/react';
import { campusOf, courseStatus, satisfiedSet, type Catalog, type Status } from './catalog';
import { allNotes, collectCodes, evaluate, formatGrade, type Req } from './prereq';
import type { Route } from './path';

export interface GraphOptions {
  depth: number;
  otherCampuses: boolean;
  /** default for every course on the map: draw its postrequisites (what it unlocks)? */
  showUnlocks: boolean;
  /** per-course overrides of showUnlocks, set by the button on each course node */
  unlockOverrides: Map<string, boolean>;
  /** codes the user expanded past the depth limit */
  expanded: Set<string>;
  /** codes whose prerequisites the user hid */
  collapsed: Set<string>;
  /** draw the calendar's "Recommended Preparation" for the selected courses */
  showRecommended: boolean;
  /** mark suggested next courses (see suggest.ts) */
  showSuggestions: boolean;
}

export interface GraphExtras {
  /** suggested next courses -> why (shown as a star on the node) */
  suggested?: Map<string, string>;
  /** courses to always draw, even past the depth limit (e.g. the steps toward suggested courses) */
  reveal?: Set<string>;
}

export interface CourseNodeData {
  code: string;
  title: string;
  status: Status;
  focus: boolean;
  /** has prerequisites that aren't drawn (depth limit, or hidden by the user) */
  truncated: boolean;
  /** its prerequisites are drawn (so they can be hidden) */
  prereqsShown: boolean;
  /** requirements that can't be checked automatically (program, credits, permission, ...) */
  conditions: string[];
  role: 'prereq' | 'focus' | 'unlock' | 'recommended';
  /** suggested as a next course: why */
  suggested?: string;
  /** for courses on the map: how many postrequisites exist and whether they're drawn */
  postreqs?: { total: number; shown: boolean };
  /** while a route is highlighted: on the route (true) or not (false) */
  route?: boolean;
  [key: string]: unknown;
}

export interface GroupNodeData {
  op: 'and' | 'or';
  satisfied: boolean;
  route?: boolean;
  [key: string]: unknown;
}

export interface GraphResult {
  nodes: Node[];
  edges: Edge[];
  hiddenUnlocks: number;
  prunedAlternatives: number;
  /** recommended-preparation courses drawn */
  recommendedShown: number;
  /**
   * The node each node hangs off: a prerequisite's parent is the course (or group) it feeds,
   * a postrequisite's parent is the selected course it comes from. Selected courses have none.
   * Used to keep subtrees together when the user drags nodes around.
   */
  parents: Map<string, string>;
}

const COURSE_W = 210;
const COURSE_H = 62;
const GROUP_W = 64;
const GROUP_H = 24;

const MAX_UNLOCKS = 14;

const COLOR = {
  done: '#34d399',
  idle: '#64748b',
  unlock: '#818cf8',
  recommended: '#2dd4bf',
  route: '#fbbf24',
};

/** Recommended-preparation courses drawn per selected course. */
const MAX_RECOMMENDED = 8;

/** Which campus/division a subtree is being drawn for (the target it hangs off). */
interface Ctx {
  home: ReturnType<typeof campusOf>;
  homeDivision: string | undefined;
}

/**
 * @param highlight a route to highlight (see path.ts): its courses are always drawn (even past the
 *   depth limit or other-campus filtering), its links light up, and everything else is dimmed.
 */
export function buildGraph(
  catalog: Catalog,
  targets: string[],
  done: Set<string>,
  opts: GraphOptions,
  highlight: Pick<Route, 'all' | 'links'> | null = null,
  extras: GraphExtras = {},
): GraphResult {
  // courses that must be drawn even past the depth limit / campus filtering
  const forceSet = new Set([...(highlight?.all ?? []), ...(extras.reveal ?? [])]);
  const force = forceSet.size ? forceSet : null;
  const nodes = new Map<string, Node>();
  const edges = new Map<string, Edge>();
  const expandedCourses = new Set<string>();
  const targetSet = new Set(targets);
  // completed courses + their equivalents: what prerequisite checks use
  const has = satisfiedSet(catalog, done);
  const parents = new Map<string, string>();
  const setParent = (id: string, parent: string) => {
    if (!targetSet.has(id) && !parents.has(id)) parents.set(id, parent);
  };
  let prunedAlternatives = 0;

  const addCourse = (code: string, role: CourseNodeData['role']) => {
    if (nodes.has(code)) return;
    const c = catalog.courses.get(code);
    nodes.set(code, {
      id: code,
      type: 'course',
      position: { x: 0, y: 0 },
      data: {
        code,
        title: c ? c.title : 'Not in the catalog data',
        conditions: c ? [...c.conditions, ...allNotes(c.req)] : [],
        status: courseStatus(catalog, code, done),
        focus: targetSet.has(code),
        truncated: false,
        prereqsShown: false,
        role,
      } satisfies CourseNodeData,
    });
  };

  /** `unlock`: to a postrequisite (dashed); `recommended`: recommended preparation (dotted). */
  const addEdge = (
    source: string,
    target: string,
    { satisfied = false, kind = 'req', grade }: { satisfied?: boolean; kind?: 'req' | 'unlock' | 'recommended'; grade?: string } = {},
  ) => {
    const id = `${source}->${target}`;
    if (edges.has(id)) return;
    const color = kind === 'unlock' ? COLOR.unlock : kind === 'recommended' ? COLOR.recommended : satisfied ? COLOR.done : COLOR.idle;
    const dash = kind === 'unlock' ? '5 4' : kind === 'recommended' ? '2 4' : undefined;
    edges.set(id, {
      id,
      source,
      target,
      type: 'default',
      style: { stroke: color, strokeWidth: satisfied ? 2 : 1.5, strokeDasharray: dash },
      markerEnd: { type: MarkerType.ArrowClosed, color, width: 14, height: 14 },
      // grade minimum on this prerequisite, e.g. "≥60%"
      ...(grade && {
        label: formatGrade(grade),
        labelStyle: { fill: '#fcd34d', fontSize: 10, fontWeight: 600, fontFamily: 'ui-monospace, monospace' },
        labelShowBg: true,
        labelBgStyle: { fill: '#1c1917', stroke: '#92400e', strokeWidth: 1 },
        labelBgPadding: [4, 2] as [number, number],
        labelBgBorderRadius: 4,
      }),
    });
  };

  /** Hide other-campus alternatives and collapse already-satisfied "one of" groups. */
  const prune = (req: Req, ctx: Ctx): Req => {
    if (req.kind === 'course') return req;
    const { home, homeDivision } = ctx;
    let items = req.items.map((i) => prune(i, ctx));
    if (req.kind === 'or') {
      const met = items.find((i) => evaluate(i, has));
      if (met) {
        prunedAlternatives += items.length - 1;
        return met;
      }
      if (!opts.otherCampuses) {
        // Prefer alternatives from the focus course's own campus, then its own division
        // (e.g. hide the Engineering-only path when looking at an Arts & Science course).
        const sameCampus = (c: string) => home === 'Other' || campusOf(c) === home;
        const sameDivision = (c: string) => {
          const d = catalog.courses.get(c)?.division;
          return !d || !homeDivision || d === homeDivision;
        };
        const onRoute = (i: Req) => force !== null && [...collectCodes(i)].some((c) => force.has(c));
        for (const keep of [(c: string) => sameCampus(c) && sameDivision(c), sameCampus]) {
          const local = items.filter((i) => onRoute(i) || [...collectCodes(i)].every(keep));
          if (local.length > 0) {
            if (local.length < items.length) {
              prunedAlternatives += items.length - local.length;
              items = local;
            }
            break;
          }
        }
      }
    }
    return items.length === 1 ? items[0] : { kind: req.kind, items };
  };

  const expand = (code: string, depth: number, ctx: Ctx) => {
    if (expandedCourses.has(code)) return;
    const course = catalog.courses.get(code);
    if (!course?.req) return;
    if (!targetSet.has(code) && has.has(code)) return; // no need to show how you got there
    const data = nodes.get(code)!.data as CourseNodeData;
    const forced = force !== null && force.has(code) && [...collectCodes(course.req)].some((c) => force.has(c));
    if (opts.collapsed.has(code) || (depth >= opts.depth && !opts.expanded.has(code) && !forced)) {
      data.truncated = true;
      return;
    }
    expandedCourses.add(code);
    data.prereqsShown = true;
    attach(prune(course.req, ctx), code, true, depth, ctx);
  };

  const attach = (req: Req, target: string, targetIsCourse: boolean, depth: number, ctx: Ctx) => {
    if (req.kind === 'course') {
      addCourse(req.code, 'prereq');
      setParent(req.code, target);
      addEdge(req.code, target, { satisfied: has.has(req.code), grade: req.grade });
      expand(req.code, depth + 1, ctx);
      return;
    }
    if (req.kind === 'and' && targetIsCourse) {
      for (const item of req.items) attach(item, target, true, depth, ctx);
      return;
    }
    // Stable id (same group -> same id across rebuilds) so dragged positions stick.
    const base = `g:${target}:${req.kind}:${[...collectCodes(req)].join(',')}`;
    let id = base;
    for (let n = 2; nodes.has(id); n++) id = `${base}#${n}`;
    const satisfied = evaluate(req, has);
    nodes.set(id, {
      id,
      type: 'reqgroup',
      position: { x: 0, y: 0 },
      data: { op: req.kind, satisfied } satisfies GroupNodeData,
    });
    addEdge(id, target, { satisfied });
    setParent(id, target);
    for (const item of req.items) attach(item, id, false, depth, ctx);
  };

  const ctxFor = (code: string): Ctx => ({ home: campusOf(code), homeDivision: catalog.courses.get(code)?.division });
  for (const t of targets) addCourse(t, 'focus');
  for (const t of targets) expand(t, 0, ctxFor(t));

  // Recommended preparation: optional courses the calendar suggests, as dotted arrows into the course.
  let recommendedShown = 0;
  if (opts.showRecommended) {
    for (const t of targets) {
      const codes = [...collectCodes(catalog.courses.get(t)?.recReq ?? null)].filter((c) => c !== t);
      const local = codes.filter((c) => opts.otherCampuses || campusOf(c) === campusOf(t));
      for (const code of (local.length ? local : codes).slice(0, MAX_RECOMMENDED)) {
        if (!nodes.has(code)) {
          addCourse(code, 'recommended');
          recommendedShown++;
        }
        setParent(code, t);
        addEdge(code, t, { kind: 'recommended' });
      }
    }
  }

  // Postrequisites: which courses on the map should show what they unlock?
  const unlocksOf = (t: string) => {
    const home = campusOf(t);
    return (catalog.unlocks.get(t) || []).filter((c) => opts.otherCampuses || home === 'Other' || campusOf(c) === home);
  };
  const showing = targets.filter((t) => opts.unlockOverrides.get(t) ?? opts.showUnlocks);
  for (const t of targets) {
    (nodes.get(t)!.data as CourseNodeData).postreqs = { total: unlocksOf(t).length, shown: showing.includes(t) };
  }

  let hiddenUnlocks = 0;
  if (showing.length) {
    // Share the unlock budget between targets so several targets don't drown the graph.
    const perTarget = showing.length === 1 ? MAX_UNLOCKS : Math.max(3, Math.floor(MAX_UNLOCKS / showing.length));
    const rank = (c: string) => {
      const s = courseStatus(catalog, c, done);
      return s === 'available' ? 0 : s === 'locked' ? 1 : 2;
    };
    const unlockNodes = new Set<string>();
    for (const t of showing) {
      const fresh = unlocksOf(t).filter((c) => !nodes.has(c) || unlockNodes.has(c)).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
      hiddenUnlocks += Math.max(0, fresh.length - perTarget);
      for (const code of fresh.slice(0, perTarget)) {
        addCourse(code, 'unlock');
        setParent(code, t);
        unlockNodes.add(code);
      }
    }
    // connect every target to every drawn unlock it leads to
    for (const t of showing) {
      for (const c of catalog.unlocks.get(t) || []) if (unlockNodes.has(c)) addEdge(t, c, { kind: 'unlock' });
    }
  }

  for (const [code, why] of extras.suggested ?? []) {
    const node = nodes.get(code);
    if (node?.type === 'course') (node.data as CourseNodeData).suggested = why;
  }

  if (highlight) highlightRoute(nodes, edges, highlight);

  return {
    ...layout([...nodes.values()], [...edges.values()]),
    hiddenUnlocks,
    prunedAlternatives,
    recommendedShown,
    parents,
  };
}

/**
 * Mark the route's courses, and the exact arrows (and "one of"/"all of" markers) for each link the
 * route uses, e.g. MAT149H1 -> [all of] -> [one of] -> STA237H1. Everything else is dimmed.
 */
function highlightRoute(nodes: Map<string, Node>, edges: Map<string, Edge>, route: Pick<Route, 'all' | 'links'>) {
  const onNodes = new Set<string>();
  for (const n of nodes.values()) if (n.type === 'course' && route.all.has(n.id)) onNodes.add(n.id);

  const outOf = new Map<string, Edge[]>();
  for (const e of edges.values()) {
    if (e.style?.strokeDasharray) continue; // postrequisite arrows are never part of a route
    const list = outOf.get(e.source);
    if (list) list.push(e);
    else outOf.set(e.source, [e]);
  }
  // From the prerequisite, follow each arrow through any markers (each marker has exactly one
  // outgoing arrow) and keep the paths that end at the course that needs it.
  const onEdges = new Set<string>();
  for (const [from, to] of route.links) {
    for (const first of outOf.get(from) ?? []) {
      const path = [first];
      let cur = first.target;
      while (cur !== to && nodes.get(cur)?.type === 'reqgroup' && path.length < 50) {
        const next = outOf.get(cur)?.[0];
        if (!next) break;
        path.push(next);
        cur = next.target;
      }
      if (cur !== to) continue;
      for (const e of path) {
        onEdges.add(e.id);
        onNodes.add(e.target);
      }
    }
  }

  for (const n of nodes.values()) (n.data as CourseNodeData | GroupNodeData).route = onNodes.has(n.id);
  for (const [id, e] of edges) {
    const on = onEdges.has(id);
    edges.set(
      id,
      on
        ? {
            ...e,
            animated: true,
            style: { ...e.style, stroke: COLOR.route, strokeWidth: 2.5 },
            markerEnd: { type: MarkerType.ArrowClosed, color: COLOR.route, width: 14, height: 14 },
            zIndex: 1,
          }
        : dimmed(e),
    );
  }
}

/** An arrow that's not on the route: faded, and without its grade label (which would float on its own). */
function dimmed(e: Edge): Edge {
  const { label: _label, labelStyle: _ls, labelShowBg: _lsb, labelBgStyle: _lbs, labelBgPadding: _lbp, labelBgBorderRadius: _lbr, ...rest } = e;
  return { ...rest, style: { ...e.style, opacity: 0.15 } };
}

function layout(nodes: Node[], edges: Edge[]) {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'LR', nodesep: 14, ranksep: 56, marginx: 20, marginy: 20 });
  for (const n of nodes) {
    const isGroup = n.type === 'reqgroup';
    g.setNode(n.id, { width: isGroup ? GROUP_W : COURSE_W, height: isGroup ? GROUP_H : COURSE_H });
  }
  for (const e of edges) g.setEdge(e.source, e.target);
  dagre.layout(g);
  return {
    nodes: nodes.map((n) => {
      const p = g.node(n.id);
      return { ...n, width: p.width, height: p.height, position: { x: p.x - p.width / 2, y: p.y - p.height / 2 } };
    }),
    edges,
  };
}
