---
name: import-mo-observations
description: Import new MO Pro "My Observations" list screenshots (from the Google Drive Astronomy folder or copied by hand) into observations.csv with extract.py, label any new Greek letters, research the new objects and publish. Use when the user says they uploaded or took new screenshots of their MO Pro observation log, or asks to bring new observations in.
---

# import-mo-observations

Screenshots of the MO Pro **My Observations** list (1080 × 2400, one card per observation) are read by `extract.py` into `observations.csv`. See README.md for how the extraction works.

## 1. Get the screenshots

**From Google Drive** (the user uploads to the folder `Astronomy` in the account the Drive connector uses):
1. `search_files` with `title = 'Astronomy' and mimeType = 'application/vnd.google-apps.folder'`, then `parentId = '<folder id>'` (page through `nextPageToken`; check subfolders too).
2. Skip files already in `screenshots/` (same file name).
3. `download_file_content` for each new image. The result is too large to return inline; the tool saves it as JSON (`{content, title, …}`) under the session's `tool-results/`. Decode each with
   `jq -r .content "$F" | base64 -d > "screenshots/$(jq -r .title "$F")"`.

**By hand:** the user copies them into `screenshots/` (top level).

## 2. Extract

```
python3 extract.py
```

It prints the row count and the flagged rows:
- **unknown Greek letter** → the glyph is saved in `glyphs/unlabeled/`. Make a contact sheet (PIL) of those crops, read it, rename each to `<letter>[digit]_<nnn>.png` (`sigma_040.png`, `theta1_041.png` for θ¹) and move it into `glyphs/`; delete crops that are only digits (Flamsteed numbers OCR correctly). Run `extract.py` again until no Greek flags remain.
- **card cut off: rating and S/T/B not visible** → the card was at the bottom edge of a screenshot. Tell the user which objects; they can screenshot those cards again (scrolling a bit less than a full screen avoids this).
- **rating hidden** → stars behind the "+" button; usually another screenshot shows it.

Spot-check a few rows against the screenshots (Read the image) before going on.

## 3. Research and publish

```
python3 .claude/skills/object-research/scripts/research.py   # new objects only; run in the background
```

Fix anything left unresolved (see the object-research skill: spellings go in `ALIASES`). Check one new object page in headless Chrome. Then `git pull --rebase`, commit and push.

Report: number of new observations, new objects vs repeat sightings, and any flagged rows the user should re-capture.
