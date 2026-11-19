import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { Check, Lock, Plus, HelpCircle, Circle } from 'lucide-react';
import clsx from 'clsx';
import type { CourseNodeData, GroupNodeData } from '../graph';
import { useGraphActions } from './graphActions';

const handle = '!w-1.5 !h-1.5 !min-w-0 !min-h-0 !border-0 !bg-slate-500';

export function CourseNode({ data, selected }: NodeProps<Node<CourseNodeData>>) {
  const { onExpand } = useGraphActions();
  const { status, focus } = data;
  return (
    <div
      className={clsx(
        'group relative w-[210px] h-[62px] rounded-lg border px-3 py-2 text-left transition-shadow cursor-pointer',
        status === 'completed' && 'bg-emerald-950/70 border-emerald-500/70',
        status === 'available' && 'bg-sky-950/70 border-sky-500/70',
        status === 'locked' && 'bg-slate-900 border-slate-700',
        status === 'unknown' && 'bg-slate-900/60 border-slate-600 border-dashed',
        focus && 'ring-2 ring-indigo-400 ring-offset-2 ring-offset-slate-950',
        selected && !focus && 'ring-2 ring-slate-300/70',
        data.role === 'unlock' && status === 'locked' && 'opacity-80',
      )}
    >
      <Handle type="target" position={Position.Left} className={handle} />
      <div className="flex items-center gap-1.5">
        <StatusIcon status={status} />
        <span className="font-mono text-[13px] font-semibold tracking-tight text-slate-100">{data.code}</span>
      </div>
      <div className="mt-0.5 text-[11px] leading-tight text-slate-400 line-clamp-2">{data.title}</div>
      {data.truncated && (
        <button
          title="Show this course's prerequisites"
          onClick={(e) => {
            e.stopPropagation();
            onExpand(data.code);
          }}
          className="absolute -left-3 top-1/2 -translate-y-1/2 rounded-full border border-slate-600 bg-slate-800 p-0.5 text-slate-300 hover:bg-indigo-600 hover:text-white hover:border-indigo-400"
        >
          <Plus className="h-3 w-3" />
        </button>
      )}
      <Handle type="source" position={Position.Right} className={handle} />
    </div>
  );
}

export function StatusIcon({ status, className }: { status: CourseNodeData['status']; className?: string }) {
  const cls = clsx('h-3.5 w-3.5 shrink-0', className);
  if (status === 'completed') return <Check className={clsx(cls, 'text-emerald-400')} strokeWidth={3} />;
  if (status === 'available') return <Circle className={clsx(cls, 'text-sky-400')} strokeWidth={3} />;
  if (status === 'locked') return <Lock className={clsx(cls, 'text-slate-500')} />;
  return <HelpCircle className={clsx(cls, 'text-slate-500')} />;
}

export function GroupNode({ data }: NodeProps<Node<GroupNodeData>>) {
  return (
    <div
      className={clsx(
        'flex h-[24px] w-[64px] items-center justify-center rounded-full border text-[9px] font-bold uppercase tracking-wider',
        data.satisfied
          ? 'border-emerald-500/70 bg-emerald-950 text-emerald-300'
          : data.op === 'or'
            ? 'border-amber-500/60 bg-amber-950/60 text-amber-300'
            : 'border-slate-500 bg-slate-800 text-slate-300',
      )}
      title={data.op === 'or' ? 'Any one of these' : 'All of these'}
    >
      <Handle type="target" position={Position.Left} className={handle} />
      {data.op === 'or' ? 'one of' : 'all of'}
      <Handle type="source" position={Position.Right} className={handle} />
    </div>
  );
}

export const nodeTypes = { course: CourseNode, reqgroup: GroupNode };
