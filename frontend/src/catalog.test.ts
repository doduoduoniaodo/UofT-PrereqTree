import { describe, expect, it } from 'vitest';
import { courseStatus, equivalentSource, satisfiedSet } from './catalog';
import { formatReq } from './prereq';
import { catalogOf, course } from './testing';

describe('equivalent courses', () => {
  const cat = catalogOf(
    // same course on three campuses (exclusion links + same subject, level and number)
    course('CSC148H1', '', 'CSC111H1, CSC148H5, CSCA48H3'),
    course('CSC148H5', '', 'CSC148H1'),
    course('CSCA48H3', '', 'CSC148H1'),
    // same campus, different number, mutual exclusion: overlapping courses, NOT equivalent
    course('CSC111H1', '', 'CSC148H1'),
    // different campuses, different numbers, mutual exclusion: equivalent
    course('CSC312H5', '', 'CSCC11H3'),
    course('CSCC11H3', '', 'CSC312H5'),
    // different numbers, only a one-way exclusion: not equivalent
    course('CSC320H1', '', 'CSCC11H3'),
    // a prerequisite of the other: never equivalent
    course('STA301H1', 'STAC01H3', 'STAC01H3'),
    course('STAC01H3', '', 'STA301H1'),
    // H vs Y: different length, not equivalent
    course('MAT137H5', '', 'MAT137Y5'),
    course('MAT137Y5', '', 'MAT137H5'),
    course('CSC207H1', 'CSC148H1/ CSC111H1'),
  );
  const eq = (code: string) => [...(cat.equivalents.get(code) ?? [])].sort();

  it('links the same course across campuses', () => {
    expect(eq('CSC148H1')).toEqual(['CSC148H5', 'CSCA48H3']);
    expect(eq('CSCA48H3')).toEqual(['CSC148H1']);
  });

  it('does not link different courses on the same campus', () => {
    expect(eq('CSC111H1')).toEqual([]);
  });

  it('links renumbered cross-campus courses only when both exclude each other', () => {
    expect(eq('CSC312H5')).toEqual(['CSCC11H3']);
    expect(eq('CSC320H1')).toEqual([]);
  });

  it('never links a course to its own prerequisite', () => {
    expect(eq('STA301H1')).toEqual([]);
  });

  it('never links half-year and full-year courses', () => {
    expect(eq('MAT137H5')).toEqual([]);
  });

  it('counts an equivalent as satisfied, with its own status', () => {
    const done = new Set(['CSC148H5']);
    expect(satisfiedSet(cat, done).has('CSC148H1')).toBe(true);
    expect(courseStatus(cat, 'CSC148H5', done)).toBe('completed');
    expect(courseStatus(cat, 'CSC148H1', done)).toBe('equivalent');
    expect(equivalentSource(cat, 'CSC148H1', done)).toBe('CSC148H5');
    expect(courseStatus(cat, 'CSC207H1', done)).toBe('available');
  });

  it('returns the same satisfied set for the same completed set (cached)', () => {
    const done = new Set(['CSC148H5']);
    expect(satisfiedSet(cat, done)).toBe(satisfiedSet(cat, done));
  });
});

describe('buildCatalog', () => {
  const cat = catalogOf(course('CSC263H1'), course('CSC373H1', 'CSC263H or CSC265H'), course('CSC999H1', 'MAT137Y1'));

  it('resolves codes without a campus digit to a course that exists', () => {
    expect(formatReq(cat.courses.get('CSC373H1')!.req)).toBe('CSC263H1 OR CSC265H');
  });

  it('indexes which courses each course leads to', () => {
    expect(cat.unlocks.get('CSC263H1')).toEqual(['CSC373H1']);
    expect(cat.unlocks.get('MAT137Y1')).toEqual(['CSC999H1']);
  });

  it('reports unknown and locked courses', () => {
    expect(courseStatus(cat, 'MAT137Y1', new Set())).toBe('unknown');
    expect(courseStatus(cat, 'CSC999H1', new Set())).toBe('locked');
    expect(courseStatus(cat, 'CSC999H1', new Set(['MAT137Y1']))).toBe('available');
  });
});
