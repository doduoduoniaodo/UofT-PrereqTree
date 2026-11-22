import { useMemo, useState } from 'react';
import Fuse from 'fuse.js';
import { Check, ChevronDown, Search, Trash2, X } from 'lucide-react';
import clsx from 'clsx';
import { campusOf, courseLevel, courseStatus, type Campus, type Catalog, type Course } from '../catalog';
import { collectCodes } from '../prereq';
import { StatusIcon } from './nodes';

interface Props {
  catalog: Catalog;
  done: Set<string>;
  targets: string[];
  campus: Campus | 'ALL';
  setCampus: (c: Campus | 'ALL') => void;
  onToggle: (code: string) => void;
  onAdd: (code: string) => void;
  onClear: () => void;
  /** course shown in the right-hand panel */
  selected: string;
  onSelect: (code: string) => void;
  onRemove: (code: string) => void;
  onClearTargets: () => void;
}

const CAMPUSES: { id: Campus | 'ALL'; label: string }[] = [
  { id: 'ALL', label: 'All' },
  { id: 'UTSG', label: 'St. George' },
  { id: 'UTM', label: 'UTM' },
  { id: 'UTSC', label: 'UTSC' },
];

const CODE_LIKE = /^[a-z]{2,4}[a-z0-9]?\d{0,2}[hy]?\d?$/i;

