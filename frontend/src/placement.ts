import type { XYPosition } from '@xyflow/react';

/**
 * Where the user dragged a node, stored relative to the node it hangs off (its parent),
 * or as an absolute position for nodes without a parent (selected courses).
 * `parent` records which parent the offset was measured against; if the graph is rebuilt
 * and the node now hangs off something else, the offset no longer applies.
 */
export interface Offset {
  parent: string | null;
  v: XYPosition;
  /** pinned at absolute position `v` (a node kept in place although it now hangs off a new node) */
  abs?: boolean;
}

const add = (a: XYPosition, b: XYPosition) => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: XYPosition, b: XYPosition) => ({ x: a.x - b.x, y: a.y - b.y });

/**
 * Final node positions. Every node keeps the automatic layout's offset from its parent unless
 * the user dragged it, so moving a course carries its prerequisites/postrequisites with it, and
 * a subtree that is expanded later appears next to wherever its course was moved.
 */
export function placeNodes(
  layout: Map<string, XYPosition>,
  parents: Map<string, string>,
  offsets: Map<string, Offset>,
): Map<string, XYPosition> {
  const out = new Map<string, XYPosition>();
  const visiting = new Set<string>();

  const place = (id: string): XYPosition => {
    const done = out.get(id);
    if (done) return done;
    const base = layout.get(id)!;
    if (visiting.has(id)) return base; // cycle guard
    visiting.add(id);

    const p = parents.get(id);
    const parent = p !== undefined && layout.has(p) ? p : null;
    const off = offsets.get(id);
    const own = off && off.parent === parent ? off.v : null;

    let pos: XYPosition;
    if (off?.abs) pos = off.v;
    else if (parent === null) pos = own ?? base;
    else pos = add(place(parent), own ?? sub(base, layout.get(parent)!));

    visiting.delete(id);
    out.set(id, pos);
    return pos;
  };

  for (const id of layout.keys()) place(id);
  return out;
}

/** The offset to store when the user drops node `id` at absolute position `pos`. */
export function offsetFor(id: string, pos: XYPosition, parents: Map<string, string>, placed: Map<string, XYPosition>): Offset {
  const p = parents.get(id);
  const parentPos = p !== undefined ? placed.get(p) : undefined;
  if (p === undefined || !parentPos) return { parent: null, v: pos };
  return { parent: p, v: sub(pos, parentPos) };
}

export interface Size {
  width: number;
  height: number;
}

const GAP = 12; // minimum free space kept between nodes when resolving overlaps
const STEP = 12;
const MAX_SHIFT = 4000;

/**
 * Called whenever the graph is rebuilt (a course expanded/collapsed, a course added, ...).
 *
 * - Nodes that were already on screen stay exactly where they were.
 * - Newly shown nodes get their default spot relative to the node they hang off
 *   (e.g. a course's prerequisites appear to its left, as in the automatic layout).
 * - If those new nodes would overlap something, the course they were expanded from
 *   (the "anchor", with everything attached to it) is moved as little as possible.
 *
 * Returns the offsets to use for the new graph.
 */
export function reconcileOffsets(
  prevPlaced: Map<string, XYPosition>,
  layout: Map<string, XYPosition>,
  parents: Map<string, string>,
  sizes: Map<string, Size>,
): Map<string, Offset> {
  const offsets = new Map<string, Offset>();
  const isOld = (id: string) => prevPlaced.has(id);
  const ids = [...layout.keys()];
  if (!ids.some(isOld)) return offsets; // nothing carried over: use the automatic layout

  // 1. Freeze nodes that were already visible.
  for (const id of ids) {
    const pos = prevPlaced.get(id);
    if (!pos) continue;
    const p = parents.get(id);
    if (p === undefined || !layout.has(p)) offsets.set(id, { parent: null, v: pos });
    else {
      const pp = prevPlaced.get(p);
      if (pp) offsets.set(id, { parent: p, v: sub(pos, pp) });
      // now hangs off a new node (e.g. a prerequisite shared with another course): keep it where it is
      else offsets.set(id, { parent: p, v: pos, abs: true });
    }
  }

  // 2. Group new nodes by the old node they grew out of.
  const children = new Map<string, string[]>();
  for (const [c, p] of parents) {
    if (!layout.has(c) || !layout.has(p)) continue;
    const list = children.get(p);
    if (list) list.push(c);
    else children.set(p, [c]);
  }
  const anchorOf = (id: string) => {
    let cur = id;
    const seen = new Set<string>();
    while (!isOld(cur) && !seen.has(cur)) {
      seen.add(cur);
      const p = parents.get(cur);
      if (p === undefined || !layout.has(p)) return cur; // a brand-new root (e.g. a course just added)
      cur = p;
    }
    return cur;
  };
  const anchors: string[] = [];
  for (const id of ids) {
    if (isOld(id)) continue;
    const a = anchorOf(id);
    if (!anchors.includes(a)) anchors.push(a);
  }

  // 3. Move each anchor (with its whole subtree) the least distance that removes overlaps.
  let placed = placeNodes(layout, parents, offsets);
  for (const anchor of anchors) {
    const group = new Set<string>();
    const stack = [anchor];
    while (stack.length) {
      const id = stack.pop()!;
      if (group.has(id)) continue;
      if (id !== anchor && offsets.get(id)?.abs) continue; // pinned: doesn't move with the anchor
      group.add(id);
      for (const c of children.get(id) || []) stack.push(c);
    }
    const others = ids.filter((id) => !group.has(id));
    const members = [...group];
    const free = (dx: number, dy: number) => {
      for (const g of members) {
        const gp = placed.get(g)!;
        const gs = sizes.get(g)!;
        for (const o of others) {
          const op = placed.get(o)!;
          const os = sizes.get(o)!;
          if (
            gp.x + dx < op.x + os.width + GAP &&
            op.x < gp.x + dx + gs.width + GAP &&
            gp.y + dy < op.y + os.height + GAP &&
            op.y < gp.y + dy + gs.height + GAP
          )
            return false;
        }
      }
      return true;
    };
    if (free(0, 0)) continue;

    let shift: XYPosition | null = null;
    for (let d = STEP; d <= MAX_SHIFT && !shift; d += STEP) {
      // vertical moves first: they keep the left-to-right reading order intact
      for (const [dx, dy] of [
        [0, -d],
        [0, d],
        [-d, 0],
        [d, 0],
      ]) {
        if (free(dx, dy)) {
          shift = { x: dx, y: dy };
          break;
        }
      }
    }
    if (!shift) continue;

    const off = offsets.get(anchor);
    const parent = parents.get(anchor);
    if (off) offsets.set(anchor, { parent: off.parent, v: add(off.v, shift) });
    else if (parent !== undefined && layout.has(parent))
      offsets.set(anchor, { parent, v: add(sub(placed.get(anchor)!, placed.get(parent)!), shift) });
    else offsets.set(anchor, { parent: null, v: add(placed.get(anchor)!, shift) });
    placed = placeNodes(layout, parents, offsets);
  }
  return offsets;
}
