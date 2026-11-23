import { useCallback, useEffect, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Link2, Loader2, Network } from 'lucide-react';
import { loadCatalog, type Campus, type Catalog } from './catalog';
import type { GraphOptions } from './graph';
import { readTargetsFromUrl, useProgress, writeUrl } from './useProgress';
import { Sidebar } from './components/Sidebar';
import { GraphView } from './components/GraphView';
import { Inspector } from './components/Inspector';

const EXAMPLES = ['CSC263H1', 'CSC373H1', 'MAT224H1', 'CSC311H5', 'CSCC63H3', 'ECE345H1', 'STA261H1', 'PSL300H1'];

export default function App() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState('');
  const { done, toggle, clear } = useProgress();
  const [targets, setTargets] = useState<string[]>(readTargetsFromUrl);
  const [selected, setSelected] = useState(() => targets[targets.length - 1] ?? '');
  const [campus, setCampus] = useState<Campus | 'ALL'>('ALL');
  const [opts, setOpts] = useState<GraphOptions>({ depth: 2, otherCampuses: false, showUnlocks: true, unlockOverrides: new Map(), expanded: new Set(), collapsed: new Set() });
  const [copied, setCopied] = useState(false);
  // course whose fastest route is highlighted; only meaningful while it's on the map
  const [routeFor, setRouteFor] = useState<string | null>(null);
  const activeRoute = routeFor && targets.includes(routeFor) ? routeFor : null;

  useEffect(() => {
    loadCatalog()
      .then(setCatalog)
      .catch((e: Error) => setError(e.message));
  }, []);

  /** Put a course on the map (keeps the others) and inspect it. */
  const addTarget = useCallback((code: string) => {
    setTargets((t) => (t.includes(code) ? t : [...t, code]));
    setSelected(code);
  }, []);

  const removeTarget = useCallback(
    (code: string) => {
      const next = targets.filter((c) => c !== code);
      setTargets(next);
      if (selected === code) setSelected(next[next.length - 1] ?? '');
    },
    [targets, selected],
  );

  const showRoute = useCallback((code: string | null) => {
    if (code) {
      setTargets((t) => (t.includes(code) ? t : [...t, code]));
      setSelected(code);
    }
    setRouteFor(code);
  }, []);

  const showOnly = useCallback((code: string) => {
    setTargets([code]);
    setSelected(code);
    setOpts((o) => ({ ...o, expanded: new Set(), collapsed: new Set() }));
  }, []);

  const clearTargets = useCallback(() => {
    setTargets([]);
    setSelected('');
    setOpts((o) => ({ ...o, expanded: new Set(), collapsed: new Set() }));
  }, []);

  useEffect(() => {
    window.history.replaceState(null, '', writeUrl(targets));
  }, [targets]);

  const share = async () => {
    try {
      await navigator.clipboard.writeText(writeUrl(targets, done));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      prompt('Copy this link:', writeUrl(targets, done));
    }
  };

  if (error) return <FullScreen>Couldn't load course data: {error}</FullScreen>;
  if (!catalog)
    return (
      <FullScreen>
        <Loader2 className="h-5 w-5 animate-spin text-indigo-400" /> Loading 6,000+ UofT courses…
      </FullScreen>
    );

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-950 font-sans text-slate-100">
      <aside className="flex w-[340px] shrink-0 flex-col border-r border-slate-800 bg-slate-900">
        <header className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="rounded-lg bg-indigo-600 p-1.5">
              <Network className="h-4 w-4 text-white" />
            </div>
            <div>
              <h1 className="text-sm font-bold leading-tight">UofT PrereqTree</h1>
              <p className="text-[11px] text-slate-500">See what you need, and what it opens up</p>
            </div>
          </div>
          <button
            onClick={share}
            title="Copy a link to this tree and your completed courses"
            className="flex items-center gap-1.5 rounded-lg bg-slate-800 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-slate-700"
          >
            <Link2 className="h-3.5 w-3.5" />
            {copied ? 'Copied!' : 'Share'}
          </button>
        </header>
        <div className="min-h-0 flex-1">
          <Sidebar
            catalog={catalog}
            done={done}
            targets={targets}
            campus={campus}
            setCampus={setCampus}
            onToggle={toggle}
            onAdd={addTarget}
            onClear={clear}
            selected={selected}
            onSelect={setSelected}
            onRemove={removeTarget}
            onClearTargets={clearTargets}
          />
        </div>
      </aside>

      <main className="relative min-w-0 flex-1">
        {targets.length > 0 ? (
          <ReactFlowProvider>
            <GraphView
              catalog={catalog}
              targets={targets}
              done={done}
              opts={opts}
              setOpts={setOpts}
              selected={selected}
              onSelect={setSelected}
              onAdd={addTarget}
              onRemove={removeTarget}
              onClearTargets={clearTargets}
              routeFor={activeRoute}
              onShowRoute={showRoute}
            />
          </ReactFlowProvider>
        ) : (
          <Welcome catalog={catalog} onFocus={addTarget} />
        )}
      </main>

      {selected && (
        <aside className="w-[360px] shrink-0 overflow-y-auto border-l border-slate-800 bg-slate-900">
          <Inspector
            catalog={catalog}
            code={selected}
            targets={targets}
            done={done}
            onToggle={toggle}
            onSelect={setSelected}
            onAdd={addTarget}
            onRemove={removeTarget}
            onShowOnly={showOnly}
            routeFor={activeRoute}
            onShowRoute={showRoute}
          />
        </aside>
      )}
    </div>
  );
}

function Welcome({ catalog, onFocus }: { catalog: Catalog; onFocus: (c: string) => void }) {
  const examples = EXAMPLES.filter((c) => catalog.courses.has(c));
  return (
    <div className="flex h-full flex-col items-center justify-center p-8 text-center">
      <Network className="mb-4 h-10 w-10 text-indigo-400/60" />
      <h2 className="text-lg font-semibold text-slate-200">Pick a course to map its prerequisites</h2>
      <p className="mt-1 max-w-md text-sm text-slate-500">
        The tree shows every course you need, with “one of” groups where any option works. Mark what you've taken and it'll show what you can
        take next.
      </p>
      <div className="mt-6 flex max-w-lg flex-wrap justify-center gap-2">
        {examples.map((c) => (
          <button
            key={c}
            onClick={() => onFocus(c)}
            className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-left hover:border-indigo-500"
          >
            <div className="font-mono text-xs font-semibold text-indigo-300">{c}</div>
            <div className="max-w-[160px] truncate text-[11px] text-slate-500">{catalog.courses.get(c)?.title}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function FullScreen({ children }: { children: React.ReactNode }) {
  return <div className="flex h-screen items-center justify-center gap-3 bg-slate-950 text-sm text-slate-400">{children}</div>;
}
