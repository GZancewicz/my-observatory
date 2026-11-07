# Brief: virtual space trip through an observer's own observed objects

Status: crude brief, raw input to an ISO/IEC/IEEE 29148 requirements pipeline (business or mission analysis, stakeholder requirements, system/software requirements). Nothing in this document is a requirement yet. Statements below are the originator's intent, observations of the existing system, and open questions.

Date: 2026-11-07
Originator: Greg Zancewicz

## 1. What exists today

My Observatory is a personal project that turns the observing log kept in the **My Observations** screen of Mobile Observatory Pro (MO Pro, an Android astronomy app) into a browsable record.

The current pipeline:

1. The observer takes screenshots of the MO Pro observation list, or marks stars on MO Pro Sky View captures.
2. `extract.py` reads the screenshots with macOS Vision OCR, matches Greek Bayer letters against labelled glyph images, reads the star rating from pixel colours, merges duplicates, and writes `observations.csv`. Hand-entered rows go in `observations_manual.csv` and are merged in.
3. `research.py` (the `object-research` Claude Code skill) assigns each object a category, resolves it against public services (CDS Sesame and SIMBAD, Wikidata, Wikipedia, JPL Horizons, CelesTrak, VizieR, OpenStreetMap Nominatim), computes altitude and azimuth at each sighting, assigns a permanent catalogue number (GZ-1, GZ-2, …), and writes one folder per object under `data/<category>/<slug>/` with `object.json`, `papers.json`, `article.json`, a sky image and a generated `extra.js`.
4. `index.html` is a static page with no build step, served by GitHub Pages. It has an object list with category filters, one page per object (key facts, observations, SIMBAD record, Wikidata claims, Wikipedia article, research papers, an Aladin Lite sky viewer), an Overview page of linked charts (H-R diagram, all-sky map, distance against magnitude, alt/az plot, conditions against rating, sessions timeline, spectral class breakdown), and a Sizes page that lines up stars, planets and satellites on a logarithmic size scale. A `targets.csv` list adds objects not yet observed, drawn as outlines on the Sizes page.

Current data set at the date of this brief: about 345 observations of about 160 objects, mostly stars (153), plus planets, constellations, a satellite and a few deep-sky objects. All observations are from one observer at essentially one site (Royse City, Texas).

Per-object fields already available include: name, designation, GZ number, category, MO Pro type, constellation, V magnitude, spectral type, distance in light-years, ICRS and galactic coordinates, proper motion, parallax, radial velocity, temperature, radius (catalogue or estimated), luminosity class, research paper count, observation history (date, time, site, rating, seeing, transparency, Bortle class, equipment), and for planets and satellites, ephemeris and orbital elements.

Known limits of the current system:

- It is built for one person. Paths, the site, the GZ catalogue, the phone screen resolution (1080 × 2400) and the Google Drive and Gmail import route are specific to the originator.
- Screenshot reading needs macOS (Apple Vision). An automatic import through Apps Script and GitHub Actions is designed in `AUTOMATION.md` but not built.
- Research runs locally through Claude Code or by hand; there is no server.
- The viewer is a set of 2D pages. It does not convey where the objects are relative to each other or to the Sun.

## 2. What the originator wants

The originator describes the current app as "kind of boring" and wants a more engaging experience built on the same data.

### 2.1 Virtual trip through space

