---
name: log-sky-captures
description: Log observations from annotated sky-chart screenshots (MO Pro Sky View captures, often forwarded through WhatsApp, with the observed stars circled by hand) into observations_manual.csv, research the new objects and publish. Use when the user says they captured or saved sky-chart images, circled what they saw, or asks which objects they observed in some screenshots.
---

# log-sky-captures

The user marks what they saw on MO Pro **Sky View** screenshots: observed stars are circled in blue, and a caption says how they were seen. These rows do not come from the MO Pro "My Observations" list, so they are not read by `extract.py`'s OCR; they are written to `observations_manual.csv`, which `extract.py` merges into `observations.csv`.

## 1. Collect the images

- Find the new captures (usually `~/Desktop/Screenshot <date> at <time>.png`, newest first: `ls -lt ~/Desktop | head`).
- Move them into `screenshots/<YYYY-MM-DD>/` (a dated **subfolder**: `extract.py` reads every image at the top level of `screenshots/`, and these are not list screens).

## 2. Read each image

Read every image with the Read tool and note, per image:
- **Time.** The Sky View header shows the chart's clock ("Sun, Oct 11, 2026 2:56:51 CDT"); prefer it. Otherwise use the chat send time under the caption and mark it approximate. "Sidereal Time" at the bottom is **not** the clock time.
- **Objects.** Every circled star or object. App labels sit just below their star. A header card ("75 Tau, K-Star, RA … m 5.0") names the selected object; a header left over from a previous view can still name an object (e.g. "RA 8h43m δ+21°28′ m 4.7" = Asellus Borealis).
- **How seen.** No caption = naked eye. Captions such as "binoculars", "very faint to naked eye", "very faint in binoculars" give equipment and notes. "Named eye" is a typo for naked eye.
- Hand-drawn dashes or ticks that are not circles: list them as uncertain, do not log them.

**Unlabelled circled stars:** fit the chart to two labelled stars and match the circles against SIMBAD:

```
python3 .claude/skills/log-sky-captures/scripts/fit_chart.py \
  --ref "Procyon:234,703" --ref "Alhena:192,385" \
  --check "Gomeisa:214,629" --circle 140,280 --circle 55,340
```

Coordinates are pixels in the image as you see it (all in the same frame). Pick reference stars far apart; add a `--check` star to confirm the fit is within a few pixels. Default projection is stereographic (what MO Pro draws); `--projection gnomonic` is available.

Show the user a table (time, area, objects, how seen) and state anything uncertain before writing.

## 3. Write the rows

Ask the user for conditions if they have not given them. Their usual answer so far: seeing 3/5, transparency 3/5, rating 3 stars, very faint objects 2 stars, Bortle 6, location "Royse City, Texas".

- **Names.** Reuse the exact name already in `observations.csv` for objects seen before (e.g. `θ¹ Ori`, `Nair al Saif`, `Mars`), so new rows join the existing object. New objects: IAU proper name if it has one (`Elnath`, not the app's `Alnath`), otherwise Bayer with Greek letter (`ε Lep`, `θ Aur`), otherwise the catalogue id (`HD 60803`).
- **Type** (decides the data folder): look up each new object's spectral type and use its first letter as `X-Star` (`Planet`, `Constellation` etc. for non-stars):
  ```
  python3 -c "import importlib.util as u; s=u.spec_from_file_location('r','.claude/skills/object-research/scripts/research.py'); m=u.module_from_spec(s); s.loader.exec_module(m); n='Meissa'; i=m.sesame(m.simbad_style(n)) or m.sesame(n); print(i, m.tap(f\"SELECT sp_type FROM basic WHERE main_id='{m.esc(i)}'\"))"
  ```
- Append to `observations_manual.csv`; columns: `object,type,datetime,location,rating,seeing,transparency,bortle,source,check,equipment,notes` with `datetime` as `YYYY-MM-DD HH:MM` local time, `seeing`/`transparency` as `3/5`, `source` = `screenshots/<date> (sky-chart captures)`, `equipment` = `naked eye` / `binoculars` / `telescope`, `notes` = the caption wording or how an identification was made.

## 4. Rebuild and publish

```
python3 extract.py                                          # merges observations_manual.csv; check the row count went up by the number logged
python3 .claude/skills/object-research/scripts/research.py   # harvests only the new objects (run in the background; ~30 s per object)
```

Then check: every new object is in `data/index.json` with `"resolved": true`; the object pages show the new observations with the "How seen" column (headless Chrome screenshot of one page). Then `git pull --rebase`, commit and push.

Report which objects were new and which were repeat sightings.
