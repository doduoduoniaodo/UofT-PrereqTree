// Slims backend/data/courses.json into public/courses.json for the frontend.
// Run: npm run data
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, '../../backend/data/courses.json');
const out = resolve(here, '../public/courses.json');

const CAMPUS = {
  'St. George': 'UTSG',
  'University of Toronto at Mississauga': 'UTM',
  Scarborough: 'UTSC',
};
const decode = (s) =>
  (s || '')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const division = (d) => decode(d).replace(/,\s*(Faculty of|John H\. Daniels Faculty of)$/i, '').replace(/^University of Toronto /, 'UofT ');

const raw = JSON.parse(readFileSync(src, 'utf8'));
const courses = Object.values(raw)
  .map((c) => ({
    code: c.code,
    title: decode(c.title || c.name),
    campus: CAMPUS[c.campus] || 'Other',
    division: division(c.division),
    description: decode(c.description),
    prereq: decode(c.prereqText),
    coreq: decode(c.coreqText),
    exclusion: decode(c.exclusionText),
    breadth: [...(c.breadthRequirements || []), ...(c.distributionRequirements || [])].map(decode),
  }))
  .sort((a, b) => a.code.localeCompare(b.code));

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(courses));
console.log(`wrote ${courses.length} courses to ${out}`);
