import { describe, expect, it } from 'vitest';
import { allNotes, checksFor, collectCodes, evaluate, formatReq, parsePrereq, type Req } from './prereq';

/** Parse and render as "A AND (B OR C)" for compact assertions. */
const fmt = (text: string) => formatReq(parsePrereq(text).req);

describe('parsePrereq — St. George style ("/" = or, "," ";" = and)', () => {
  it('splits ";" groups of "/" alternatives', () => {
    expect(fmt('CSC263H1/ CSC265H1 / CSC263H5/ CSCB63H3')).toBe('CSC263H1 OR CSC265H1 OR CSC263H5 OR CSCB63H3');
  });

  it('handles nested parentheses and commas inside alternatives', () => {
    expect(fmt('RSM219H1, ECO220Y1/ECO227Y1/(STA220H1, STA255H1)/(STA237H1, STA238H1)/(STA257H1, STA261H1)')).toBe(
      'RSM219H1 AND (ECO220Y1 OR ECO227Y1 OR (STA220H1 AND STA255H1) OR (STA237H1 AND STA238H1) OR (STA257H1 AND STA261H1))',
    );
  });

  it('strips "60% or higher in" without treating its "or" as an alternative', () => {
    const text =
      '(60% or higher in CSC148H1/ 60% or higher in CSC148H5/ 60% or higher in CSCA48H3; 60% or higher in CSC165H1/ 60% or higher in MAT102H5/ 60% or higher in CSCA67H3/ 60% or higher in MATA67H3)/ 60% or higher in CSC111H1.';
    expect(fmt(text)).toBe('((CSC148H1 OR CSC148H5 OR CSCA48H3) AND (CSC165H1 OR MAT102H5 OR CSCA67H3 OR MATA67H3)) OR CSC111H1');
  });

  it('strips "(80%)" grade qualifiers after a code', () => {
    expect(fmt('MAT221H1(80%)/MAT223H1/MAT223H5/ MATA22H3/ MATA23H3/ MAT240H1/MAT240H5')).toBe(
      'MAT221H1 OR MAT223H1 OR MAT223H5 OR MATA22H3 OR MATA23H3 OR MAT240H1 OR MAT240H5',
    );
  });

  it('treats "Prerequisite for <students>:" sections as alternatives', () => {
    const text =
      'CSC236H1/ CSC240H1/ CSC236H5/ CSCB36H3; STA237H1/ STA247H1/ STA255H1/ STA257H1/ STAB57H3/ STAB52H3 Prerequisite for Faculty of Applied Science and Engineering students: APS105H1/ APS106H1/ ESC180H1; ECE302H1/ STA286H1/ CHE223H1/ CME263H1/ MIE231H1/ MIE236H1/ MSE238H1/ ECE286H1';
    expect(fmt(text)).toBe(
      '((CSC236H1 OR CSC240H1 OR CSC236H5 OR CSCB36H3) AND (STA237H1 OR STA247H1 OR STA255H1 OR STA257H1 OR STAB57H3 OR STAB52H3)) OR ' +
        '((APS105H1 OR APS106H1 OR ESC180H1) AND (ECE302H1 OR STA286H1 OR CHE223H1 OR CME263H1 OR MIE231H1 OR MIE236H1 OR MSE238H1 OR ECE286H1))',
    );
  });
});

describe('parsePrereq — UTM / UTSC style ("and" / "or" words, [] groups)', () => {
  it('reads "and" / "or" with parentheses', () => {
    expect(
      fmt('CSC207H5 and (MAT223H5 or MAT240H5) and MAT232H5 and (STA246H5 or STA256H5 or STA237H1 or STA238H1 or ECO227Y5 or ECE286H1 or MIE286H1)'),
    ).toBe('CSC207H5 AND (MAT223H5 OR MAT240H5) AND MAT232H5 AND (STA246H5 OR STA256H5 OR STA237H1 OR STA238H1 OR ECO227Y5 OR ECE286H1 OR MIE286H1)');
  });

  it('reads "A, B, or C" lists as alternatives', () => {
    const text =
      '[Completion of 1.0 credit from the following courses: [SOCA05H3 or [(SOCA01H3) and (SOCA02H3)] or (SOCA03Y3)], ANTA02H3, GGRA02H3, GASA01H3/HISA06H3, GASA02H3, HISA04H3, or HISA05H3] or [any 4.0 credits and enrolment in the Minor in Critical Migration Studies]';
    expect(fmt(text)).toBe(
      'SOCA05H3 OR (SOCA01H3 AND SOCA02H3) OR SOCA03Y3 OR ANTA02H3 OR GGRA02H3 OR GASA01H3 OR HISA06H3 OR GASA02H3 OR HISA04H3 OR HISA05H3',
    );
  });
});

