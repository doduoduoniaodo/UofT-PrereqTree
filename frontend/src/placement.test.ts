import { describe, expect, it } from 'vitest';
import { offsetFor, placeNodes, reconcileOffsets, type Offset, type Size } from './placement';

const S: Size = { width: 210, height: 62 };
const sizes = (...ids: string[]) => new Map(ids.map((id) => [id, S]));
const obj = (m: Map<string, unknown>) => Object.fromEntries(m);

describe('placeNodes / offsetFor', () => {
  const layout = new Map([
    ['T', { x: 500, y: 100 }],
    ['A', { x: 250, y: 50 }],
    ['A1', { x: 0, y: 50 }],
    ['U', { x: 750, y: 100 }],
  ]);
  const parents = new Map([
    ['A', 'T'],
    ['A1', 'A'],
    ['U', 'T'],
  ]);

  it('uses the automatic layout when nothing was moved', () => {
    expect(obj(placeNodes(layout, parents, new Map()))).toEqual(obj(layout));
  });

  it('moves a whole subtree with the course it hangs off', () => {
    const placed = placeNodes(layout, parents, new Map());
    const offsets = new Map<string, Offset>([['T', offsetFor('T', { x: 100, y: 600 }, parents, placed)]]);
    expect(obj(placeNodes(layout, parents, offsets))).toEqual({
      T: { x: 100, y: 600 },
      A: { x: -150, y: 550 },
      A1: { x: -400, y: 550 },
      U: { x: 350, y: 600 },
    });
  });

  it('keeps a hand-placed child where it is relative to its parent', () => {
    let placed = placeNodes(layout, parents, new Map());
    const offsets = new Map<string, Offset>([['A', offsetFor('A', { x: 250, y: 0 }, parents, placed)]]); // A dragged up 50
    placed = placeNodes(layout, parents, offsets);
    offsets.set('T', offsetFor('T', { x: 0, y: 0 }, parents, placed)); // then T moved
    const final = placeNodes(layout, parents, offsets);
    expect(final.get('A')).toEqual({ x: -250, y: -100 }); // still 50 above its default spot next to T
    expect(final.get('A1')).toEqual({ x: -500, y: -100 });
  });
});

describe('reconcileOffsets (keeping the layout stable when the graph changes)', () => {
  // after expanding T: dagre puts A/B left of T; U is T's postrequisite; O is unrelated
  const layout = new Map([
    ['T', { x: 300, y: 100 }],
    ['A', { x: 30, y: 60 }],
    ['B', { x: 30, y: 140 }],
    ['U', { x: 570, y: 100 }],
    ['O', { x: 30, y: 400 }],
  ]);
  const parents = new Map([
    ['A', 'T'],
    ['B', 'T'],
    ['U', 'T'],
  ]);
  const sz = sizes('T', 'A', 'B', 'U', 'O');

  it('keeps existing nodes in place and puts new ones next to their course', () => {
    const prev = new Map([
      ['T', { x: 600, y: 300 }],
      ['U', { x: 870, y: 300 }],
      ['O', { x: 0, y: 900 }],
    ]);
    const placed = placeNodes(layout, parents, reconcileOffsets(prev, layout, parents, sz));
    expect(placed.get('T')).toEqual({ x: 600, y: 300 });
    expect(placed.get('U')).toEqual({ x: 870, y: 300 });
    expect(placed.get('O')).toEqual({ x: 0, y: 900 });
    expect(placed.get('A')).toEqual({ x: 330, y: 260 }); // same offset from T as in the automatic layout
    expect(placed.get('B')).toEqual({ x: 330, y: 340 });
  });

  it('moves the expanded course as little as possible when new nodes would overlap', () => {
    const prev = new Map([
      ['T', { x: 600, y: 300 }],
      ['U', { x: 870, y: 300 }],
      ['O', { x: 340, y: 300 }], // sits exactly where A/B want to go
    ]);
    const placed = placeNodes(layout, parents, reconcileOffsets(prev, layout, parents, sz));
    expect(placed.get('O')).toEqual({ x: 340, y: 300 }); // unrelated node never moves
    expect(placed.get('T')).toEqual({ x: 600, y: 180 }); // nudged straight up just enough
    expect(placed.get('U')!.y - placed.get('T')!.y).toBe(0); // its postrequisite moved with it
    const b = placed.get('B')!;
    expect(b.y + S.height).toBeLessThanOrEqual(300 - 12); // clear of O, keeping the gap
  });

  it('keeps an existing node in place when it now hangs off a new node', () => {
    // P was already visible (shared with another course); after expanding T it hangs off new group G
    const layout2 = new Map([
      ['T', { x: 300, y: 100 }],
      ['G', { x: 200, y: 100 }],
      ['P', { x: 0, y: 100 }],
    ]);
    const parents2 = new Map([
      ['G', 'T'],
      ['P', 'G'],
    ]);
    const prev = new Map([
      ['T', { x: 600, y: 300 }],
      ['P', { x: 5, y: 5 }],
    ]);
    const placed = placeNodes(layout2, parents2, reconcileOffsets(prev, layout2, parents2, sizes('T', 'G', 'P')));
    expect(placed.get('P')).toEqual({ x: 5, y: 5 });
    expect(placed.get('T')).toEqual({ x: 600, y: 300 });
  });

  it('starts from the automatic layout when nothing carries over', () => {
    expect(reconcileOffsets(new Map([['X', { x: 1, y: 1 }]]), layout, parents, sz).size).toBe(0);
  });
});
