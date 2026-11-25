import { describe, expect, it } from 'vitest';
import { suggestNext } from './suggest';
import { catalogOf, course } from './testing';

// A small CS-like catalog:
//   INT100H1 (intro) -> DSA200H1 -> ALG300H1 (target)
//   INT100H1 -> WEB200H1 -> {WEB300H1, WEB310H1, WEB320H1}   (opens a lot)
//   INT100H1 -> ART200H1                                     (different subject, opens nothing)
//   INT100H1 -> OLD200H1 (excludes INT100H1: can't take both)
//   UTM100H5 builds on INT100H1 on another campus
const cat = catalogOf(
  course('INT100H1'),
  course('DSA200H1', 'INT100H1'),
  course('ALG300H1', 'DSA200H1'),
  course('WEB200H1', '60% or higher in INT100H1'),
  course('WEB300H1', 'WEB200H1'),
  course('WEB310H1', 'WEB200H1'),
  course('WEB320H1', 'WEB200H1'),
  course('ART200H1', 'INT100H1'),
  course('OLD200H1', 'INT100H1', 'INT100H1'),
  course('UTM100H5', 'INT100H1'),
  // the same intro course at UTM, and a UTM course building on it
  course('INT100H5', '', 'INT100H1'),
  course('UTM200H5', 'INT100H5'),
);

describe('suggestNext', () => {
  it('puts the next step toward a selected course first', () => {
    const s = suggestNext(cat, new Set(['INT100H1']), ['ALG300H1']);
    expect(s[0].code).toBe('DSA200H1');
    expect(s[0].toward).toEqual(['ALG300H1']);
  });

  it('then ranks by how many courses a course opens up', () => {
    const s = suggestNext(cat, new Set(['INT100H1']), []);
    expect(s[0].code).toBe('WEB200H1');
    expect(s[0].opens.sort()).toEqual(['WEB300H1', 'WEB310H1', 'WEB320H1']);
  });

  it('suggests a selected course itself when you can already take it', () => {
    const s = suggestNext(cat, new Set(['INT100H1', 'DSA200H1']), ['ALG300H1']);
    expect(s[0]).toMatchObject({ code: 'ALG300H1', toward: ['ALG300H1'] });
  });

  it('only suggests courses you can take now', () => {
    const codes = suggestNext(cat, new Set(['INT100H1']), ['ALG300H1']).map((s) => s.code);
    expect(codes).not.toContain('ALG300H1');
    expect(codes).not.toContain('WEB300H1');
    expect(codes).not.toContain('INT100H1');
  });

  it('leaves out courses that exclude something you completed', () => {
    expect(suggestNext(cat, new Set(['INT100H1']), []).map((s) => s.code)).not.toContain('OLD200H1');
  });

  it('stays on your campus when all your courses are on one', () => {
    const codes = suggestNext(cat, new Set(['INT100H1']), []).map((s) => s.code);
    expect(codes).not.toContain('UTM100H5');
    expect(codes).not.toContain('UTM200H5'); // reachable only through the UTM equivalent of INT100H1
  });

  it('suggests other campuses when your courses span several and no filter is set', () => {
    const codes = (campus: 'ALL' | 'UTSG') => suggestNext(cat, new Set(['INT100H1', 'INT100H5']), [], { campus }).map((s) => s.code);
    expect(codes('ALL')).toContain('UTM100H5');
    expect(codes('UTSG')).not.toContain('UTM100H5');
  });

  it('names the course you actually completed, not its equivalent', () => {
    const s = suggestNext(cat, new Set(['INT100H5']), [], { campus: 'UTSG' }).find((x) => x.code === 'DSA200H1')!;
    expect(s.buildsOn).toEqual(['INT100H5']);
  });

  it('reports what each suggestion builds on and what to check', () => {
    const web = suggestNext(cat, new Set(['INT100H1']), []).find((s) => s.code === 'WEB200H1')!;
    expect(web.buildsOn).toEqual(['INT100H1']);
    expect(web.checks).toEqual(['≥60% in INT100H1']);
  });

  it('has nothing to suggest without completed or selected courses', () => {
    expect(suggestNext(cat, new Set(), [])).toEqual([]);
  });
});
