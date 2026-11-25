import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Background, Controls, ReactFlow, useNodesInitialized, useReactFlow, type Node, type NodeChangeset } from '@xyflow/react';
import { Minus, Plus, RotateCcw, Route as RouteIcon, X } from 'lucide-react';
import clsx from 'clsx';
import { courseStatus, type Catalog } from '../catalog';
import { buildGraph, type GraphExtras, type GraphOptions, type GraphResult } from '../graph';
import { reasonsFor, type Suggestion } from '../suggest';
import { offsetFor, placeNodes, reconcileOffsets, type Offset, type Size } from '../placement';
import { findRoute } from '../path';
import { nodeTypes } from './nodes';
import { GraphActionsContext } from './graphActions';
import { StatusIcon } from './nodes';

interface Props {
  catalog: Catalog;
  targets: string[];
  done: Set<string>;
  opts: GraphOptions;
  setOpts: (fn: (o: GraphOptions) => GraphOptions) => void;
  selected: string;
  onSelect: (code: string) => void;
  onAdd: (code: string) => void;
  onRemove: (code: string) => void;
  onClearTargets: () => void;
  /** selected course whose fastest route is highlighted */
  routeFor: string | null;
  onShowRoute: (code: string | null) => void;
  suggestions: Suggestion[];
}

