import dagre from 'dagre';
import { MarkerType, type Edge, type Node } from '@xyflow/react';
import { campusOf, courseStatus, type Catalog, type Status } from './catalog';
import { collectCodes, evaluate, type Req } from './prereq';

export interface GraphOptions {
  depth: number;
  otherCampuses: boolean;
  showUnlocks: boolean;
  /** codes the user expanded past the depth limit */
  expanded: Set<string>;
}

export interface CourseNodeData {
  code: string;
  title: string;
  status: Status;
  focus: boolean;
  /** has prerequisites that aren't drawn (depth limit) */
  truncated: boolean;
  role: 'prereq' | 'focus' | 'unlock';
  [key: string]: unknown;
}

export interface GroupNodeData {
  op: 'and' | 'or';
  satisfied: boolean;
  [key: string]: unknown;
}

export interface GraphResult {
  nodes: Node[];
  edges: Edge[];
  hiddenUnlocks: number;
  prunedAlternatives: number;
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
};

/** Which campus/division a subtree is being drawn for (the target it hangs off). */
interface Ctx {
  home: ReturnType<typeof campusOf>;
  homeDivision: string | undefined;
}

export function buildGraph(catalog: Catalog, targets: string[], done: Set<string>, opts: GraphOptions): GraphResult {
  const nodes = new Map<string, Node>();
  const edges = new Map<string, Edge>();
  const expandedCourses = new Set<string>();
  const targetSet = new Set(targets);
  let groupId = 0;
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
        status: courseStatus(catalog, code, done),
        focus: targetSet.has(code),
        truncated: false,
        role,
      } satisfies CourseNodeData,
    });
  };

  const addEdge = (source: string, target: string, satisfied: boolean, dashed = false) => {
    const id = `${source}->${target}`;
    if (edges.has(id)) return;
    const color = dashed ? COLOR.unlock : satisfied ? COLOR.done : COLOR.idle;
    edges.set(id, {
      id,
      source,
      target,
      type: 'default',
      style: { stroke: color, strokeWidth: satisfied ? 2 : 1.5, strokeDasharray: dashed ? '5 4' : undefined },
      markerEnd: { type: MarkerType.ArrowClosed, color, width: 14, height: 14 },
    });
  };

  /** Hide other-campus alternatives and collapse already-satisfied "one of" groups. */
  const prune = (req: Req, ctx: Ctx): Req => {
    if (req.kind === 'course') return req;
    const { home, homeDivision } = ctx;
    let items = req.items.map((i) => prune(i, ctx));
    if (req.kind === 'or') {
      const met = items.find((i) => evaluate(i, done));
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
        for (const keep of [(c: string) => sameCampus(c) && sameDivision(c), sameCampus]) {
          const local = items.filter((i) => [...collectCodes(i)].every(keep));
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
    if (!targetSet.has(code) && done.has(code)) return; // no need to show how you got there
    const node = nodes.get(code)!;
    if (depth >= opts.depth && !opts.expanded.has(code)) {
      (node.data as CourseNodeData).truncated = true;
      return;
    }
    expandedCourses.add(code);
    attach(prune(course.req, ctx), code, true, depth, ctx);
  };

  const attach = (req: Req, target: string, targetIsCourse: boolean, depth: number, ctx: Ctx) => {
    if (req.kind === 'course') {
      addCourse(req.code, 'prereq');
      addEdge(req.code, target, done.has(req.code));
      expand(req.code, depth + 1, ctx);
      return;
    }
    if (req.kind === 'and' && targetIsCourse) {
      for (const item of req.items) attach(item, target, true, depth, ctx);
      return;
    }
    const id = `group-${groupId++}`;
    const satisfied = evaluate(req, done);
    nodes.set(id, {
      id,
      type: 'reqgroup',
      position: { x: 0, y: 0 },
      data: { op: req.kind, satisfied } satisfies GroupNodeData,
    });
    addEdge(id, target, satisfied);
    for (const item of req.items) attach(item, id, false, depth, ctx);
  };

  const ctxFor = (code: string): Ctx => ({ home: campusOf(code), homeDivision: catalog.courses.get(code)?.division });
  for (const t of targets) addCourse(t, 'focus');
  for (const t of targets) expand(t, 0, ctxFor(t));

  let hiddenUnlocks = 0;
  if (opts.showUnlocks) {
    // Share the unlock budget between targets so several targets don't drown the graph.
    const perTarget = targets.length === 1 ? MAX_UNLOCKS : Math.max(3, Math.floor(MAX_UNLOCKS / targets.length));
    const rank = (c: string) => {
      const s = courseStatus(catalog, c, done);
      return s === 'available' ? 0 : s === 'locked' ? 1 : 2;
    };
    const unlockNodes = new Set<string>();
    for (const t of targets) {
      const home = campusOf(t);
      const all = (catalog.unlocks.get(t) || []).filter((c) => opts.otherCampuses || home === 'Other' || campusOf(c) === home);
      const fresh = all.filter((c) => !nodes.has(c) || unlockNodes.has(c)).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
      hiddenUnlocks += Math.max(0, fresh.length - perTarget);
      for (const code of fresh.slice(0, perTarget)) {
        addCourse(code, 'unlock');
        unlockNodes.add(code);
      }
    }
    // connect every target to every drawn unlock it leads to
    for (const t of targets) {
      for (const c of catalog.unlocks.get(t) || []) if (unlockNodes.has(c)) addEdge(t, c, false, true);
    }
  }

  return { ...layout([...nodes.values()], [...edges.values()]), hiddenUnlocks, prunedAlternatives };
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
