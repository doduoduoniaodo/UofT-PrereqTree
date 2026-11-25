// Slims backend/data/courses.json into public/courses.json for the frontend, adding each course's
// "Recommended Preparation" from backend/data/recommended.json (see backend/scripts/fetch-recommended.mjs).
// Run: npm run data
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, '../../backend/data/courses.json');
const recSrc = resolve(here, '../../backend/data/recommended.json');
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
// "( MAT235H1 , MAT236H1 )/ MAT235Y1" -> "(MAT235H1, MAT236H1)/ MAT235Y1" (spaces left by stripped links)
const tidy = (s) => decode(s).replace(/([([])\s+/g, '$1').replace(/\s+([,;:.)\]])/g, '$1').replace(/\s+\//g, '/');
const division = (d) => decode(d).replace(/,\s*(Faculty of|John H\. Daniels Faculty of)$/i, '').replace(/^University of Toronto /, 'UofT ');

const raw = JSON.parse(readFileSync(src, 'utf8'));
const recommended = existsSync(recSrc) ? JSON.parse(readFileSync(recSrc, 'utf8')).courses : {};
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
    recommended: tidy(recommended[c.code]),
    breadth: [...(c.breadthRequirements || []), ...(c.distributionRequirements || [])].map(decode),
  }))
  .sort((a, b) => a.code.localeCompare(b.code));

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(courses));
const withRec = courses.filter((c) => c.recommended).length;
console.log(`wrote ${courses.length} courses (${withRec} with recommended preparation) to ${out}`);
