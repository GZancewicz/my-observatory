# My Observatory: development plan (round 2)

Goal: everything about each object is readable inside the page, not behind links; the whole data set can be explored in linked charts with filters.

## Constraints and assumptions

- No build step, no framework. Plain HTML/CSS/JS. `index.html` must keep working when opened straight from disk (`file://`), so the browser never `fetch()`es local files: data reaches the page through `<script>` files that set globals.
- CDN libraries are allowed (the page needs internet for them): D3 7.9.0 from cdnjs, Aladin Lite v3 from CDS.
- `data/<category>/<slug>/*.json` stays the source of truth; `.js` files are generated mirrors for the browser.
- Data sources stay the same public services: SIMBAD (incl. its reference tables), Wikidata, Wikipedia, JPL Horizons, CelesTrak, VizieR.
- Colours come from the CSS tokens in `assets/style.css` (`--bg`, `--panel`, `--text`, `--muted`, `--accent`, `--gold`, …) so night mode keeps working everywhere.

## Workstreams and file ownership

Each workstream owns its files. Nobody edits another workstream's files.

| Workstream | Owns |
|---|---|
| A. Data | `.claude/skills/object-research/` (script + SKILL.md), everything under `data/` |
| B. Object page | `assets/app.js`, `assets/style.css`, `index.html` (keep the script/link tags listed below) |
| C. Overview charts | `assets/charts.js`, `assets/charts.css` |

### A. Data (research.py)

