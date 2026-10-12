# My Observatory

My Observatory turns the observing log kept in the **My Observations** screen of Mobile Observatory Pro (MO Pro, the Android astronomy app by Wolfgang Zima) into an organised, browsable record. Screenshots of the log are read into a table of observations. Each observed object is then researched in public astronomy services, and the results are shown in a local web page with one page per object and a set of overview charts.

The project includes a Claude Code skill, `object-research`, that takes new observations through the research step, so that new screenshots can be added and processed by asking Claude.

## How it works

```
MO Pro "My Observations"  ──screenshots──▶  screenshots/
                                              │
                                  extract.py  │  (macOS Vision OCR + Greek glyph matching)
                                              ▼
                                       observations.csv
                                              │
              .claude/skills/object-research  │  (SIMBAD, Wikidata, Wikipedia, JPL Horizons, CelesTrak, VizieR)
                                              ▼
                              data/<category>/<object>/…
                                              │
                                              ▼
                                         index.html
```

### 1. Screenshots → `observations.csv` (`extract.py`)

Each screenshot shows a list of observation cards. For each card, `extract.py` records the object name, the object type, the date and time, the location, the star rating, seeing, transparency and Bortle class, and the screenshot it came from.

- Text is read by macOS Vision through `ocr`, a small command-line tool compiled from `ocr.swift`. OCR results are cached in `ocr_cache/` and reused until the screenshot changes.
- Vision does not read Greek letters, so the Bayer letter in names such as `ρ Hya` is matched by shape against the labelled reference images in `glyphs/`.
- The star rating is read from the pixel colours of the five rating stars.
- The same observation often appears on two overlapping screenshots. Duplicates are merged, and the most complete copy is kept.
- A row that could not be read fully is flagged in the `check` column: an unknown Greek letter, a card cut off at the screen edge, or a rating hidden behind the app's "+" button.

The pixel positions in `extract.py` (list top, navigation bar, rating star centres) match 1080 × 2400 screenshots. Screenshots from a phone with a different resolution need those constants adjusted.

### 2. Observations → object data (`object-research` skill)

`.claude/skills/object-research/scripts/research.py` reads `observations.csv`, assigns each object to a category (stars, planets, moons, constellations, satellites, clusters, nebulae, galaxies, comets, minor bodies), and collects public data about it:

| Category | Sources |
|---|---|
| Stars and deep-sky objects | CDS Sesame and SIMBAD (basic data, photometry, identifiers, hierarchy, measurement tables, research papers), Wikidata, Wikipedia |
| Planets and moons | JPL Horizons (physical data and the ephemeris at each observation time and site), Wikidata, Wikipedia |
| Constellations | Wikipedia, Wikidata, IAU boundaries from VizieR VI/49 |
| Satellites | CelesTrak orbital elements and catalogue data, Wikipedia |

For every observation it also computes the object's altitude and azimuth at the observing site and time. Observing sites are kept in `data/locations.json`; a new site name is geocoded through OpenStreetMap Nominatim.

Each object also gets a catalogue number, GZ-1, GZ-2 and so on, in the order objects were first observed. The numbers are kept in `data/gz_ids.json` and do not change once given; a newly observed object gets the next number. Stars without a constellation in Wikidata get one from their position and the IAU boundaries, and planets and satellites get the constellation they were in at each sighting.

Each object gets a folder under `data/<category>/<slug>/` with `object.json`, `papers.json`, `article.json` and images. The script also rebuilds `data/index.json`, `data/bundle.js` and the per-object `extra.js` files that the web page reads. The `.json` files are the source of truth; the `.js` files are generated copies that let the page work when opened straight from disk.

The skill's [SKILL.md](.claude/skills/object-research/SKILL.md) documents every output field, the name-resolution rules, and the command-line flags.

### 3. The viewer (`index.html`)

`index.html` lists every observed object with filters by category. Each object page shows the key facts, the observations with conditions and sky position, the full SIMBAD record, the Wikidata claims, the full Wikipedia article, the research papers, and an embedded Aladin Lite sky viewer.

