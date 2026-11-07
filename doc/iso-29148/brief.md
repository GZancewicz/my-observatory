# Brief: virtual space trip through the objects of Burnham's Celestial Handbook

Status: crude brief, raw input to an ISO/IEC/IEEE 29148 requirements pipeline (business or mission analysis, stakeholder requirements, system/software requirements). Nothing in this document is a requirement yet. Statements below are the originator's intent, observations of the existing system, and open questions.

Date: 2026-11-07 (revised the same day: object set changed to Burnham's Celestial Handbook; app separated from the existing viewer; observation status deferred)
Originator: Greg Zancewicz

## 1. Summary

The originator wants a new app in which the user travels through 3D space to every object catalogued in *Burnham's Celestial Handbook*. Objects are seen as the user approaches them and as the user moves away from them, and a heads-up display (HUD) shows facts about each one. When the user gets close, a star is drawn as a body with its true colour, size, surface, corona and flares.

The app is separate from the existing My Observatory viewer on GitHub Pages. It is deployed to Render to start, on whatever stack best handles the rendering load and loads quickly. Games and existing space-simulation software have already solved many of the same problems, and their techniques are expected to be borrowed.

Whether the user has observed an object is not part of the first scope. It is added later as an overlay (section 3).

## 2. What the originator wants

### 2.1 The object set: Burnham's Celestial Handbook

- The app contains every object listed in *Burnham's Celestial Handbook: An Observer's Guide to the Universe Beyond the Solar System* (Robert Burnham Jr., three volumes, Dover). The handbook is arranged by constellation and lists double and multiple stars, variable stars, star clusters, nebulae and galaxies, with notes on each.
- The user can travel to each of these objects.
- Each object is identified by its catalogue designations (Bayer, Flamsteed, Messier, NGC, IC and others) and linked to current data from public astronomical services (SIMBAD, Gaia, VizieR, Wikidata, Wikipedia and others), so that positions, distances, magnitudes, spectral types and sizes come from current measurements, not from the 1978 text.
- The handbook's descriptive text is copyrighted and is not reproduced. The app uses the list of objects and current public data about them.
- The Sun is the starting point. Whether the solar system itself (planets, moons) is rendered is an open question, since the handbook does not cover it.

### 2.2 Travel

- The user travels through 3D space with objects at their real positions: direction from their coordinates, distance from parallax or catalogue distance.
- The user can fly freely, jump to a chosen object, or follow a guided tour.
- As the user approaches an object, it grows from a point of light into a resolved body or structure. As the user moves away, it shrinks back and stays in its correct place behind the user, where the user can turn to see it.
- Objects the user passes on the way to a target are seen approaching and receding in the same way.
- Distances run from the nearest stars at a few light-years to galaxies at tens of millions of light-years. Making travel across this range usable is a central design problem.
- Constellations are not physical groupings. From near the Sun the familiar patterns are visible; as the user flies away they break apart.

### 2.3 Close approach

- When the user gets close enough to an object, it is shown as a detailed body rather than a point of light.
- A star is drawn in the right colour for its temperature and spectral class, at its right size relative to other stars, with the surface and atmospheric features a close view of the Sun shows: limb darkening, granulation, sunspots, the corona, prominences and flares.
- These features vary with the type of star. A red giant or supergiant has a different surface, size and corona from a hot blue star or a white dwarf. Where catalogue data exists for the object (variability, rotation, flare activity, companions), the rendering reflects it; where it does not, the rendering follows what is typical for the star's type and is identifiable as such.
- Double and multiple stars, a large part of the handbook, are shown as their separate components when the user is close enough to resolve them, with their orbits where these are known.
- Variable stars change brightness, and where relevant colour and size, according to their known period and type.
- Star clusters, nebulae and galaxies show their structure when approached: individual stars in a cluster, the gas and dust of a nebula, the arms and core of a galaxy.
- The transition from a distant point to the close-up view is continuous as the user approaches.

### 2.4 Heads-up display (HUD)

- A HUD shows facts about whatever the user is looking at or travelling to: name and designations, object type, constellation, distance from Earth and from the user's current position, magnitude, temperature, size, spectral class, and for double stars, separation and position angle.
- The HUD also shows travel state: current position, speed (possibly as a multiple of light speed), and travel time to the target.
- The HUD gives access to fuller information on the object (SIMBAD record, Wikipedia article, research papers).

### 2.5 Further features

The originator selected these on 2026-11-07 from a list of suggestions. Features that depend on the user's own observations are listed in section 3.

- **Light-travel time.** For each object, the app shows how long its light takes to reach Earth and the year the light now arriving left the object, with a marker for what was happening on Earth in that year.
- **Time controls.** The user can run the clock forwards or backwards. Stars move by their proper motion and radial velocity over thousands of years, so constellation patterns change shape.
- **Scale modes.** The user can switch between true scale, a compressed scale and a mode that fits every object in view. A scale bar shows the current scale and changes as the user travels.
- **Guided tours.** Prepared routes through the objects, for example one constellation at a time in the handbook's order, nearest to farthest, hottest to coolest, or all objects of one type.
- **Look back at the Sun.** From any object, the user can turn to find the Sun. The app shows how bright the Sun would appear from there, whether it would be visible to the naked eye, and which constellation it would appear in.
- **Planetary systems.** Known exoplanets are drawn around their host stars, from the NASA Exoplanet Archive.
- **Star life stages.** For each star, the app shows where it is in its life cycle and what it will become (for example red giant, supernova, white dwarf).
- **Background stars.** Stars outside the handbook are shown for context, from a general star catalogue such as Gaia or Hipparcos, so the sky does not look empty between handbook objects.
- **Size comparison.** The user can place two objects side by side in 3D to compare their sizes.
- **Narration.** Spoken or captioned commentary on each object, drawn from public sources such as Wikipedia and SIMBAD.
- **Sound.** Ambient audio during travel, and sonified data where it exists, such as measured stellar oscillation frequencies.

### 2.6 Considered and excluded

The originator considered and excluded these on 2026-11-07:

- **Eyepiece view:** showing the object as it looked through the user's equipment.
- **Club or class mode:** a shared object set that several people add to.
- **VR and phone modes:** viewing in a VR headset, or holding up a phone to look around the sky.

### 2.7 Separate app, deployed to Render

- The app is separate from the existing My Observatory viewer. It has its own code base and its own deployment. The existing viewer on GitHub Pages stays as it is.
- It is deployed to Render to start.
- The stack is chosen for the job: fast to load, smooth while travelling, and able to render the full object set and the close-up effects in section 2.3. The originator does not prescribe it.
- What can carry over from My Observatory is the approach to data: resolving object names against SIMBAD, Wikidata, Wikipedia and VizieR, the object fields already collected, and the estimation of star radius from luminosity or absolute magnitude.

### 2.8 Borrow from games and space-simulation software

The originator expects that games and existing space-simulation programs have solved many of these problems and wants their techniques used where they fit. Techniques noted so far, for the architecture stage to assess:

- **Floating origin** (camera-relative coordinates), so positions spanning millions of light-years keep their precision near the camera.
- **Logarithmic or reversed depth buffers**, so very near and very far objects draw in the right order.
- **Level of detail**: a point sprite far away, a glowing impostor at middle distance, a full shaded body up close, switched smoothly.
- **Spatial partitioning** (for example an octree) and **streaming**, so only the objects near the user are loaded in full detail.
- **GPU instancing**, to draw many thousands of stars in one pass.
- **Procedural shaders** for stellar surfaces, coronae and flares, and **volumetric rendering** for nebulae and galaxies.
- **HDR rendering, bloom and tone mapping**, to handle the brightness range between a star's surface and faint background objects.
- **Travel effects** for faster-than-light movement, and smooth camera transitions when jumping to an object.

Existing programs whose approaches can be studied: Celestia, Gaia Sky and OpenSpace (all open source), SpaceEngine and Universe Sandbox (commercial). The new app is its own design; it does not copy any of these.

Candidate stacks noted so far, for the architecture stage to assess:

- A browser app using WebGL or WebGPU through a 3D library such as Three.js or Babylon.js, served from Render as a static site, with the catalogue precomputed into data files.
- A game engine with web export, such as Godot or Unity, served from Render.
- Either of the above with a small API service on Render for search and object data, if the data is too large to ship to the browser.

### 2.9 Treated as a real development project

- The originator wants this run as a bona fide development project, with requirements produced through the ISO/IEC/IEEE 29148 processes before design and build.

## 3. Later: the user's own observations

Not in the first scope. The originator expects to add it later.

- A user can upload their own observations, and the app marks the objects they have observed.
- The originator's MO Pro screenshot route is one input. Others are expected: other astronomy apps, other observing logs, CSV files, or a plain list of object names.
- Objects the user has observed that are not in the handbook are added to their view.
- Each user has their own observed objects, sites and catalogue numbering.

Features that depend on this, selected by the originator on 2026-11-07:

- **Start from your own sky.** A trip to an observed object opens at the observer's site on the night of the observation, with the horizon, the object's altitude, the sky glow for the logged Bortle class and the logged conditions. The view then lifts off and travels to the object.
- **Discovery log.** Objects light up as the user observes them. The app shows counts by object type, the farthest object observed and the constellations covered.
- **Milestones.** For example every spectral class observed, a new farthest object, all main stars of a constellation.
- **Share a trip.** The user can send a link to a tour of their objects, and two observers' logs can be compared in one view.
- **Plan tonight.** From the user's site and tonight's sky, the app suggests handbook objects not yet observed.
- **Observing history in the HUD.** When, where, rating, conditions and equipment for each of the user's sightings.

## 4. What exists today

My Observatory is a personal project that turns the observing log kept in the **My Observations** screen of Mobile Observatory Pro (MO Pro, an Android astronomy app) into a browsable record. It is the starting point for this brief but is not part of the new app.

1. The observer takes screenshots of the MO Pro observation list, or marks stars on MO Pro Sky View captures.
2. `extract.py` reads the screenshots with macOS Vision OCR and writes `observations.csv`. Hand-entered rows go in `observations_manual.csv`.
3. `research.py` (the `object-research` Claude Code skill) resolves each object against public services (CDS Sesame and SIMBAD, Wikidata, Wikipedia, JPL Horizons, CelesTrak, VizieR), computes altitude and azimuth at each sighting, assigns a permanent catalogue number (GZ-1, GZ-2, …), and writes one folder per object under `data/<category>/<slug>/`.
4. `index.html` is a static page served by GitHub Pages, with an object list, one page per object, an Overview page of linked charts and a Sizes page.

At the date of this brief it holds about 345 observations of about 160 objects, mostly stars, from one observer at one site (Royse City, Texas). Per-object fields include designation, constellation, V magnitude, spectral type, distance, coordinates, proper motion, parallax, radial velocity, temperature, radius (catalogue or estimated) and luminosity class.

## 5. Likely stakeholders

- The originator, as first user, product owner and developer.
- Amateur astronomers who use Burnham's Celestial Handbook or observe the objects in it.
- Casual users interested in exploring space.
- Possibly educators and students.
- Operators of the public data services the app depends on (CDS, ESA Gaia archive, NASA Exoplanet Archive, Wikimedia), whose usage policies and rate limits apply.
- The rights holder of Burnham's Celestial Handbook, regarding use of the object list and the title.
- Render, as the first host, and whoever pays for hosting.

## 6. Constraints and conditions known now

- Public data sources only, used within their terms and rate limits.
- The handbook's text is not reproduced.
- Deployed to Render to start.
- Separate from the existing GitHub Pages viewer.
- VR and phone modes are excluded.
- The originator develops with Claude Code.

## 7. Open questions for the pipeline

1. Is there a machine-readable list of the handbook's objects, or must one be compiled from the volumes? How many objects are there, and how are ambiguous or obsolete designations resolved?
2. Can the handbook's name be used in the app, or only its object list?
3. Is the solar system rendered, or does the trip start from the Sun as a point?
4. How are objects with uncertain or unknown distances placed, particularly nebulae and galaxies?
5. How realistic must the close-up rendering be, and how is the user told which details are measured and which are typical for the type?
6. How many background stars are shown, and from which catalogue?
7. Platform: desktop browser only, or tablet as well? Which browsers and minimum hardware must be supported?
8. Performance targets: load time, frame rate, number of objects on screen.
9. Does the app need a server beyond static hosting, and if so for what?
10. Who is the primary user: the originator, amateur astronomers, or the casual public?
11. Is offline use required?
12. Does the new app live in a new repository?
13. Is there any intent to monetise, or does the project stay free and open source?

## 8. Source material

- `README.md`, `PLAN.md`, `AUTOMATION.md` in the My Observatory repository: the existing pipeline, viewer and proposed automation.
- `.claude/skills/object-research/SKILL.md`: the object data model and the name-resolution and research rules.
- `data/`: the current per-object data, as an example of the fields available.