export function Sidebar({ catalog, done, targets, campus, setCampus, onToggle, onAdd, onClear, selected, onSelect, onRemove, onClearTargets }: Props) {
  const [tab, setTab] = useState<'search' | 'mine'>('search');
  const [query, setQuery] = useState('');

  const fuse = useMemo(
    () => new Fuse(catalog.list, { keys: [{ name: 'code', weight: 2 }, 'title'], threshold: 0.32, ignoreLocation: true }),
    [catalog],
  );

  const results = useMemo(() => {
    const q = query.trim().replace(/\s+/g, '');
    const inCampus = (c: Course) => campus === 'ALL' || c.campus === campus;
    if (!q) return [];
    let found: Course[];
    if (CODE_LIKE.test(q)) {
      const up = q.toUpperCase();
      found = catalog.list.filter((c) => c.code.startsWith(up));
      if (found.length === 0) found = fuse.search(query).map((r) => r.item);
    } else {
      found = fuse.search(query.trim()).map((r) => r.item);
    }
    return found.filter(inCampus).slice(0, 80);
  }, [query, catalog, fuse, campus]);

  // Courses you can now take that build on something you've completed.
  const ready = useMemo(() => {
    if (done.size === 0) return [];
    const out: Course[] = [];
    const seen = new Set<string>();
    for (const code of done) {
      for (const u of catalog.unlocks.get(code) || []) {
        if (seen.has(u)) continue;
        seen.add(u);
        const c = catalog.courses.get(u);
        if (!c || done.has(u)) continue;
        if (campus !== 'ALL' && c.campus !== campus) continue;
        if (courseStatus(catalog, u, done) === 'available') out.push(c);
      }
    }
    return out.sort((a, b) => courseLevel(a.code) - courseLevel(b.code) || a.code.localeCompare(b.code));
  }, [catalog, done, campus]);

  const doneList = useMemo(() => [...done].sort(), [done]);

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-3 border-b border-slate-800 p-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setTab('search');
            }}
            placeholder="Search a course — CSC263, linear algebra…"
            className="w-full rounded-lg border border-slate-700 bg-slate-950 py-2 pl-9 pr-8 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-indigo-500"
          />
          {query && (
            <button onClick={() => setQuery('')} className="absolute right-2 top-2 rounded p-0.5 text-slate-500 hover:text-slate-200" aria-label="Clear search">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="flex gap-1 rounded-lg bg-slate-950 p-1">
          {CAMPUSES.map((c) => (
            <button
              key={c.id}
              onClick={() => setCampus(c.id)}
              className={clsx(
                'flex-1 rounded-md py-1 text-[11px] font-medium transition',
                campus === c.id ? 'bg-slate-800 text-slate-100' : 'text-slate-500 hover:text-slate-300',
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div className="flex gap-4 text-xs">
          <TabButton active={tab === 'search'} onClick={() => setTab('search')}>
            Search
          </TabButton>
          <TabButton active={tab === 'mine'} onClick={() => setTab('mine')}>
            My courses <span className="ml-1 rounded-full bg-slate-800 px-1.5 text-[10px] text-slate-300">{done.size}</span>
          </TabButton>
        </div>
      </div>

      <SelectedList
        catalog={catalog}
        done={done}
        targets={targets}
        selected={selected}
        onSelect={onSelect}
        onRemove={onRemove}
        onClearTargets={onClearTargets}
      />

      <div className="flex-1 overflow-y-auto">
        {tab === 'search' ? (
          query.trim() ? (
            results.length ? (
              results.map((c) => (
                <CourseRow key={c.code} catalog={catalog} course={c} done={done} active={targets.includes(c.code)} onToggle={onToggle} onFocus={onAdd} />
              ))
            ) : (
              <Empty>No courses match “{query}”{campus !== 'ALL' && ' on this campus'}.</Empty>
            )
          ) : (
            <Empty>
              Type a course code or a topic. Click results to add them to the map — you can add several; tick <Check className="inline h-3 w-3" /> the
              courses you've already taken.
            </Empty>
          )
        ) : (
          <div className="pb-4">
            <ListHeader>Ready to take ({ready.length})</ListHeader>
            {ready.length ? (
              ready.map((c) => <CourseRow key={c.code} catalog={catalog} course={c} done={done} active={targets.includes(c.code)} onToggle={onToggle} onFocus={onAdd} />)
            ) : (
              <Empty>{done.size ? 'Nothing new unlocked yet on this campus.' : 'Mark courses as completed to see what they open up.'}</Empty>
            )}
            <ListHeader
              action={
                done.size > 0 && (
                  <button
                    onClick={() => confirm('Clear all completed courses?') && onClear()}
                    className="flex items-center gap-1 text-[10px] normal-case tracking-normal text-slate-500 hover:text-red-400"
                  >
                    <Trash2 className="h-3 w-3" /> Clear
                  </button>
                )
              }
            >
              Completed ({done.size})
            </ListHeader>
            {doneList.map((code) => {
              const c = catalog.courses.get(code);
              return c ? (
                <CourseRow key={code} catalog={catalog} course={c} done={done} active={targets.includes(code)} onToggle={onToggle} onFocus={onAdd} />
              ) : (
                <MissingRow key={code} code={code} onToggle={onToggle} onFocus={onAdd} />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/** The courses currently drawn on the map. */
function SelectedList({
  catalog,
  done,
  targets,
  selected,
  onSelect,
  onRemove,
  onClearTargets,
}: {
  catalog: Catalog;
  done: Set<string>;
  targets: string[];
  selected: string;
  onSelect: (c: string) => void;
  onRemove: (c: string) => void;
  onClearTargets: () => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="border-b border-slate-800 bg-slate-950/40">
      <div className="flex items-center justify-between px-4 py-2">
        <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400 hover:text-slate-200">
          <ChevronDown className={clsx('h-3.5 w-3.5 transition-transform', !open && '-rotate-90')} />
          Selected courses
          <span className="rounded-full bg-indigo-600/80 px-1.5 text-[10px] normal-case tracking-normal text-white">{targets.length}</span>
        </button>
        {targets.length > 1 && (
          <button onClick={onClearTargets} className="text-[10px] text-slate-500 hover:text-red-400">
            Clear all
          </button>
        )}
      </div>
      {open &&
        (targets.length === 0 ? (
          <p className="px-4 pb-3 text-[11px] text-slate-500">None yet — click a search result to add it to the map.</p>
        ) : (
          <div className="max-h-48 overflow-y-auto pb-1.5">
            {targets.map((code) => (
              <div
                key={code}
                onClick={() => onSelect(code)}
                className={clsx(
                  'group flex cursor-pointer items-center gap-2 border-l-2 px-4 py-1.5 hover:bg-slate-800/50',
                  code === selected ? 'border-indigo-500 bg-indigo-950/30' : 'border-transparent',
                )}
              >
                <StatusIcon status={courseStatus(catalog, code, done)} />
                <span className="font-mono text-xs font-semibold text-slate-100">{code}</span>
                <span className="min-w-0 flex-1 truncate text-[11px] text-slate-400">{catalog.courses.get(code)?.title ?? 'Not in catalog data'}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(code);
                  }}
                  className="shrink-0 rounded p-0.5 text-slate-600 hover:bg-slate-700 hover:text-slate-100"
                  aria-label={`Remove ${code} from the map`}
                  title="Remove from map"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        ))}
    </div>
  );
}

function CourseRow({
  catalog,
  course,
  done,
  active,
  onToggle,
  onFocus,
}: {
  catalog: Catalog;
  course: Course;
  done: Set<string>;
  active: boolean;
  onToggle: (c: string) => void;
  onFocus: (c: string) => void;
}) {
  const status = courseStatus(catalog, course.code, done);
  const isDone = done.has(course.code);
  const prereqCount = course.req ? collectCodes(course.req).size : 0;
  return (
    <div
      onClick={() => onFocus(course.code)}
      className={clsx(
        'flex cursor-pointer items-center gap-2.5 border-l-2 px-4 py-2.5 transition hover:bg-slate-800/50',
        active ? 'border-indigo-500 bg-indigo-950/30' : 'border-transparent',
      )}
    >
      <StatusIcon status={status} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[13px] font-semibold text-slate-100">{course.code}</span>
          <span className="text-[10px] text-slate-500">{course.campus === 'Other' ? '' : course.campus}</span>
          {prereqCount === 0 && !course.prereq && <span className="text-[10px] text-slate-500">no prereqs</span>}
        </div>
        <div className="truncate text-xs text-slate-400">{course.title}</div>
      </div>
      <DoneButton isDone={isDone} onClick={() => onToggle(course.code)} />
    </div>
  );
}

function MissingRow({ code, onToggle, onFocus }: { code: string; onToggle: (c: string) => void; onFocus: (c: string) => void }) {
  return (
    <div onClick={() => onFocus(code)} className="flex cursor-pointer items-center gap-2.5 px-4 py-2.5 hover:bg-slate-800/50">
      <StatusIcon status="completed" />
      <div className="min-w-0 flex-1">
        <span className="font-mono text-[13px] font-semibold text-slate-100">{code}</span>
        <span className="ml-2 text-[10px] text-slate-500">{campusOf(code)} · not in catalog data</span>
      </div>
      <DoneButton isDone onClick={() => onToggle(code)} />
    </div>
  );
}

function DoneButton({ isDone, onClick }: { isDone: boolean; onClick: () => void }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={isDone ? 'Mark as not completed' : 'Mark as completed'}
      className={clsx(
        'shrink-0 rounded-md border p-1 transition',
        isDone ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-700 text-slate-600 hover:border-slate-500 hover:text-slate-300',
      )}
    >
      <Check className="h-3.5 w-3.5" strokeWidth={3} />
    </button>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={clsx('border-b-2 pb-1 font-medium transition', active ? 'border-indigo-500 text-slate-100' : 'border-transparent text-slate-500 hover:text-slate-300')}
    >
      {children}
    </button>
  );
}

function ListHeader({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-4 pb-1 pt-4 text-[11px] font-bold uppercase tracking-wider text-slate-500">
      <span>{children}</span>
      {action}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-6 text-xs leading-relaxed text-slate-500">{children}</p>;
}