- The user can take a virtual trip through 3D space to visit the objects they have observed.
- Objects are placed at their real positions in space (direction from coordinates, distance from parallax or catalogue distance), so the user sees how near or far each one is and how they relate to each other and to the Sun.
- Solar system objects (planets, moons, satellites, comets, minor bodies) are placed by ephemeris, at the time of observation or at a chosen time.
- Constellations, which are not physical groupings, need some treatment: for example, a view from Earth that shows the familiar pattern, which then breaks apart as the user flies away.
- Deep-sky objects (clusters, nebulae, galaxies) are at very large and very different distances from stars, so scale is a central design problem. Distances run from low Earth orbit to millions of light-years.
- The user can fly freely, jump to a chosen object, or follow a tour (for example, a night's session in the order observed, or nearest to farthest).

### 2.2 Close approach

- When the user gets close enough to an object, it is shown as a detailed body rather than a point of light.
- A star is drawn in the right colour for its temperature and spectral class, at its right size relative to other stars, with the surface and atmospheric features a close view of the Sun shows: limb darkening, granulation, sunspots, the corona, prominences and flares.
- These features vary with the type of star. A red giant or supergiant has a different surface, size and corona from a hot blue star or a white dwarf. Where catalogue data exists for the object (variability, rotation, flare activity, companions), the rendering reflects it; where it does not, the rendering follows what is typical for the star's type and is identifiable as such.
- Multiple and binary stars are shown as their separate components when the user is close enough to resolve them.
- Planets and moons show their surfaces, atmospheres, rings and phases. Deep-sky objects (clusters, nebulae, galaxies) show their structure when approached.
- The transition from a distant point to the close-up view is continuous as the user approaches.

### 2.3 Heads-up display (HUD)

- A HUD shows stats about whatever the user is looking at or travelling to: name, type, distance from Earth and from the user's current position, magnitude, temperature, size, spectral class, constellation, and the user's own observing history for that object (when, where, rating, conditions, equipment).
- The HUD also shows travel state: current position, speed (possibly as a multiple of light speed), and travel time to the target.
- The HUD links through to the full object record that the current viewer already shows (SIMBAD, Wikidata, Wikipedia, papers).

### 2.4 Absorb what has been built

- The new app reuses the existing pipeline and data model: extraction, research, the per-object folders, the GZ catalogue, the overview charts and the Sizes page.
- The existing pages may become views inside the new app or stay alongside it. This is undecided.

### 2.5 Anyone can use it with their own objects

- The app is restructured so that anyone can upload their own observations and the app works for them.
- Each user has their own set of observed objects, their own sites, and their own catalogue numbering.
- The originator's MO Pro screenshot route is one input. Other inputs are expected: other astronomy apps, other observing logs, CSV files, or a plain list of object names.
- The research step (name resolution and data collection from public services) runs for any user's objects, not only on the originator's machine.

### 2.6 Treated as a real development project

- The originator wants this run as a bona fide development project, with requirements produced through the ISO/IEC/IEEE 29148 processes before design and build.

## 3. Likely stakeholders

- The originator, as first user, product owner and developer.
- Amateur astronomers who keep an observing log, in apps such as MO Pro or elsewhere.
- Casual stargazers with a short list of objects they have seen.
- Possibly educators and students, family members, or astronomy clubs who would share a set of objects.
- Operators of the public data services the app depends on (CDS, Wikimedia, JPL, CelesTrak, OpenStreetMap), whose usage policies and rate limits apply.
- Makers of the source astronomy apps, whose export formats and terms affect what can be imported.
- Whoever hosts and pays for the app if it becomes multi-user.

## 4. Constraints and conditions known now

- Public data sources only, used within their terms and rate limits.
- The current viewer runs as static files with no build step and works when opened from disk. Whether the new app keeps that property is undecided; 3D rendering and multi-user upload will likely require relaxing it.
- The site is currently hosted on GitHub Pages from a public repository.
- Licence is MIT.
- The originator develops with Claude Code; skills already exist for import, sky-capture logging and object research.
- Existing GZ numbers do not change once assigned.

## 5. Open questions for the pipeline

1. Who is the primary user: the originator, amateur astronomers in general, or the casual public?
2. Platform: web browser only, or also phone, tablet, desktop app, or VR headset?
3. Where does processing run for other users: in their browser, on a server, or on their own machine? Who pays for any server?
4. Accounts and privacy: do users sign in? Are observation logs (which contain locations and times) private, shared, or public?
5. Which input formats are supported first? Does screenshot OCR remain, given its macOS dependency?
6. What happens to objects that cannot be resolved by name?
7. How realistic must the 3D scene be: true scale, compressed scale, or switchable? How are objects with uncertain or unknown distances placed?
8. Does the trip include objects the user has not observed (for context, or as targets), or only their own?
9. Is the experience single-user, or can users share trips and compare logs?
10. What becomes of the current Overview and Sizes pages?
11. Is offline use required?
12. Performance targets: number of objects per user, frame rate, devices that must be supported.
13. Is there any intent to monetise, or does the project stay free and open source?

## 6. Source material in the repository

- `README.md`: the current pipeline and viewer.
- `PLAN.md`: the round 2 development plan for the viewer and charts.
- `AUTOMATION.md`: the proposed automatic import through Gmail, Apps Script and GitHub Actions.
- `.claude/skills/object-research/SKILL.md`: the object data model and research rules.
- `.claude/skills/import-mo-observations/`, `.claude/skills/log-sky-captures/`: the import procedures.
- `observations.csv`, `observations_manual.csv`, `targets.csv`, `data/`: the current data set.
