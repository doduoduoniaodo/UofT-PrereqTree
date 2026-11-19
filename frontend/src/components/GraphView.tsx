import { useEffect, useMemo } from 'react';
import { Background, Controls, ReactFlow, useReactFlow } from '@xyflow/react';
import { Minus, Plus, X } from 'lucide-react';
import clsx from 'clsx';
import { courseStatus, type Catalog } from '../catalog';
import { buildGraph, type GraphOptions } from '../graph';
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
}

export function GraphView({ catalog, targets, done, opts, setOpts, selected, onSelect, onAdd, onRemove, onClearTargets }: Props) {
  const graph = useMemo(() => buildGraph(catalog, targets, done, opts), [catalog, targets, done, opts]);
  const nodes = useMemo(() => graph.nodes.map((n) => ({ ...n, selected: n.id === selected })), [graph, selected]);
  const { fitView } = useReactFlow();

  const shape = graph.nodes.map((n) => n.id).join('|');
  useEffect(() => {
    const t = setTimeout(() => fitView({ duration: 350, padding: 0.12, maxZoom: 1.1 }), 60);
    return () => clearTimeout(t);
  }, [shape, fitView]);

  const actions = useMemo(
    () => ({ onExpand: (code: string) => setOpts((o) => ({ ...o, expanded: new Set(o.expanded).add(code) })) }),
    [setOpts],
  );

  const courseCount = graph.nodes.filter((n) => n.type === 'course').length;

  return (
    <GraphActionsContext.Provider value={actions}>
      <div className="relative h-full w-full">
        <ReactFlow
          nodes={nodes}
          edges={graph.edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.12, maxZoom: 1.1 }}
          nodesDraggable={false}
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
          <Toggle on={opts.showUnlocks} onClick={() => setOpts((o) => ({ ...o, showUnlocks: !o.showUnlocks }))}>
            What it unlocks
          </Toggle>
          <Toggle on={opts.otherCampuses} onClick={() => setOpts((o) => ({ ...o, otherCampuses: !o.otherCampuses }))}>
            All alternatives
          </Toggle>
        </div>
        </div>

        {/* legend + stats */}
        <div className="pointer-events-none absolute bottom-3 left-3 z-10 space-y-1.5 rounded-lg border border-slate-800 bg-slate-900/90 px-3 py-2 text-[11px] text-slate-400 backdrop-blur">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Legend className="bg-emerald-400">Completed</Legend>
            <Legend className="bg-sky-400">Can take now</Legend>
            <Legend className="bg-slate-600">Locked</Legend>
            <span className="flex items-center gap-1.5">
              <span className="rounded-full border border-amber-500/60 px-1 text-[8px] font-bold uppercase text-amber-300">one of</span>
              any one is enough
            </span>
          </div>
          <div className="text-slate-500">
            {courseCount} courses
            {graph.prunedAlternatives > 0 && ` · ${graph.prunedAlternatives} alternatives hidden`}
            {graph.hiddenUnlocks > 0 && ` · +${graph.hiddenUnlocks} more unlocks in the side panel`}
            {' · '}double-click a course to add it to the map
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
