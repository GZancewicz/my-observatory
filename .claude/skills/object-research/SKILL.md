---
name: object-research
description: Harvest everything public about the astronomical objects in observations.csv (stars, planets, constellations, satellites, deep-sky objects) into data/<category>/<object>/object.json plus images, and rebuild data/index.json for the viewer. Use when asked to research, look up, enrich, refresh or add details for observed objects, after new screenshots are extracted, or when an object shows as unresolved in the viewer.
---

# object-research

Turns each object in `observations.csv` (written by `extract.py` from MO Pro screenshots) into a folder of details the viewer (`index.html`) reads.

## Run

From the project root:

```
python3 .claude/skills/object-research/scripts/research.py              # harvest new objects, refresh observations
python3 .claude/skills/object-research/scripts/research.py --refresh    # re-harvest every object
python3 .claude/skills/object-research/scripts/research.py --only "ρ Hya" --refresh
python3 .claude/skills/object-research/scripts/research.py --incomplete # retry objects missing SIMBAD or Wikipedia
```

Observations are re-attached and `summary` is rebuilt from stored data on every run, so run it after every `extract.py`. A full refresh of ~80 objects takes several minutes; run it in the background.

View: `python3 -m http.server 8000` in the project root, open http://localhost:8000. (Browsers block `fetch` from `file://`.)

## Output

```
data/
  index.json                    list of objects for the viewer (rebuilt every run)
  locations.json                observing sites: lat, lon, elev_m, tz (edit to add sites)
  <category>/<slug>/
    object.json                 everything below
    sky.jpg                     sky cutout (DSS2 for stars, Mellinger wide-field for constellations)
    photo.jpg                   Wikipedia lead image
```

Categories come from the MO Pro type line (`CATEGORY_RULES` in the script): `stars`, `planets`, `moons`, `constellations`, `satellites`, `clusters`, `nebulae`, `galaxies`, `comets`, `minor-bodies`, `other`. Slugs spell Greek letters out (`τ² Hya` → `tau2-hya`).

`object.json` keys: `name`, `category`, `app_type`, `resolved` (how the name was matched), `summary` (normalised key facts the viewer shows first), `simbad`, `wikipedia`, `wikidata`, `horizons`, `celestrak`, `geometry` (constellations), `images`, `observations` (each with UTC time, altitude/azimuth at that moment, and for planets the Horizons ephemeris), `sources` (with retrieval dates), `harvested`.

## Sources and how names are resolved

| Category | Sources |
|---|---|
| stars, deep-sky | CDS Sesame → SIMBAD TAP (position, type, spectral type, parallax, photometry, identifiers, Teff/log g/[Fe/H], v sin i, distances); Wikidata by SIMBAD ID (P3083) → mass, radius, luminosity, age; Wikipedia intro |
| planets, moons | JPL Horizons (physical data, ephemeris at each observation time and site); Wikipedia; Wikidata |
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

## Extending

- New category: add a rule to `CATEGORY_RULES`, a branch in `harvest()` if it needs another source, and a label in `CATEGORIES` in `assets/app.js`.
- New Wikidata fact: add the property to `WD_PROPS`; map its unit in `SOLAR` or `UNIT_LABELS` if the label is long.
- New summary field shown as a card: add it in `summarise()` and `keyFacts()` in `assets/app.js`.