The **Overview** page has linked charts across all observations: an H-R diagram, an all-sky map with constellation boundaries, distance against apparent magnitude, an alt/az plot of where each object was in the sky, conditions against rating, a sessions timeline, and a spectral class breakdown. One filter panel applies to every chart, and brushing a region in one chart highlights the same objects in the others.

The **Sizes** page puts every star, planet and satellite with a known or derivable size in a row, sorted by size, distance from Earth or temperature. Diameters are drawn on a logarithmic scale from 0.001 to 1,000 solar radii, with a ruler beside each object marked on that scale and its constellation, GZ number and distance from Earth underneath (light-years for stars, light-minutes for planets), with an eye icon lit for objects brighter than magnitude 6.0 and a binocular icon lit for objects brighter than magnitude 9.5 or for any icon whose equipment a sighting logged. Stars are coloured by the blackbody colour of their effective temperature; planets are grey spheres. Satellites are far below the bottom of the scale and are shown as a tiny grey diamond without a ruler. A star without a catalogue radius gets one estimated from its luminosity, or from its absolute magnitude and a bolometric correction, together with its temperature, and the estimate is marked ≈.

The page has a night mode. It needs an internet connection for D3 and Aladin Lite, which load from public CDNs.

## Adding new observations

1. In MO Pro, open **My Observations** and take screenshots that scroll through the new entries. Overlap between screenshots is fine.
2. Copy the screenshots into `screenshots/`.
3. In Claude Code, ask Claude to process the new screenshots, for example: *"I added new screenshots; extract them and research the new objects."* The `object-research` skill covers the research and rebuild steps.

Observations marked on MO Pro **Sky View** captures (stars circled by hand) are logged in `observations_manual.csv` rather than read by OCR, because `extract.py` rewrites `observations.csv` on every run and merges that file in. The `log-sky-captures` skill covers reading the captures (including identifying unlabelled circled stars with `fit_chart.py`), writing the rows and rebuilding; `import-mo-observations` covers list screenshots, including downloading them from Google Drive.

To run the same steps by hand:

```sh
python3 extract.py                                          # screenshots/ → observations.csv
python3 .claude/skills/object-research/scripts/research.py   # research new objects, rebuild the viewer data
```

`extract.py` prints the rows it flagged. For an unknown Greek letter, the letter's image is saved to `glyphs/unlabeled/`. Rename it to the letter's name with a number (for example `sigma_040.png`, or `theta1_041.png` for θ¹), move it into `glyphs/`, and run `extract.py` again.

After research, objects listed in `data/index.json` with `"resolved": false` were not found under the name MO Pro uses. These are usually old or unusual spellings; add the correct name to `ALIASES` in `research.py` and run it again with `--only "<name>" --refresh`.

Useful flags for `research.py`:

```sh
--refresh              # re-harvest every object
--only "ρ Hya"         # limit to one object (repeatable)
--incomplete           # retry objects missing SIMBAD or Wikipedia data
--workers 6            # harvest objects in parallel (default 4)
--sky                  # rebuild the constellation boundaries
```

## Viewing

Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000    # then open http://localhost:8000
```

## Requirements

- macOS, for the Vision OCR used by `extract.py`. Rebuild the `ocr` tool with `swiftc ocr.swift -o ocr` if it does not run.
- Python 3 with `numpy` and `Pillow`.
- Internet access for the research step and for the viewer's chart and sky-viewer libraries.

## Layout

| Path | Contents |
|---|---|
| `screenshots/` | MO Pro screenshots (input) |
| `extract.py`, `ocr.swift`, `ocr` | screenshot reader |
| `glyphs/` | labelled Greek letter images used to read Bayer names |
| `ocr_cache/` | cached OCR results |
| `observations.csv` | one row per observation |
| `.claude/skills/object-research/` | Claude Code skill and research script |
| `data/` | per-object data, observing sites, constellation boundaries, viewer bundles |
| `index.html`, `assets/` | the viewer |
| `PLAN.md` | development plan |

## License

MIT. See [LICENSE](LICENSE).