export function GraphView({
  catalog,
  targets,
  done,
  opts,
  setOpts,
  selected,
  onSelect,
  onAdd,
  onRemove,
  onClearTargets,
  routeFor,
  onShowRoute,
  suggestions,
}: Props) {
  const route = useMemo(() => (routeFor ? findRoute(catalog, routeFor, done) : null), [catalog, routeFor, done]);
  // Suggestions on the map: star them, and draw the steps toward the selected courses they lead to.
  const extras = useMemo<GraphExtras>(() => {
    if (!opts.showSuggestions) return {};
    const toward = new Set(suggestions.flatMap((s) => s.toward));
    const reveal = new Set<string>();
    for (const t of toward) for (const c of findRoute(catalog, t, done).all) reveal.add(c);
    return { suggested: new Map(suggestions.map((s) => [s.code, reasonsFor(s).join(' · ')])), reveal };
  }, [opts.showSuggestions, suggestions, catalog, done]);
  const graph = useMemo(() => buildGraph(catalog, targets, done, opts, route, extras), [catalog, targets, done, opts, route, extras]);
  // Node positions relative to the node each one hangs off (see placement.ts): set by dragging,
  // and by keeping the existing layout stable whenever the graph changes.
  const [offsets, setOffsets] = useState<Map<string, Offset>>(() => new Map());
  const [dragging, setDragging] = useState<Set<string>>(() => new Set());

  // Graph rebuilt (expand/collapse, course added, ...)? Keep what's on screen where it is,
  // put new nodes in their default spot next to their course, and only nudge that course if needed.
  const [prevGraph, setPrevGraph] = useState(graph);
  if (graph !== prevGraph) {
    const prevPlaced = placeNodes(layoutOf(prevGraph), prevGraph.parents, offsets);
    setOffsets(reconcileOffsets(prevPlaced, layoutOf(graph), graph.parents, sizesOf(graph)));
    setPrevGraph(graph);
  }

  const placed = useMemo(() => placeNodes(layoutOf(graph), graph.parents, offsets), [graph, offsets]);
  // Latest positions/parents for the drag handler (which React Flow may call between renders).
  const placedRef = useRef(placed);
  const parentsRef = useRef(graph.parents);
  useLayoutEffect(() => {
    placedRef.current = placed;
    parentsRef.current = graph.parents;
  }, [placed, graph]);

  const nodes = useMemo(
    () =>
      graph.nodes.map((n) => ({
        ...n,
        position: placed.get(n.id) ?? n.position,
        selected: n.id === selected,
        dragging: dragging.has(n.id),
      })),
    [graph, selected, placed, dragging],
  );
  const onNodesChange = useCallback((changes: NodeChangeset<Node>) => {
    const pos = changes.getByType('position');
    if (!pos.length) return;
    setOffsets((m) => {
      const next = new Map(m);
      for (const c of pos) if (c.position) next.set(c.id, offsetFor(c.id, c.position, parentsRef.current, placedRef.current));
      return next;
    });
    setDragging((d) => {
      const next = new Set(d);
      for (const c of pos) {
        if (c.dragging) next.add(c.id);
        else next.delete(c.id);
      }
      return next;
    });
  }, []);
  const { fitView } = useReactFlow();

  // Fit once React Flow has measured the nodes, and again when courses are added/removed or the
  // depth changes. Expanding/collapsing a single course doesn't re-fit, so nothing jumps on screen.
  const fitKey = `${targets.join(',')}|${opts.depth}|${opts.otherCampuses}|${routeFor}|${opts.showRecommended}|${opts.showSuggestions}`;
  const initialized = useNodesInitialized();
  useEffect(() => {
    if (!initialized) return;
    const t = setTimeout(() => fitView({ duration: 350, padding: 0.12, maxZoom: 1.1 }), 30);
    return () => clearTimeout(t);
  }, [fitKey, initialized, fitView]);

  // Re-fit when the panel itself changes size (window resize, side panel opening).
  const wrapper = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = wrapper.current;
    if (!el) return;
    let t: ReturnType<typeof setTimeout>;
    const ro = new ResizeObserver(() => {
      clearTimeout(t);
      t = setTimeout(() => fitView({ padding: 0.12, maxZoom: 1.1 }), 120);
    });
    ro.observe(el);
    return () => {
      clearTimeout(t);
      ro.disconnect();
    };
  }, [fitView]);

  const actions = useMemo(
    () => ({
      onExpand: (code: string) =>
        setOpts((o) => {
          const collapsed = new Set(o.collapsed);
          collapsed.delete(code);
          return { ...o, collapsed, expanded: new Set(o.expanded).add(code) };
        }),
      onCollapse: (code: string) =>
        setOpts((o) => {
          const expanded = new Set(o.expanded);
          expanded.delete(code);
          return { ...o, expanded, collapsed: new Set(o.collapsed).add(code) };
        }),
      onToggleUnlocks: (code: string) =>
        setOpts((o) => {
          const current = o.unlockOverrides.get(code) ?? o.showUnlocks;
          return { ...o, unlockOverrides: new Map(o.unlockOverrides).set(code, !current) };
        }),
    }),
    [setOpts],
  );

  const courseCount = graph.nodes.filter((n) => n.type === 'course').length;

  return (
    <GraphActionsContext.Provider value={actions}>
      <div ref={wrapper} className="relative h-full w-full">
        <ReactFlow
          nodes={nodes}
          edges={graph.edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.12, maxZoom: 1.1 }}
          onNodesChange={onNodesChange}
          nodesDraggable
          nodesConnectable={false}
          minZoom={0.1}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
          onNodeClick={(_, n) => n.type === 'course' && onSelect(n.id)}
          onNodeDoubleClick={(_, n) => n.type === 'course' && onAdd(n.id)}
          onPaneClick={() => onSelect(targets[targets.length - 1])}
          className="!bg-slate-950"
        >
          <Background color="#1e293b" gap={22} size={1} />
          <Controls showInteractive={false} position="bottom-right" />
        </ReactFlow>

        {/* courses on the map + toolbar */}
        <div className="absolute left-3 right-3 top-3 z-10 space-y-2 text-xs pointer-events-none [&>*]:pointer-events-auto">
        <div className="flex flex-wrap items-center gap-1.5 w-fit max-w-full">
          {targets.map((t) => (
            <span
              key={t}
              className={clsx(
                'flex items-center gap-1.5 rounded-lg border py-1 pl-2 pr-1 backdrop-blur transition',
                t === selected ? 'border-indigo-400 bg-indigo-950/90' : 'border-slate-700 bg-slate-900/90 hover:border-slate-500',
              )}
            >
              <button onClick={() => onSelect(t)} className="flex items-center gap-1.5">
                <StatusIcon status={courseStatus(catalog, t, done)} className="h-3 w-3" />
                <span className="font-mono font-semibold text-slate-100">{t}</span>
              </button>
              <button onClick={() => onRemove(t)} className="rounded p-0.5 text-slate-500 hover:bg-slate-700 hover:text-slate-100" aria-label={`Remove ${t} from the map`}>
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          {route && (
            <span className="flex items-center gap-1.5 rounded-lg border border-amber-500/60 bg-amber-950/80 py-1 pl-2 pr-1 text-amber-200 backdrop-blur">
              <RouteIcon className="h-3 w-3" />
              Route to <span className="font-mono font-semibold">{route.target}</span>
              <span className="text-amber-300/70">
                · {route.before.length} course{route.before.length === 1 ? '' : 's'} first
              </span>
              <button onClick={() => onShowRoute(null)} className="rounded p-0.5 hover:bg-amber-900" aria-label="Stop highlighting the route">
                <X className="h-3 w-3" />
              </button>
            </span>
          )}
          {targets.length > 1 && (
            <button onClick={onClearTargets} className="rounded-lg px-2 py-1 text-slate-500 hover:text-slate-200">
              Clear all
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 w-fit">
          <div className="flex items-center rounded-lg border border-slate-800 bg-slate-900/90 backdrop-blur">
            <span className="px-2.5 text-slate-400">Depth</span>
            <button
              className="border-l border-slate-800 p-1.5 text-slate-300 hover:bg-slate-800 disabled:opacity-30"
              disabled={opts.depth <= 1}
              onClick={() => setOpts((o) => ({ ...o, depth: o.depth - 1, expanded: new Set() }))}
              aria-label="Show fewer levels"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <span className="w-6 text-center font-mono text-slate-100">{opts.depth >= 99 ? '∞' : opts.depth}</span>
            <button
              className="border-l border-slate-800 p-1.5 text-slate-300 hover:bg-slate-800 disabled:opacity-30"
              disabled={opts.depth >= 8}
              onClick={() => setOpts((o) => ({ ...o, depth: o.depth + 1 }))}
              aria-label="Show more levels"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
          <Toggle
            on={opts.showUnlocks}
            onClick={() => setOpts((o) => ({ ...o, showUnlocks: !o.showUnlocks, unlockOverrides: new Map() }))}
          >
            Postrequisites (all)
          </Toggle>
          <Toggle on={opts.otherCampuses} onClick={() => setOpts((o) => ({ ...o, otherCampuses: !o.otherCampuses }))}>
            All alternatives
          </Toggle>
          <Toggle on={opts.showRecommended} onClick={() => setOpts((o) => ({ ...o, showRecommended: !o.showRecommended }))}>
            Recommended prep
          </Toggle>
          <Toggle on={opts.showSuggestions} onClick={() => setOpts((o) => ({ ...o, showSuggestions: !o.showSuggestions }))}>
            ★ Suggested next
          </Toggle>
          {offsets.size > 0 && (
            <button
              onClick={() => {
                setOffsets(new Map());
                setTimeout(() => fitView({ duration: 350, padding: 0.12, maxZoom: 1.1 }), 30);
              }}
              className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900/90 px-2.5 py-1.5 text-slate-300 backdrop-blur hover:text-white"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset layout
            </button>
          )}
        </div>
        </div>

        {/* legend + stats */}
        <div className="pointer-events-none absolute bottom-3 left-3 z-10 space-y-1.5 rounded-lg border border-slate-800 bg-slate-900/90 px-3 py-2 text-[11px] text-slate-400 backdrop-blur">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Legend className="bg-emerald-400">Completed</Legend>
            <Legend className="bg-teal-400">Equivalent done</Legend>
            <Legend className="bg-sky-400">Can take now</Legend>
            <Legend className="bg-slate-600">Locked</Legend>
            <span className="flex items-center gap-1.5">
              <span className="rounded-full border border-amber-500/60 px-1 text-[8px] font-bold uppercase text-amber-300">one of</span>
              any one is enough
            </span>
            <span className="flex items-center gap-1.5">
              <span className="rounded border border-amber-800 bg-stone-900 px-1 font-mono text-[9px] font-semibold text-amber-300">≥60%</span>
              grade needed
            </span>
            {opts.showRecommended && (
              <span className="flex items-center gap-1.5">
                <span className="w-4 border-t-2 border-dotted border-teal-400" />
                recommended (optional)
              </span>
            )}
            {opts.showSuggestions && (
              <span className="flex items-center gap-1.5">
                <span className="rounded-full bg-violet-600 px-1 text-[9px] font-bold text-white">★</span>
                suggested next
              </span>
            )}
            <span className="flex items-center gap-1.5">
              <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full border border-amber-600/70 bg-amber-950 text-[9px] font-bold text-amber-300">
                ?
              </span>
              other requirements
            </span>
          </div>
          <div className="text-slate-500">
            {courseCount} courses
            {graph.prunedAlternatives > 0 && ` · ${graph.prunedAlternatives} alternatives hidden`}
            {opts.showRecommended && ` · ${graph.recommendedShown} recommended`}
            {graph.hiddenUnlocks > 0 && ` · +${graph.hiddenUnlocks} more postrequisites in the side panel`}
            {' · '}drag to move (its subtree follows) · double-click a course to add it to the map
          </div>
        </div>
      </div>
    </GraphActionsContext.Provider>
  );
}

function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 backdrop-blur transition',
        on ? 'border-indigo-500/60 bg-indigo-950/80 text-indigo-200' : 'border-slate-800 bg-slate-900/90 text-slate-400 hover:text-slate-200',
      )}
    >
      <span className={clsx('h-2 w-2 rounded-full', on ? 'bg-indigo-400' : 'bg-slate-600')} />
      {children}
    </button>
  );
}

function Legend({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={clsx('h-2 w-2 rounded-full', className)} />
      {children}
    </span>
  );
}

function layoutOf(graph: GraphResult) {
  return new Map(graph.nodes.map((n) => [n.id, n.position] as const));
}

function sizesOf(graph: GraphResult) {
  return new Map<string, Size>(graph.nodes.map((n) => [n.id, { width: n.width ?? 0, height: n.height ?? 0 }]));
}
