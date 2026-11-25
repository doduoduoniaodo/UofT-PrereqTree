# UofT PrereqTree — frontend

Interactive prerequisite explorer for ~6,300 UofT courses (St. George, UTM, UTSC).

```bash
npm install
npm run dev     # regenerates public/courses.json from ../backend/data, then starts Vite
npm test        # parser, equivalents, route finder, layout + smoke tests on the real data
npm run build
```

## How it works

- `scripts/build-data.mjs` slims `backend/data/courses.json` into `public/courses.json` (fetched at runtime, not bundled),
  adding each course's **Recommended Preparation** from `backend/data/recommended.json`. That file comes from
  `node backend/scripts/fetch-recommended.mjs`, which reads the course listings of the official UofT calendars
  (A&S, UTM, UTSC, Engineering, Music, KPE, Daniels; ~400 pages, a few minutes). Re-run it to refresh.
- **Recommended preparation** is parsed like a prerequisite but never required: shown in the side panel, and
  with **Recommended prep** on, drawn as dotted teal arrows into the selected courses.
- `src/suggest.ts` suggests **what to take next** (sidebar tab **★ Next**, and **★ Suggested next** on the map):
  courses you can take now, ranked by next steps toward the courses on your map, then how many locked courses
  they'd open up and how well they fit your subjects, campus and level.
- `src/prereq.ts` parses the calendar's prerequisite text into an AND/OR tree
  (`/` = or, `,` `;` = and, `and`/`or` words, `()` / `[]` groups).
  Grade minimums ("60% or higher in CSC148H1", "CSC110Y1 (70% or higher)") are kept on the course
  they apply to and shown as **≥60%** badges (side panel, and on the arrow in the graph).
  Requirements that can't be checked (credit counts, program enrolment, permission) are kept as
  **?** conditions where they apply — "also needed" or "or, alternatively" — and never block a course.
  A course you qualify for lists what to double-check before enrolling; the fastest route lists them
  along the way.
  The scraped `prereqCodes` field is ignored — it is wrong for ~1,000 courses.
- `src/catalog.ts` builds the course index and works out **equivalent courses** — the same course on
  another campus (CSC263H1 / CSC263H5 / CSCB63H3). Completing one counts for the others ("Counts as
  completed", shown in teal). Calendar "exclusions" alone are not trusted: they also link different
  courses that merely overlap (CSC108H1 / CSC111H1), so only same-number or mutually-excluding
  cross-campus pairs count.
- `src/path.ts` finds the **fastest route** to a course: the fewest credits still needed, choosing the
  cheapest option in each "one of", preferring the course's own campus and faculty and avoiding codes
  missing from the data. It's shown as steps in the side panel and can be highlighted on the map.
- `src/graph.ts` turns the tree into a left-to-right graph with "one of" / "all of" nodes,
  hides other-campus/other-division alternatives and already-satisfied branches, and limits depth.
- Several courses can be on the map at once (click results to add, × on a chip to remove).
- On the graph: **+ / −** on a course's left edge shows/hides its prerequisites, the button on a
  selected course's right edge shows/hides its postrequisites, and nodes can be dragged — a course's
  prerequisites/postrequisites move with it, including ones expanded later. Expanding or hiding never
  moves what's already on screen; new courses go to their usual spot next to their course, which only
  shifts (as little as possible) if they'd overlap something (**Reset layout** returns to the automatic
  layout). See `src/placement.ts`.
- Completed courses are saved in localStorage; **Share** copies a link with `?course=A,B&done=…`.

Known data gap: most year-long `Y` courses (e.g. MAT137Y1) are missing from the scrape. They still
appear in trees as dashed "not in catalog" nodes, can be found by typing the full code in search, and
can be marked completed.
