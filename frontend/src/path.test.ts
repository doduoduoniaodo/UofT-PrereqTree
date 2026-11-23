import { describe, expect, it } from 'vitest';
import { findRoute } from './path';
import { catalogOf, course } from './testing';

describe('findRoute', () => {
  it('picks the "one of" option needing the fewest credits', () => {
    const cat = catalogOf(
      course('TGT400H1', 'OPA300H1/ (OPB300H1, OPC300H1)'),
      course('OPA300H1', 'XXA200H1, XXB200H1'), // 1.5 credits in total
      course('XXA200H1'),
      course('XXB200H1'),
      course('OPB300H1'), // 1.0 credits in total
      course('OPC300H1'),
    );
    const r = findRoute(cat, 'TGT400H1', new Set());
    expect(r.before).toEqual(['OPB300H1', 'OPC300H1']);
    expect(r.credits).toBe(1.5);
  });

  it('stays on the target course campus when it can', () => {
    const cat = catalogOf(course('TGT400H1', 'ALT100H5/ ALT100H1'), course('ALT100H5'), course('ALT100H1'));
    expect(findRoute(cat, 'TGT400H1', new Set()).before).toEqual(['ALT100H1']);
  });

  it('stays in the target course faculty when it can', () => {
    const cat = catalogOf(
      course('TGT400H1', 'ENG100H1/ (ART100H1, ART200H1)'),
      course('ENG100H1', '', '', { division: 'Applied Science & Engineering' }),
      course('ART100H1'),
      course('ART200H1'),
    );
    expect(findRoute(cat, 'TGT400H1', new Set()).before).toEqual(['ART100H1', 'ART200H1']);
  });

  it('avoids courses missing from the data (often retired) when there is another option', () => {
    const cat = catalogOf(course('TGT400H1', 'OLD999H1/ (NEW100H1, NEW200H1)'), course('NEW100H1'), course('NEW200H1'));
    const r = findRoute(cat, 'TGT400H1', new Set());
    expect(r.before).toEqual(['NEW100H1', 'NEW200H1']);
    expect(r.unknown).toEqual([]);
  });

  it('orders courses into steps that only depend on earlier steps', () => {
    const cat = catalogOf(course('TGT400H1', 'MID300H1, KKK100H1'), course('MID300H1', 'LOW100H1'), course('LOW100H1'), course('KKK100H1'));
    expect(findRoute(cat, 'TGT400H1', new Set()).steps).toEqual([['KKK100H1', 'LOW100H1'], ['MID300H1'], ['TGT400H1']]);
  });

  it('skips completed courses and reports what the route builds on', () => {
    const cat = catalogOf(course('TGT400H1', 'MID300H1, KKK100H1'), course('MID300H1', 'LOW100H1'), course('LOW100H1'), course('KKK100H1'));
    const r = findRoute(cat, 'TGT400H1', new Set(['LOW100H1']));
    expect(r.steps).toEqual([['KKK100H1', 'MID300H1'], ['TGT400H1']]);
    expect(r.uses).toEqual(['LOW100H1']);
    expect(r.all).toEqual(new Set(['KKK100H1', 'MID300H1', 'LOW100H1', 'TGT400H1']));
  });

  it('counts equivalent courses as done', () => {
    const cat = catalogOf(course('TGT400H1', 'CSC148H1'), course('CSC148H1', 'CSC108H1', 'CSC148H5'), course('CSC148H5', '', 'CSC148H1'), course('CSC108H1'));
    const r = findRoute(cat, 'TGT400H1', new Set(['CSC148H5']));
    expect(r.steps).toEqual([['TGT400H1']]);
    expect(r.uses).toEqual(['CSC148H1']);
  });

  it('flags courses with requirements it cannot check', () => {
    const cat = catalogOf(course('TGT400H1', 'MID300H1 and permission of the instructor'), course('MID300H1'));
    expect(findRoute(cat, 'TGT400H1', new Set()).unchecked).toEqual(['TGT400H1']);
  });

  it('reports circular prerequisites as impossible', () => {
    const cat = catalogOf(course('LOP100H1', 'LOP200H1'), course('LOP200H1', 'LOP100H1'));
    expect(findRoute(cat, 'LOP100H1', new Set()).possible).toBe(false);
  });

  it('counts full-year courses as 1.0 credit', () => {
    const cat = catalogOf(course('TGT400H1', 'FUL100Y1'), course('FUL100Y1'));
    expect(findRoute(cat, 'TGT400H1', new Set()).credits).toBe(1.5);
  });
});
