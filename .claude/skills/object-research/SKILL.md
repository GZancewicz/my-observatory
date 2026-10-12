---
name: object-research
description: Harvest everything public about the astronomical objects in observations.csv (stars, planets, constellations, satellites, deep-sky objects) into data/<category>/<object>/ (object.json, papers.json, article.json, extra.js, images), rebuild data/index.json and data/bundle.js for the viewer, and build the IAU constellation boundaries in data/sky/. Use when asked to research, look up, enrich, refresh or add details for observed objects, after new screenshots are extracted, or when an object shows as unresolved in the viewer.
---

# object-research

Turns each object in `observations.csv` (written by `extract.py` from MO Pro screenshots, merged with the hand-entered rows in `observations_manual.csv`) into a folder of details the viewer (`index.html`) reads. Getting observations in is covered by the `import-mo-observations` and `log-sky-captures` skills.

## Run

From the project root:

```
python3 .claude/skills/object-research/scripts/research.py              # harvest new objects, refresh observations
python3 .claude/skills/object-research/scripts/research.py --refresh    # re-harvest every object
python3 .claude/skills/object-research/scripts/research.py --only "ρ Hya" --refresh
python3 .claude/skills/object-research/scripts/research.py --incomplete # retry objects missing SIMBAD or Wikipedia
python3 .claude/skills/object-research/scripts/research.py --only Sirius --only Jupiter --refresh   # --only repeats
python3 .claude/skills/object-research/scripts/research.py --refresh --workers 6   # parallel harvest (default 4)
python3 .claude/skills/object-research/scripts/research.py --sky        # rebuild data/sky/boundaries.*
```

