# UofT PrereqTree — frontend

Interactive prerequisite explorer for ~6,300 UofT courses (St. George, UTM, UTSC).

```bash
npm install
npm run dev     # regenerates public/courses.json from ../backend/data, then starts Vite
npm run build
```

## How it works

- `scripts/build-data.mjs` slims `backend/data/courses.json` into `public/courses.json` (fetched at runtime, not bundled).
- `src/prereq.ts` parses the calendar's prerequisite text into an AND/OR tree
  (`/` = or, `,` `;` = and, `and`/`or` words, `()` / `[]` groups, grade qualifiers stripped).
  Free-text requirements (credit counts, program enrolment) can't be checked and are flagged instead.
  The scraped `prereqCodes` field is ignored — it is wrong for ~1,000 courses.
- `src/graph.ts` turns the tree into a left-to-right graph with "one of" / "all of" nodes,
  hides other-campus/other-division alternatives and already-satisfied branches, and limits depth.
- Several courses can be on the map at once (click results to add, × on a chip to remove).
- Completed courses are saved in localStorage; **Share** copies a link with `?course=A,BCompleted courses are saved in localStorage; **Share** copies a link with `?course=…&done=…`.done=…`.

Known data gap: most year-long `Y` courses (e.g. MAT137Y1) are missing from the scrape. They still
appear in trees as dashed "not in catalog" nodes and can be marked completed.