describe('parsePrereq — free-text requirements', () => {
  it('drops text it cannot check and flags it', () => {
    const r = parsePrereq('ECE244H1 or equivalent with the permission of the Chair of the AI certificate/minor.');
    expect(formatReq(r.req)).toBe('ECE244H1');
    expect(r.hasNotes).toBe(true);
  });

  it('keeps courses and flags the rest when mixed with sentences', () => {
    const r = parsePrereq(
      '(BIO120H1, BIO130H1), CHM136H1/CHM151Y1. Students who do not have all of the required prerequisites are encouraged to contact the course coordinator to seek a waiver.',
    );
    expect(formatReq(r.req)).toBe('BIO120H1 AND BIO130H1 AND (CHM136H1 OR CHM151Y1)');
    expect(r.hasNotes).toBe(true);
  });

  it('returns no tree for credit-count requirements', () => {
    const r = parsePrereq('1.0 credit in POL/ JPA/ JPF/ JPI/ JPR/ JPS/ JRA courses');
    expect(r.req).toBeNull();
    expect(r.hasNotes).toBe(true);
  });

  it('does not treat "[excluding X]" as a requirement', () => {
    const r = parsePrereq('10.0 credits, including 2.0 credits in MAT courses [excluding MATA02H3], of which 0.5 credit must be at the B-level');
    expect(r.req).toBeNull();
  });

  it('handles empty text', () => {
    expect(parsePrereq('')).toEqual({ req: null, hasNotes: false, conditions: [] });
  });

  it('resolves codes without a campus digit', () => {
    expect(formatReq(parsePrereq('CSC263H or CSC265H', (c) => (/\d$/.test(c) ? c : `${c}1`)).req)).toBe('CSC263H1 OR CSC265H1');
  });
});

describe('evaluate / collectCodes', () => {
  const csc236 = parsePrereq(
    '(CSC148H1/ CSC148H5/ CSCA48H3; CSC165H1/ MAT102H5/ CSCA67H3/ MATA67H3)/ CSC111H1',
  ).req;

  it('needs every part of an "and"', () => {
    expect(evaluate(csc236, new Set(['CSC148H1']))).toBe(false);
    expect(evaluate(csc236, new Set(['CSC148H1', 'CSC165H1']))).toBe(true);
  });

  it('needs only one option of an "or"', () => {
    expect(evaluate(csc236, new Set(['CSC111H1']))).toBe(true);
  });

  it('treats "no prerequisites" as satisfied', () => {
    expect(evaluate(null, new Set())).toBe(true);
  });

  it('lists every code in a tree', () => {
    expect([...collectCodes(csc236)].sort()).toEqual(
      ['CSC111H1', 'CSC148H1', 'CSC148H5', 'CSC165H1', 'CSCA48H3', 'CSCA67H3', 'MAT102H5', 'MATA67H3'].sort(),
    );
  });
});

describe('grade minimums', () => {
  const grades = (text: string) => {
    const out: Record<string, string> = {};
    const walk = (r: Req | null) => {
      if (!r) return;
      if (r.kind === 'course') {
        if (r.grade) out[r.code] = r.grade;
      } else r.items.forEach(walk);
    };
    walk(parsePrereq(text).req);
    return out;
  };

  it('reads "60% or higher in X"', () => {
    expect(grades('60% or higher in CSC148H1/ 60% or higher in CSC111H1')).toEqual({ CSC148H1: '60%', CSC111H1: '60%' });
  });

  it('reads "a minimum grade of 60% in X" and "Minimum 70% in X"', () => {
    expect(grades('CHM110H5 and a minimum grade of 60% in CHM120H5')).toEqual({ CHM120H5: '60%' });
    expect(grades('Minimum 70% in ARC100H1')).toEqual({ ARC100H1: '70%' });
  });

  it('reads "X (70% or higher)", "X(70%)" and "X (minimum of 60%)"', () => {
    expect(grades('CSC110Y1 (70% or higher)')).toEqual({ CSC110Y1: '70%' });
    expect(grades('MAT133Y1(70%)/ MAT137Y1')).toEqual({ MAT133Y1: '70%' });
    expect(grades('EAS151H1 (minimum of 60%) or equivalent')).toEqual({ EAS151H1: '60%' });
  });

  it('reads "X with a final grade of 80%"', () => {
    expect(grades('ARC401H1 with a final grade of 80% and permission of the Program Director')).toEqual({ ARC401H1: '80%' });
  });

  it('applies a grade before brackets to every course inside', () => {
    expect(grades('60% or higher in (CSC148H1/ CSC148H5), CSC165H1')).toEqual({ CSC148H1: '60%', CSC148H5: '60%' });
    expect(parsePrereq('60% or higher in (CSC148H1/ CSC148H5)').hasNotes).toBe(false);
  });

  it('reads letter grades', () => {
    expect(grades('a minimum grade of B- in CSC148H1')).toEqual({ CSC148H1: 'B-' });
  });
});

