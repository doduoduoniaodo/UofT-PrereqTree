import { describe, expect, it } from 'vitest';
import { buildGraph, type GraphOptions } from './graph';
import { findRoute } from './path';
import { catalogOf, course } from './testing';

const opts: GraphOptions = {
  depth: 2,
  otherCampuses: false,
  showUnlocks: false,
  unlockOverrides: new Map(),
  expanded: new Set(),
  collapsed: new Set(),
};

describe('route highlighting', () => {
  // TGT400H1 needs one of: XXX100H1 (which itself needs 1.0 more credits) or both AAA100H1 and BBB100H1.
  // The cheapest route is AAA + BBB, reached through a nested "all of" inside a "one of".
  const cat = catalogOf(
    course('TGT400H1', 'XXX100H1/ (AAA100H1, BBB100H1)'),
    course('XXX100H1', 'YYY100H1, ZZZ100H1'),
    course('YYY100H1'),
    course('ZZZ100H1'),
    course('AAA100H1'),
    course('BBB100H1'),
  );
  const route = findRoute(cat, 'TGT400H1', new Set());
  const graph = buildGraph(cat, ['TGT400H1'], new Set(), opts, route);
  const lit = graph.edges.filter((e) => e.animated);
  const kind = (id: string) => graph.nodes.find((n) => n.id === id)?.type;
  const isOn = (id: string) => (graph.nodes.find((n) => n.id === id)?.data as { route?: boolean }).route;

  it('records which course satisfies which', () => {
    expect(route.links.sort()).toEqual([
      ['AAA100H1', 'TGT400H1'],
      ['BBB100H1', 'TGT400H1'],
    ]);
  });

  it('lights the whole path through nested "all of" / "one of" markers', () => {
    // AAA -> [all of] -> [one of] -> TGT, and the same for BBB
    for (const start of ['AAA100H1', 'BBB100H1']) {
      const first = lit.find((e) => e.source === start);
      expect(first, `${start} has a lit arrow`).toBeDefined();
      const second = lit.find((e) => e.source === first!.target);
      expect(kind(first!.target)).toBe('reqgroup');
      expect(kind(second!.target)).toBe('reqgroup');
      expect(lit.find((e) => e.source === second!.target)?.target).toBe('TGT400H1');
    }
    expect(graph.nodes.filter((n) => n.type === 'reqgroup').every((n) => isOn(n.id))).toBe(true);
  });

  it('dims the options the route does not use', () => {
    expect(isOn('XXX100H1')).toBe(false);
    expect(lit.some((e) => e.source === 'XXX100H1')).toBe(false);
  });
});