Observations are re-attached, `summary` is rebuilt from stored data, and `index.json`, `bundle.js` and every `extra.js` are regenerated on every run, so run it after every `extract.py`. Satellite observations get a `track`: every pass over the site from 12 h before to 12 h after the sighting, propagated with SGP4 from the CelesTrak elements (needs the Python package `sgp4`: `pip3 install sgp4`; without it tracks are skipped). Each pass has rise/peak/set times, directions, `visible` (sunlit while the site's Sun is below −6°) and `sighting` (the nearest pass within 15 min of the logged time, because logs are usually written just after a pass); points are `[seconds from sighting, RA, Dec, alt, az, sunlit]`. The viewer draws them on the sky map and alt/az plot and lists them on the satellite's page. Hand-entered rows may carry `equipment` (naked eye / binoculars / telescope) and `notes`; they are copied into each observation and shown in the page's "How seen" column. The constellation boundaries are built when missing, on a full `--refresh`, or with `--sky`.

`--workers N` harvests N objects at once. Requests stay polite per service: request starts to one host are spaced (`PAUSE`, 0.3 s) and at most 2 run at once (3 for SIMBAD); Nominatim is held to one request per 1.1 s, CelesTrak and the Wikidata SPARQL endpoint to one at a time (`HOST_LIMITS`). A full refresh of ~84 objects with `--workers 6` takes roughly 10–20 minutes; run it in the background and watch its output.

View: open `index.html` directly (data reaches the page through the `.js` mirrors), or `python3 -m http.server 8000` and http://localhost:8000.

## Output

```
data/
  index.json                    list of objects for the viewer (rebuilt every run)
  gz_ids.json                   object name -> GZ catalogue number (append-only; never renumber)
  bundle.js                     window.MO_DATA = {index, objects}: index.json plus every object.json
  locations.json                observing sites: lat, lon, elev_m, tz (edit to add sites)
  sky/
    boundaries.json             IAU constellation boundaries (source of truth)
    boundaries.js               window.MO_SKY = the same object
  <category>/<slug>/
    object.json                 everything below except papers and article text
    papers.json                 SIMBAD references for the object ([] when none)
    article.json                full Wikipedia article: sections and images
    extra.js                    papers + article for the browser, loaded on demand
    sky.jpg                     sky cutout (DSS2 for stars, Mellinger wide-field for constellations)
    photo.jpg                   Wikipedia lead image
```

The `.json` files are the source of truth; `bundle.js`, `extra.js` and `boundaries.js` are generated mirrors so the page works from `file://` without `fetch()`.

Categories come from the MO Pro type line (`CATEGORY_RULES` in the script): `stars`, `planets`, `moons`, `constellations`, `satellites`, `clusters`, `nebulae`, `galaxies`, `comets`, `minor-bodies`, `other`. Slugs spell Greek letters out (`τ² Hya` → `tau2-hya`).

`object.json` keys: `name`, `category`, `app_type`, `resolved` (how the name was matched), `summary` (normalised key facts the viewer shows first), `simbad`, `papers_count` (SIMBAD objects only), `wikipedia`, `wikidata`, `horizons`, `celestrak`, `geometry` (constellations), `images`, `observations` (each with UTC time, altitude/azimuth at that moment, and for planets the Horizons ephemeris), `sources` (with retrieval dates), `harvested`, `id`, `path`, `gz_id`.

`gz_id` (`GZ-1`, `GZ-2`, …) numbers objects in the order they were first observed. `assign_gz_ids()` keeps the numbers in `data/gz_ids.json`, keyed by the name as written in observations.csv; an object new to that file gets the next number after every existing one, in order of its earliest observation and then name, so a number never changes once given. Renaming an object in the CSV gives it a new number unless its key in `gz_ids.json` is renamed too.

`summary`: `designation`, `object_type`, `spectral_type`, `ra_deg`, `dec_deg`, `v_mag`, `distance_pc`, `distance_ly`, `teff_k`, `b_minus_v`, `mass`, `radius`, `luminosity`, `age`, `constellation`, `area`, `orbital_period`, `rotation_period`, `abbreviation`, `description`, satellite fields (`norad_id`, `launch_date`, `owner`, `apogee_km`, `perigee_km`, `inclination_deg`, `period_min`), and for charts `abs_mag` (V + 5·log10(parallax mas) − 10), `spectral_class` (O/B/A/F/G/K/M), `luminosity_class` (`Ia`, `Iab`, `Ib`, `II`, `III`, `IV`, `V`, `VI`; first one given), `gal_l`, `gal_b` (degrees). `constellation` comes from Wikidata; when Wikidata has none, `constellation_at()` finds it from the position and `data/sky/boundaries.json`. Planets and satellites have no fixed constellation; instead each observation carries `constellation` for that moment (planets from the Horizons ephemeris row, satellites from the highest point of the sighted pass). Keys without a value are left out. Never remove or rename these; the viewer and charts read them.

`simbad`: every column of SIMBAD `basic` except `*_prec` digit counts (`main_id`, `oid`, `ra`, `dec`, `otype`, `otype_desc`, `sp_type`, `plx_value`, `pmra`, `rvz_radvel`, … with their errors, qualities and bibcodes), plus
- `coordinates`: `frame`, `epoch`, `ra_deg`, `dec_deg`, `ra_hms`, `dec_dms`, `gal_l`, `gal_b`, `err_maj_mas`, `err_min_mas`, `err_angle_deg`, `quality`, `wavelength`, `bibcode`. Galactic coordinates are computed in Python (Hipparcos ICRS→galactic matrix).
- `hierarchy`: `parents` and `children` from `h_link`, each `{main_id, otype, otype_desc, membership, bibcode}`; children capped at 500 with `children_total` when capped.
- `measurements`: `{table: [rows]}` for every SIMBAD measurement table with rows for the object (`MES_TABLES`: mesDiameter, mesDistance, mesFe_h, mesHerschel, mesISO, mesIUE, mesOtype, mesPLX, mesPM, mesRot, mesSpT, mesVar, mesVelocities, mesXmm), all columns except `oidref`, `mespos` and `*_prec`.
- kept for compatibility: `identifiers`, `fluxes` (`{filter: {mag, err}}`), `atmosphere_measurements`, `teff_median`, `vsini_measurements`, `distance_measurements`, `types`, `url`.
- `notes`: `[{date, text}]` from the SIMBAD object page, only when SIMBAD has notes (TAP has no notes table).

`papers.json`: every reference in SIMBAD `has_ref` joined to `ref`, newest first: `{bibcode, title, year, journal, volume, page, last_page, doi, authors, et_al}`. `authors` holds the first 10 names from SIMBAD's `author` table (SIMBAD style, `KOVALEV M.Y.`); `et_al: true` when there are more. Empty fields are left out. The query is paged (`TAP_PAGE` rows) so stars with thousands of references come back whole. ADS link: `https://ui.adsabs.harvard.edu/abs/<bibcode>`.

`wikidata`: `id`, `url`, `commons_image`, `facts` (curated `WD_PROPS`, `{label: [{value, unit?, plus?, minus?}]}`, preferred rank first), and `all_claims`: every claim on the item keyed by English property label (deprecated values dropped, preferred first). Each value is `{value, type}` plus `unit`/`plus`/`minus` for quantities, `qid` for items (value is the label), `url` for external ids (from the property's formatter URL, P1630) and Commons media. Times are `YYYY-MM-DD`, `YYYY-MM` or `YYYY` by precision. `property_ids` maps each label to its P-id. A label used by two properties gets ` (Pnnn)` appended.

`wikipedia`: `title`, `description`, `summary`, `intro`, `url`, `thumbnail`, `image`, `wikidata`, `sections_count`.

`article.json`: `{title, url, retrieved, sections: [{title, level, text}], images: [{title, thumbnail, caption, url}]}`. The lead is `{title: "Introduction", level: 1}`; `==` headings are level 2, `===` level 3 and so on. Text is plain (TextExtracts `explaintext`); empty References / External links / See also / Notes sections are dropped. Images come from the REST `media-list` (gallery images only, at most 12; the lead image usually has no caption).

`extra.js` (one per object, always written, empty lists when there is nothing):

```
(window.MO_EXTRA = window.MO_EXTRA || {})["<cat>/<slug>"] = {papers: [...], article: {sections: [...], images: [...]}};
```

`sky/boundaries.json` / `boundaries.js` (`window.MO_SKY = …`): `{boundaries: {"Ori": [[ra, dec], ...], ..., "Ser": [[[ra, dec], ...], [[ra, dec], ...]]}, names: {"Ori": "Orion", ...}, source, format, generated}`. All 88 constellations with IAU abbreviation case (`CVn`, `UMa`, `CrA`). Each is one closed ring (first point repeated at the end) in J2000 degrees; Serpens is a list of two rings (Caput, then Cauda). Built from VizieR `VI/49/constbnd` (B1875 vertices in boundary order, edges along constant RA or Dec), with edges sampled every 1° and precessed to J2000 (IAU 1976). The J2000 table `VI/49/bound_20` is not used for drawing because its points are not in boundary order. Rings are wound so that `d3.geoArea` of `{type: "Polygon", coordinates: [ring]}` with lon = RA is the small area; reverse them if you project with lon = −RA and use d3-geo's spherical clipping.

## Sources and how names are resolved

| Category | Sources |
|---|---|
| stars, deep-sky | CDS Sesame → SIMBAD TAP (basic data, coordinates, photometry, identifiers, hierarchy, every measurement table, references with authors) and the SIMBAD page for notes; Wikidata by SIMBAD ID (P3083) → curated facts and every claim; full Wikipedia article |
| planets, moons | JPL Horizons (physical data, ephemeris at each observation time and site); Wikipedia (full article); Wikidata |
| constellations | Wikipedia `<name> (constellation)`; Wikidata (area, IAU abbreviation); centre and size from the IAU boundaries (VizieR VI/49) |
| satellites | CelesTrak GP (orbit) and SATCAT (launch, owner, apogee/perigee); Wikipedia for the programme (e.g. Starlink) |

Star name resolution, in order:
1. Greek letter converted to SIMBAD form (`τ² Hya` → `tau02 Hya`, `θ¹ Ori` → `tet01 Ori`) and sent to Sesame.
2. Name as written, to Sesame (handles `HD 83343`, `27 Hya`, `TYC …`, IAU proper names).
3. Wikipedia, following redirects, then the SIMBAD ID from Wikidata P3083. This catches MO Pro's older spellings (Kocab → Kochab → β UMi, Shedir → α Cas, Nair al Saif → ι Ori, Ras Elased Australis → ε Leo).
4. Spellings none of these know go in `ALIASES` in the script (e.g. `Adara` → `Adhara`).

Wikipedia article for a star: Wikidata by SIMBAD ID first; otherwise titles built from the SIMBAD identifiers are tried in order (proper name, `* alf Car` → Alpha Carinae, `* 11 Leo` → 11 Leonis, `HD …`), accepting the first page that mentions a star. Faint Flamsteed and HD stars often have no article; that is expected.

Check `resolved.method` and `resolved.simbad_id` in object.json when a result looks wrong. MO Pro's "θ¹ Ori" resolves to the Trapezium cluster in SIMBAD, which is correct.

## After running

- Report objects whose `index.json` entry has `"resolved": false` and fix them (usually a spelling: add a special case or rename in the CSV).
- Report any new location the script geocoded via Nominatim; its time zone defaults to America/Chicago and must be checked in `data/locations.json`.
- Altitudes are computed from J2000 coordinates without precession or refraction; good to about half a degree.
- CelesTrak orbital elements are current, not at the observation time.
- Check that every object folder has `extra.js`, and that `data/bundle.js` stays under ~5 MB (papers and article text live in `extra.js`, not in the bundle).
- An object whose `article.json` has no sections while `object.json` has `wikipedia` hit an empty TextExtracts response; rerun it with `--only "<name>" --refresh`.

## Extending

- New category: add a rule to `CATEGORY_RULES`, a branch in `harvest()` if it needs another source, and a label in `CATEGORIES` in `assets/app.js`.
- New Wikidata fact: add the property to `WD_PROPS`; map its unit in `SOLAR` or `UNIT_LABELS` if the label is long.
- New summary field shown as a card: add it in `summarise()` and `keyFacts()` in `assets/app.js`.
- New SIMBAD measurement table: add it to `MES_TABLES`.
- New per-service limit: add the host to `HOST_LIMITS` as `(seconds between request starts, requests at once)`.