describe('conditions that cannot be checked', () => {
  const notes = (text: string) => parsePrereq(text).req?.notes;

  it('keeps an extra requirement next to the courses it goes with', () => {
    const r = parsePrereq('ARC401H1 with a final grade of 80% and permission of the Program Director').req!;
    expect(r).toMatchObject({ kind: 'course', code: 'ARC401H1', grade: '80%' });
    expect(r.notes).toEqual([{ text: 'Permission of the Program Director', mode: 'also' }]);
  });

  it('keeps an alternative way in as an "or" condition', () => {
    expect(notes('PRT100Y1/ PRT102H1 or placement test')).toEqual([{ text: 'Placement test', mode: 'or' }]);
  });

  it('keeps a run of conditions as one sentence', () => {
    expect(notes('CSCB36H3 and [CGPA of at least 3.5, or enrolment in a CSC Subject POSt]')).toEqual([
      { text: 'CGPA of at least 3.5, or enrolment in a CSC Subject POSt', mode: 'also' },
    ]);
  });

  it('does not split a condition at "and"', () => {
    const r = parsePrereq('[Enrolment in the Major program in Media and Communication Studies and MDSA11H3 and MDSA13H3]').req!;
    expect(r.notes).toEqual([{ text: 'Enrolment in the Major program in Media and Communication Studies', mode: 'also' }]);
  });

  it('shows a condition needed with every course once, on the group', () => {
    const r = parsePrereq('8.0 credits including VPAB13H3 and VPAB16H3').req!;
    expect(formatReq(r)).toBe('VPAB13H3 AND VPAB16H3');
    expect(r.notes).toEqual([{ text: '8.0 credits', mode: 'also' }]);
  });

  it('reports standalone conditions when no courses are named', () => {
    expect(parsePrereq('1.0 credit in POL/ JPA/ JPF courses').conditions).toEqual(['1.0 credit in POL/ JPA/ JPF courses']);
  });

  it('reads "X (or Y and Z)" as an alternative', () => {
    expect(fmt('AST320H1 (or AST221H1 and AST222H1)')).toBe('AST320H1 OR (AST221H1 AND AST222H1)');
  });

  it('lists every condition in a tree', () => {
    expect(allNotes(parsePrereq('CSCB36H3 and [CGPA of at least 3.5]; CSCA67H3 or placement test').req)).toEqual([
      'CGPA of at least 3.5',
      'Placement test',
    ]);
  });

  it('keeps neighbouring alternatives together without stray brackets', () => {
    expect(notes('CSCB36H3 and [CGPA of at least 3.5] or placement test')).toEqual([
      { text: 'CGPA of at least 3.5 or placement test', mode: 'also' },
    ]);
  });
});

describe('checksFor (what to double-check before enrolling)', () => {
  const req = parsePrereq(
    '(60% or higher in CSC148H1, 60% or higher in CSC165H1)/ 60% or higher in CSC111H1; enrolment in a CSC program or permission of the instructor',
  ).req;

  it('lists grade minimums on the branch you actually satisfy', () => {
    expect(checksFor(req, new Set(['CSC111H1']))).toContain('≥60% in CSC111H1');
    expect(checksFor(req, new Set(['CSC111H1']))).not.toContain('≥60% in CSC148H1');
    expect(checksFor(req, new Set(['CSC148H1', 'CSC165H1']))).toEqual(
      expect.arrayContaining(['≥60% in CSC148H1', '≥60% in CSC165H1']),
    );
  });

  it('lists conditions needed in addition, but not alternatives', () => {
    const checks = checksFor(
      parsePrereq('CSCB36H3 and [enrolment in a CSC Subject POSt]; CSCA67H3 or placement test').req,
      new Set(['CSCB36H3', 'CSCA67H3']),
    );
    expect(checks).toContain('Enrolment in a CSC Subject POSt');
    expect(checks).not.toContain('Placement test');
  });
});
