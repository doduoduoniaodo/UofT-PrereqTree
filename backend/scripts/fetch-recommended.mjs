// Fetches each course's "Recommended Preparation" from the official UofT academic calendars
// and writes backend/data/recommended.json: { fetchedAt, courses: { CODE: "text", ... } }.
//
// The original course scrape (backend/data/courses.json) doesn't include this field. Rather than
// opening ~6,300 course pages, this reads each calendar's paginated course listing (~400 pages),
// one request at a time with a short pause between them.
//
// Run: node backend/scripts/fetch-recommended.mjs   (takes a few minutes)
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, '../data/recommended.json');

const CALENDARS = [
  { name: 'Arts & Science', url: 'https://artsci.calendar.utoronto.ca/search-courses' },
  { name: 'UTM', url: 'https://utm.calendar.utoronto.ca/course-search' },
  { name: 'UTSC', url: 'https://utsc.calendar.utoronto.ca/search-courses' },
  { name: 'Engineering', url: 'https://engineering.calendar.utoronto.ca/search-courses' },
  { name: 'Music', url: 'https://music.calendar.utoronto.ca/search-courses' },
  { name: 'Kinesiology', url: 'https://kpe.calendar.utoronto.ca/search-courses' },
  { name: 'Architecture', url: 'https://daniels.calendar.utoronto.ca/search-courses' },
];

const PAUSE_MS = 250;
const HEADERS = { 'User-Agent': 'UofT-PrereqTree course data script (student project)' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, tries = 3) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(45_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      if (attempt >= tries) throw new Error(`${url}: ${err.message}`);
      await sleep(2000 * attempt);
    }
  }
}

const decode = (s) =>
  s
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/​/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const CODE = /([A-Z]{3}[A-Z0-9]\d{2}[HY]\d)\s*[-•–]/;
const FIELD = /views-field-field-recommended(?:-preparation)?"[^>]*>([\s\S]*?)<\/span>\s*<\/span>/;

/** Course code -> recommended preparation text, for one listing page. */
export function parseListing(html) {
  const out = {};
  const chunks = html.split('<h3 class="js-views-accordion-group-header">').slice(1);
  for (const chunk of chunks) {
    const heading = decode(chunk.slice(0, chunk.indexOf('</h3>')));
    const code = CODE.exec(heading)?.[1];
    if (!code) continue;
    const field = FIELD.exec(chunk);
    if (!field) continue;
    const text = decode(field[1]).replace(/^Recommended Preparation:\s*/i, '');
    if (text) out[code] = text;
  }
  return out;
}

const lastPage = (html) => Number(/page=(\d+)[^"]*"\s+title="Go to last page/.exec(html)?.[1] ?? 0);

async function main() {
  const courses = {};
  const sources = {};
  for (const cal of CALENDARS) {
    const first = await get(`${cal.url}?page=0`);
    const last = lastPage(first);
    let found = 0;
    for (let page = 0; page <= last; page++) {
      const html = page === 0 ? first : await get(`${cal.url}?page=${page}`);
      const got = parseListing(html);
      for (const [code, text] of Object.entries(got)) if (!courses[code]) courses[code] = text;
      found += Object.keys(got).length;
      process.stdout.write(`\r${cal.name}: page ${page + 1}/${last + 1}, ${found} with recommended preparation`);
      if (page < last) await sleep(PAUSE_MS);
    }
    process.stdout.write('\n');
    sources[cal.name] = cal.url;
  }
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({ fetchedAt: new Date().toISOString(), sources, courses }, null, 1));
  console.log(`wrote ${Object.keys(courses).length} courses to ${OUT}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
