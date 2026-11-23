import { useMemo, useState } from 'react';
import { AlertTriangle, Check, Crosshair, ExternalLink, Minus, Plus, Route as RouteIcon, X } from 'lucide-react';
import clsx from 'clsx';
import { CAMPUS_LABEL, campusOf, courseStatus, equivalentSource, isSatisfied, satisfiedSet, type Catalog, type Status } from '../catalog';
import { evaluate, type Req } from '../prereq';
import { findRoute } from '../path';
import { StatusIcon } from './nodes';

interface Props {
  catalog: Catalog;
  code: string;
  targets: string[];
  done: Set<string>;
  onToggle: (code: string) => void;
  onSelect: (code: string) => void;
  onAdd: (code: string) => void;
  onRemove: (code: string) => void;
  onShowOnly: (code: string) => void;
  /** course whose fastest route is highlighted on the map */
  routeFor: string | null;
  onShowRoute: (code: string | null) => void;
}

const STATUS_TEXT: Record<Status, string> = {
  completed: 'Completed',
  equivalent: 'Counts as completed',
  available: 'You can take this',
  locked: 'Prerequisites missing',
  unknown: 'Not in catalog data',
};

export function Inspector({ catalog, code, targets, done, onToggle, onSelect, onAdd, onRemove, onShowOnly, routeFor, onShowRoute }: Props) {
  const onMap = targets.includes(code);
  const course = catalog.courses.get(code);
  const status = courseStatus(catalog, code, done);
  const isDone = done.has(code);

  return (
    <div className="space-y-5 p-5">
      <div>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-mono text-xl font-bold text-indigo-300">{code}</div>
            <h2 className="mt-0.5 text-[15px] font-semibold leading-snug text-slate-100">{course?.title ?? 'Unknown course'}</h2>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
          <span
            className={clsx(
              'flex items-center gap-1 rounded-full px-2 py-0.5 font-medium',
              status === 'completed' && 'bg-emerald-950 text-emerald-300',
              status === 'equivalent' && 'bg-teal-950 text-teal-300',
              status === 'available' && 'bg-sky-950 text-sky-300',
              status === 'locked' && 'bg-slate-800 text-slate-300',
              status === 'unknown' && 'bg-slate-800 text-slate-400',
            )}
          >
            <StatusIcon status={status} className="h-3 w-3" />
            {STATUS_TEXT[status]}
          </span>
          <span className="rounded-full bg-slate-800 px-2 py-0.5 text-slate-300">{CAMPUS_LABEL[course?.campus ?? campusOf(code)]}</span>
          {course?.division && <span className="rounded-full bg-slate-800 px-2 py-0.5 text-slate-400">{course.division}</span>}
        </div>
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => onToggle(code)}
            className={clsx(
              'flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition',
              isDone ? 'bg-emerald-600 text-white hover:bg-emerald-500' : 'bg-slate-800 text-slate-200 hover:bg-slate-700',
            )}
          >
            <Check className="h-3.5 w-3.5" strokeWidth={3} />
            {isDone ? 'Completed' : 'Mark as completed'}
          </button>
          {onMap ? (
            <button
              onClick={() => onRemove(code)}
              className="flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700"
            >
              <Minus className="h-3.5 w-3.5" />
              Remove from map
            </button>
          ) : (
            <button
              onClick={() => onAdd(code)}
              className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-500"
            >
              <Plus className="h-3.5 w-3.5" />
              Add to map
            </button>
          )}
        </div>
        {!(onMap && targets.length === 1) && (
          <button onClick={() => onShowOnly(code)} className="mt-2 flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-300">
            <Crosshair className="h-3 w-3" />
            Show only this course's tree
          </button>
        )}
        {status === 'equivalent' && (
          <p className="mt-3 rounded-lg border border-teal-900 bg-teal-950/40 p-2.5 text-[11px] leading-relaxed text-teal-200/90">
            You completed <span className="font-mono font-semibold">{equivalentSource(catalog, code, done)}</span>, the same course on
            another campus, so this counts for prerequisites. Check with the department if it matters for your program.
          </p>
        )}
        {!course && (
          <p className="mt-3 rounded-lg border border-slate-800 bg-slate-900 p-3 text-xs text-slate-400">
            This course is referenced as a prerequisite but isn't in the scraped catalog (year-long "Y" courses are often missing). You can still mark it completed.
          </p>
        )}
      </div>

      {status === 'locked' && (
        <RouteSection catalog={catalog} code={code} done={done} onSelect={onSelect} active={routeFor === code} onShowRoute={onShowRoute} />
      )}

      {course && (
        <>
          <Section title="Prerequisites">
            {course.req ? (
              <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-2.5">
                <ReqTree req={course.req} done={done} catalog={catalog} onSelect={onSelect} root />
              </div>
            ) : (
              !course.prereq && <p className="text-xs text-slate-500">None</p>
            )}
            {course.reqNotes && (
              <p className="mt-2 flex gap-1.5 text-[11px] text-amber-300/90">
                <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
                Also has requirements that can't be checked automatically — read the calendar text.
              </p>
            )}
            {course.prereq && <RawText text={course.prereq} />}
          </Section>

          {course.coreq && (
            <Section title="Corequisites">
              <RawText text={course.coreq} open />
            </Section>
          )}

          {course.exclusion && (
            <Section title="Exclusions">
              {course.exclusionCodes.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {course.exclusionCodes.map((c) => (
                    <CodeChip key={c} code={c} status={courseStatus(catalog, c, done)} onClick={() => onSelect(c)} />
                  ))}
                </div>
              ) : (
                <RawText text={course.exclusion} open />
              )}
            </Section>
          )}

          <Unlocks catalog={catalog} code={code} done={done} onSelect={onSelect} />

          {course.description && (
            <Section title="Description">
              <p className="text-xs leading-relaxed text-slate-300">{course.description}</p>
            </Section>
          )}

          {course.breadth.length > 0 && (
            <Section title="Breadth / distribution">
              <div className="flex flex-wrap gap-1.5">
                {course.breadth.map((b) => (
                  <span key={b} className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300">
                    {b}
                  </span>
                ))}
              </div>
            </Section>
          )}

          <a
            href={`https://www.google.com/search?q=${encodeURIComponent(`${code} site:utoronto.ca`)}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-300"
          >
            Find in the official calendar <ExternalLink className="h-3 w-3" />
          </a>
        </>
      )}
    </div>
  );
}

function Unlocks({ catalog, code, done, onSelect }: { catalog: Catalog; code: string; done: Set<string>; onSelect: (c: string) => void }) {
  const [allCampuses, setAllCampuses] = useState(false);
  const home = campusOf(code);
  const { list, other } = useMemo(() => {
    const all = catalog.unlocks.get(code) || [];
    const withThis = satisfiedSet(catalog, new Set(done).add(code));
    const rows = all
      .filter((c) => allCampuses || home === 'Other' || campusOf(c) === home)
      .map((c) => {
        const status = courseStatus(catalog, c, done);
        const req = catalog.courses.get(c)?.req ?? null;
        const opensUp = status === 'locked' && evaluate(req, withThis);
        return { c, status, opensUp };
      })
      .sort((a, b) => Number(b.opensUp) - Number(a.opensUp) || a.c.localeCompare(b.c));
    return { list: rows, other: all.length - rows.length };
  }, [catalog, code, done, allCampuses, home]);

  return (
    <Section title={`Leads to (${list.length})`}>
      {list.length === 0 ? (
        <p className="text-xs text-slate-500">No course lists this as a prerequisite{other ? ' on this campus' : ''}.</p>
      ) : (
        <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
          {list.map(({ c, status, opensUp }) => (
            <button
              key={c}
              onClick={() => onSelect(c)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-slate-800"
            >
              <StatusIcon status={status} />
              <span className="font-mono text-xs font-semibold text-slate-200">{c}</span>
              <span className="min-w-0 flex-1 truncate text-[11px] text-slate-400">{catalog.courses.get(c)?.title}</span>
              {opensUp && <span className="shrink-0 rounded bg-sky-950 px-1.5 text-[10px] text-sky-300">opens up</span>}
            </button>
          ))}
        </div>
      )}
      {other > 0 && (
        <button onClick={() => setAllCampuses(true)} className="mt-1.5 text-[11px] text-indigo-300 hover:underline">
          + {other} on other campuses
        </button>
      )}
    </Section>
  );
}

function ReqTree({
  req,
  done,
  catalog,
  onSelect,
  root,
}: {
  req: Req;
  done: Set<string>;
  catalog: Catalog;
  onSelect: (c: string) => void;
  root?: boolean;
}) {
  if (req.kind === 'course') {
    const status = courseStatus(catalog, req.code, done);
    return (
      <button onClick={() => onSelect(req.code)} className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-slate-800">
        <StatusIcon status={isSatisfied(status) || status === 'unknown' ? status : 'locked'} />
        <span
          className={clsx(
            'font-mono text-xs font-semibold',
            status === 'completed' ? 'text-emerald-300' : status === 'equivalent' ? 'text-teal-300' : 'text-slate-200',
          )}
        >
          {req.code}
        </span>
        <span className="min-w-0 flex-1 truncate text-[11px] text-slate-500">{catalog.courses.get(req.code)?.title}</span>
      </button>
    );
  }
  const ok = evaluate(req, satisfiedSet(catalog, done));
  return (
    <div className={clsx(!root && 'ml-1.5 border-l pl-2', !root && (ok ? 'border-emerald-700' : 'border-slate-700'))}>
      <div className={clsx('px-1 pb-0.5 text-[10px] font-bold uppercase tracking-wider', ok ? 'text-emerald-400' : req.kind === 'or' ? 'text-amber-300' : 'text-slate-400')}>
        {req.kind === 'or' ? 'One of' : 'All of'}
        {ok && ' ✓'}
      </div>
      {req.items.map((r, i) => (
        <ReqTree key={i} req={r} done={done} catalog={catalog} onSelect={onSelect} />
      ))}
    </div>
  );
}

/** "Fastest route": the fewest credits still needed to be able to take this course. */
function RouteSection({
  catalog,
  code,
  done,
  onSelect,
  active,
  onShowRoute,
}: {
  catalog: Catalog;
  code: string;
  done: Set<string>;
  onSelect: (c: string) => void;
  active: boolean;
  onShowRoute: (code: string | null) => void;
}) {
  const route = useMemo(() => findRoute(catalog, code, done), [catalog, code, done]);
  if (!route.possible) {
    return (
      <Section title="Fastest route">
        <p className="text-xs text-slate-500">No route found: the prerequisite data for this course loops back on itself.</p>
      </Section>
    );
  }
  const n = route.before.length;
  return (
    <Section title="Fastest route">
      <div className={clsx('rounded-lg border p-3', active ? 'border-amber-500/60 bg-amber-950/20' : 'border-slate-800 bg-slate-950/60')}>
        <p className="text-xs text-slate-300">
          <span className="font-semibold text-slate-100">
            {n} course{n === 1 ? '' : 's'} first
          </span>{' '}
          · {route.credits.toFixed(1)} credits including this one
        </p>
        <ol className="mt-2.5 space-y-2">
          {route.steps.map((step, i) => (
            <li key={i} className="flex gap-2.5">
              <span
                className={clsx(
                  'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold',
                  i === route.steps.length - 1 ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300',
                )}
              >
                {i + 1}
              </span>
              <div className="flex flex-wrap gap-1">
                {step.map((c) => (
                  <button
                    key={c}
                    onClick={() => onSelect(c)}
                    title={catalog.courses.get(c)?.title ?? 'Not in the catalog data'}
                    className={clsx(
                      'rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold hover:bg-slate-700',
                      c === code ? 'bg-indigo-950 text-indigo-200' : 'bg-slate-800 text-slate-200',
                    )}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ol>
        {route.uses.length > 0 && (
          <p className="mt-2.5 text-[11px] text-slate-500">
            Builds on: <span className="font-mono text-emerald-400/90">{route.uses.join(', ')}</span>
          </p>
        )}
        {(route.unchecked.length > 0 || route.unknown.length > 0) && (
          <p className="mt-2 flex gap-1.5 text-[11px] text-amber-300/90">
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
            <span>
              {route.unknown.length > 0 && <>Not in the data (prerequisites unknown): {route.unknown.join(', ')}. </>}
              {route.unchecked.length > 0 && <>Also check the calendar text for {route.unchecked.join(', ')}.</>}
            </span>
          </p>
        )}
        <button
          onClick={() => onShowRoute(active ? null : code)}
          className={clsx(
            'mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition',
            active ? 'bg-slate-800 text-slate-200 hover:bg-slate-700' : 'bg-amber-600 text-white hover:bg-amber-500',
          )}
        >
          {active ? <X className="h-3.5 w-3.5" /> : <RouteIcon className="h-3.5 w-3.5" />}
          {active ? 'Stop highlighting' : 'Highlight on the map'}
        </button>
        <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
          Picks the option with the fewest credits in each “one of”, staying on this campus and faculty when it can. Courses in
          the same step can be taken together; check when they are offered.
        </p>
      </div>
    </Section>
  );
}

function RawText({ text, open }: { text: string; open?: boolean }) {
  return (
    <details open={open} className="mt-2 group">
      {!open && <summary className="cursor-pointer text-[11px] text-slate-500 hover:text-slate-300">Calendar text</summary>}
      <p className="mt-1 rounded-lg border border-slate-800 bg-slate-950/60 p-2.5 text-[11px] leading-relaxed text-slate-400">{text}</p>
    </details>
  );
}

function CodeChip({ code, status, onClick }: { code: string; status: Status; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-1 rounded-md bg-slate-800 px-2 py-1 font-mono text-[11px] text-slate-200 hover:bg-slate-700">
      <StatusIcon status={status} className="h-3 w-3" />
      {code}
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">{title}</h3>
      {children}
    </section>
  );
}
