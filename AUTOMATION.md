# Automatic import of new screenshots

This document describes a setup that imports new MO Pro screenshots and updates the site without a Mac or a Claude Code session. **None of it is built yet.** The files named below (`.github/workflows/import.yml`, `scripts/assign_equipment.py`, the Apps Script project) are proposals.

## Why it has to run on macOS

`extract.py` reads each screenshot through `ocr`, a command-line tool compiled from `ocr.swift`. `ocr.swift` uses Apple's Vision framework, which exists only on macOS. A Claude Code scheduled routine (`/schedule`) runs on Linux and cannot run it.

GitHub Actions has macOS runners with Vision available. The repository is public, so runner minutes on macOS are free. The site is served by GitHub Pages from the root of `main` (<https://gzancewicz.github.io/my-observatory/>), so a push to `main` updates it.

## Overview

```
Phone ──email──▶ Gmail (label mo-screenshots)
                    │
   Google Apps Script, every 15 minutes
                    │  commits each image to screenshots/ (GitHub contents API)
                    ▼
GitHub repo, push to screenshots/**
                    │
   GitHub Actions, macos-latest
                    │  build ocr → extract.py → research.py → assign equipment → rebuild
                    ▼
push to main ──▶ GitHub Pages site
```

Google runs the trigger and GitHub runs the import. No step uses the Mac.

## Part 1: Gmail to the repository (Google Apps Script)

Apps Script runs under the Google account that owns the mailbox, so it needs no separate Google login or Gmail connector. It searches for unprocessed messages, commits each image attachment to `screenshots/`, and labels the message so it is not picked up again. A `.zip` attachment, such as a Google Drive folder download, is unzipped and its images committed.

### Setup

1. In Gmail, create a filter that applies the label `mo-screenshots` to the messages that carry screenshots, for example messages from yourself with the subject `MO` and an attachment.
2. On GitHub, create a fine-grained personal access token (Settings → Developer settings → Fine-grained tokens) with access to `GZancewicz/my-observatory` only and the permission **Contents: Read and write**. Note its expiry date; the import stops when it expires.
3. Go to <https://script.google.com>, create a project, and paste the script below.
4. In Project Settings → Script properties, add `GITHUB_TOKEN` with the token as its value.
5. Run `importScreenshots` once from the editor and grant the Gmail permission it asks for.
6. Under Triggers, add a time-driven trigger for `importScreenshots`, every 15 minutes.

### Script

```js
const REPO = 'GZancewicz/my-observatory';
const QUERY = 'label:mo-screenshots -label:mo-imported has:attachment';

function importScreenshots() {
  const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  const done = GmailApp.getUserLabelByName('mo-imported') || GmailApp.createLabel('mo-imported');
  for (const thread of GmailApp.search(QUERY, 0, 20)) {
    for (const msg of thread.getMessages()) {
      for (const att of msg.getAttachments()) {
        const blobs = /\.zip$/i.test(att.getName()) ? Utilities.unzip(att.copyBlob()) : [att.copyBlob()];
        for (const blob of blobs) {
          const name = blob.getName().split('/').pop();   // zip entries carry a folder prefix
          if (/\.(jpe?g|png)$/i.test(name)) putFile(token, 'screenshots/' + name, blob);
        }
      }
    }
    thread.addLabel(done);
  }
}

// Commits one file. A file that is already in the repository is left alone.
function putFile(token, path, blob) {
  const url = `https://api.github.com/repos/${REPO}/contents/` + path.split('/').map(encodeURIComponent).join('/');
  const headers = { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' };
  if (UrlFetchApp.fetch(url, { headers, muteHttpExceptions: true }).getResponseCode() === 200) return;
  UrlFetchApp.fetch(url, {
    method: 'put', headers, contentType: 'application/json',
    payload: JSON.stringify({
      message: 'Add screenshot ' + path.split('/').pop(),
      content: Utilities.base64Encode(blob.getBytes()),
      branch: 'main',
    }),
  });
}
```

Each image becomes its own commit. The workflow's concurrency setting (Part 2) means a burst of commits produces one running import and at most one queued import, and the queued one processes every screenshot present.

### Variant: Google Drive instead of Gmail

If the screenshots are uploaded to the Drive folder `Astronomy` rather than emailed, the same script can read that folder instead: `DriveApp.getFoldersByName('Astronomy')`, then walk its files and subfolders, and keep the IDs of files already sent in a script property in place of the Gmail label. Everything after the commit is the same.

## Part 2: The import (GitHub Actions)

`.github/workflows/import.yml` runs on every push to `main` that touches `screenshots/`, and can also be started by hand from the Actions tab.

```yaml
name: Import observations

on:
  push:
    branches: [main]
    paths: ['screenshots/**']
  workflow_dispatch:

concurrency:
  group: import
  cancel-in-progress: false

permissions:
  contents: write

jobs:
  import:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'
      - run: pip install numpy pillow requests sgp4
      - name: Build the OCR tool
        run: swiftc -O ocr.swift -o ocr
      - name: Read screenshots
        run: python3 extract.py
      - name: Research new objects
        run: python3 .claude/skills/object-research/scripts/research.py
      - name: Assign equipment and rebuild
        run: |
          python3 scripts/assign_equipment.py
          python3 extract.py
          python3 .claude/skills/object-research/scripts/research.py
      - name: Commit and push
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add -A
          git diff --cached --quiet && exit 0
          git commit -m "Import new observations"
          git pull --rebase
          git push
```

Notes:

- The `ocr` binary in the repository is built for Apple silicon. The workflow rebuilds it so it matches the runner.
- A push made with the workflow's own `GITHUB_TOKEN` does not start another workflow run, so the import's commit does not trigger itself.
- `ocr_cache/` is reused when a cached result is newer than its screenshot. On a fresh checkout both files have the checkout time, so some screenshots may be read again. The result is the same text; it costs a few seconds per image.
- `extract.py` prints flagged rows. They appear in the workflow log.

## Part 3: Steps that needed a person

In an interactive import, three steps rely on judgment. Without a person, each needs a rule or is left flagged.

### Equipment

The equipment used (naked eye or binoculars) is not in the screenshots. In an interactive import it is given by the observer. `scripts/assign_equipment.py` would apply a fixed rule instead:

- For each row in `observations.csv` with no equipment that is not already in `observations_manual.csv`, look up the object's `v_mag` in `data/index.json`.
- Magnitude 3.5 or brighter: `naked eye`. Fainter: `binoculars`. No magnitude: leave blank.
- Append the row with its equipment to `observations_manual.csv`. This is how equipment is recorded for screenshot rows today, because `extract.py` rewrites `observations.csv` on every run.

The 3.5 cut-off matches the sessions of 10–12 October 2026, where the faintest naked-eye star was ρ Per (3.4) and the brightest binocular star was 48 Per (4.0). A wrong assignment is corrected by editing the row in `observations_manual.csv`.

Magnitude comes from the research step, so the workflow runs `extract.py` and `research.py` a second time after assigning equipment. The second research run finds no new objects and only rebuilds the viewer data.

### Greek letters the glyph matcher does not know

`extract.py` saves the letter to `glyphs/unlabeled/` and flags the row. The row is imported with the wrong letter until a labelled glyph is added (`glyphs/<letter>_<nnn>.png`) and the import runs again. Most letters are already labelled; a new one appears rarely.

### Names that do not resolve

An MO Pro spelling that SIMBAD and Wikipedia do not know, or a name the app cuts short ("Alpha Persei Moving Clus..."), is harvested as unresolved and shows on the site with no data. The fix is an entry in `ALIASES` in `research.py` and a re-harvest with `--refresh --only "<name>"`.

### Option: let Claude handle the last two

The workflow can end with a step that runs Claude Code on the runner, using `anthropics/claude-code-action`, with the prompt to run the `import-mo-observations` skill on the flagged rows: label new glyphs, add aliases, re-run the scripts, and commit. This needs an Anthropic API key stored as the repository secret `ANTHROPIC_API_KEY`, and each run is billed to that key. The action's inputs change between versions; check its README when adding the step.

Without this step, flagged rows wait until the next interactive session. They can be fixed from any device by editing `glyphs/` or `ALIASES` on GitHub and starting the workflow by hand.

## Cost

| Part | Cost |
|---|---|
| Google Apps Script | Free within Google's daily quotas, which 96 runs a day stay well under |
| GitHub Actions on macOS | Free for a public repository |
| Claude step (optional) | Billed per run to the Anthropic API key |

## Maintenance

- The GitHub token expires on the date chosen when it was created. Replace the `GITHUB_TOKEN` script property before then.
- `extract.py`'s pixel positions assume 1080 × 2400 screenshots. Screenshots from another phone or a changed MO Pro layout need those constants adjusted.
- A failed workflow run sends an email from GitHub to the repository owner by default.