1. **SIMBAD in full.** Add to `object.simbad`:
   - `coordinates`: ICRS RA/Dec plus galactic l/b (compute in Python).
   - `hierarchy`: parents and children from `h_link` (e.g. a star's cluster or companion), each with main_id, otype and membership.
   - every measurement table that has rows for the object, as `measurements: {table_name: [rows]}`: at least `mesPM`, `mesPLX`, `mesRV` / `mesVelocities`, `mesSpT`, `mesDiameter`, `mesRot`, `mesFe_h`, `mesDistance`, `mesVar`, `mesIUE`, `mesXmm` if present. Keep the existing keys (`atmosphere_measurements`, `vsini_measurements`, `distance_measurements`) for compatibility.
   - `notes` if SIMBAD has any (`note` / annotations), otherwise omit.
2. **Research papers.** For each SIMBAD object: every reference from `has_ref` joined to `ref`, with bibcode, title, year, journal, volume, page, doi, and authors if the table has them. Write `papers.json` in the object folder. `object.json` gets `papers_count` only.
3. **Wikidata in full.** `object.wikidata.all_claims`: every claim on the item, keyed by property label (fetch property labels in batches), values formatted as now (quantities with unit and ±, items as labels, times, strings, URLs, external ids). Keep the curated `facts` as they are.
4. **Wikipedia in full.** The whole article as plain text split into sections: `[{title, level, text}]`, in `article.json` in the object folder (from `action=query&prop=extracts&explaintext=1&exsectionformat=wiki`). Also list the article's images (file title, thumbnail URL, caption if available) as `article.images`, capped at 12.
5. **Browser mirrors.**
   - `data/bundle.js` (exists): `window.MO_DATA = {index, objects}`, objects without papers or article text.
   - New per object: `data/<cat>/<slug>/extra.js` containing
     `(window.MO_EXTRA = window.MO_EXTRA || {})["<cat>/<slug>"] = {papers: [...], article: {sections: [...], images: [...]}};`
     The page loads it on demand with a dynamic `<script>` tag.
   - New: `data/sky/boundaries.json` and `data/sky/boundaries.js` (`window.MO_SKY = {boundaries: {"Ori": [[ra, dec], ...], ...}, names: {"Ori": "Orion", ...}}`) from VizieR VI/49, one closed polygon (or list of polygons) per constellation, all 88.
6. **Summary fields for charts.** Add to `object.summary` when computable: `abs_mag` (V + 5·log10(parallax_mas) − 10), `spectral_class` (O/B/A/F/G/K/M letter), `luminosity_class` (I, II, III, IV, V…), `gal_l`, `gal_b`. Never remove or rename existing summary fields.
7. Speed: add `--workers N` (default 4) to harvest objects in parallel, with per-service politeness kept.
8. Order of work: implement, harvest a few samples first (`Sirius`, `ρ Hya`, `Jupiter`, `Orion`, `STARLINK-37502`) and rebuild the bundle so B and C have real data early, then run the full `--refresh`.
9. Update SKILL.md (files, keys, flags).

### B. Object page (app.js / style.css)

1. **Research papers modal.** The "Research papers" fact card is clickable and opens a modal: search box, sort by year (newest first by default) or title, each paper with title, authors (if present), journal, year, and links to ADS (bibcode) and DOI. Loads `extra.js` on demand. Escape or a click outside closes it.
2. **SIMBAD inline, open.** A full "SIMBAD" section rendered on the page, not collapsed: basic data table (identifier, type, all coordinates incl. galactic, proper motion, parallax, radial velocity, redshift, spectral type, morphology, dimensions), photometry table, hierarchy, every measurement table (long tables show the first 10 rows with "show all"), identifiers, classifications, notes.
3. **Wikidata inline, open.** Full table of `all_claims` (fall back to `facts`).
4. **Wikipedia inline.** Full article with a small table of contents; sections collapsible but the first section open; article images in a strip. Loaded from `extra.js`.
5. **Embedded sky viewer.** Aladin Lite v3 panel centred on the object (DSS2 colour; constellations get a wide field), so the sky can be panned and zoomed in the page.
6. Horizons and CelesTrak sections shown open, not collapsed.
7. External links stay, as a short "Sources" row at the bottom, not the main way to see data.
8. **Routing hook for C.** Topbar gets an "Overview" link (`href="#overview"`). When `location.hash === "#overview"`: add class `is-overview` to `<body>` (CSS hides the list and the chips, `#detail` goes full width) and call
   `window.MO_CHARTS && window.MO_CHARTS.render(document.querySelector("#detail"), {data: window.MO_DATA, sky: window.MO_SKY, navigate: (path) => { location.hash = path; }})`.
   On leaving overview, call `window.MO_CHARTS.destroy && window.MO_CHARTS.destroy()` and remove the class.

### C. Overview charts (charts.js / charts.css)

`window.MO_CHARTS = {render(container, {data, sky, navigate}), destroy()}`. D3 v7 is loaded as `window.d3`. Read objects from `data.objects` (`summary`, `observations`, `category`, `name`, `path`); prefer the new summary fields and compute them when absent (abs_mag from v_mag and simbad.plx_value; spectral class from spectral_type; B−V from fluxes).

Charts, linked to each other:
1. **H-R diagram**: B−V (or temperature, reversed) vs absolute magnitude (bright at top), points coloured by temperature, labelled for the brightest/notable.
2. **All-sky map**: Hammer or Mollweide projection of RA/Dec, constellation boundaries from `sky.boundaries` when present, celestial equator and ecliptic, points sized by brightness and coloured by temperature, constellation and planet markers.
3. **Distance vs apparent magnitude** (log distance), with diagonal lines of constant absolute magnitude.
4. **Where they were in my sky**: polar alt/az plot of every observation (horizon at the rim, zenith centre, N up).
5. **Conditions vs rating**: rating against altitude, seeing and transparency (small multiples or a switch).
6. **Sessions timeline**: observations per night (a night runs noon to noon local), new vs repeat objects.
7. **Spectral class breakdown**: counts O–M.

Filters (one panel, applied to every chart): session/date range, category, spectral class, constellation, magnitude limit (slider; default no limit, preset "naked eye ≤ 6"), distance range, minimum rating, seeing and transparency minimums. Show "N of M objects".
Linked brushing: brushing a region in the H-R diagram, sky map or distance chart highlights those objects in every other chart; hover shows a tooltip; click navigates to the object page. Responsive grid; works at 390 px wide. Use the CSS tokens so night mode works. Load the `dataviz` skill before writing chart code.

## Integration (after A, B, C)

Lead checks: page opened via `file://` and via `http://`; every object page renders without console errors; overview renders with filters and brushing; night mode; phone width. Fix integration issues; summarise what was built.
