import { buildCatalog, campusOf, type RawCourse } from './catalog';

/** A minimal course for test catalogs; campus comes from the code's last digit. */
export function course(code: string, prereq = '', exclusion = '', extra: Partial<RawCourse> = {}): RawCourse {
  return {
    code,
    title: code,
    campus: campusOf(code),
    division: 'Arts and Science',
    description: '',
    prereq,
    coreq: '',
    exclusion,
    breadth: [],
    ...extra,
  };
}

export const catalogOf = (...courses: RawCourse[]) => buildCatalog(courses);
