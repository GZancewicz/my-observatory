// My Observatory glossary: plain-language explanations of every technical term on screen.
// window.MO_GLOSSARY = {
//   terms: { id: { term, short, long } },
//   lookup(text) -> id | null            maps any on-screen label to a term id
//   explainValue(kind, value) -> string | null
//     kinds: spectral_type, otype, luminosity_class, bortle, seeing, transparency, mag, band
// };
// Plain JS, no dependencies, works from file://.
(function () {
  "use strict";
  var ROOT = typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this);

  var TERMS = {};        // id -> { term, short, long }
  var ALIAS = {};        // normalised label -> id (case-insensitive)
  var CODES = {};        // exact-case labels: SIMBAD object-type codes and single letters -> id
  var COLLISIONS = [];   // debugging aid: alias claimed by two ids

  // ------------------------------------------------------------------ normalisation
  function key(s) {
    return String(s == null ? "" : s)
      .replace(/[​-‏⁠﻿]/g, "")
      .replace(/[−‐-―]/g, "-")
      .replace(/[‘’ʼ]/g, "'")
      .toLowerCase()
      .replace(/colour/g, "color").replace(/catalogue/g, "catalog").replace(/centre/g, "center")
      .replace(/_/g, " ")
      .replace(/\.(?!\d)/g, "")          // abbreviation dots ("R.A.", "Vis. mag.") but not decimals
      .replace(/\s*-\s*/g, "-")
      .replace(/\s+/g, " ")
      .replace(/^[\s:=,;]+|[\s:=,;]+$/g, "")
      .trim();
  }

  function addAlias(name, id, strict) {
    var k = key(name);
    if (!k) return;
    if (ALIAS[k] && ALIAS[k] !== id) {
      if (strict) COLLISIONS.push(k + " : " + ALIAS[k] + " vs " + id);
      return;
    }
    ALIAS[k] = id;
  }

  // T(id, display name, aliases, short, long)
  function T(id, term, aliases, short, long) {
    if (TERMS[id]) COLLISIONS.push("duplicate id " + id);
    TERMS[id] = { term: term, short: short, long: long || "" };
    addAlias(term, id, false);
    (aliases || []).forEach(function (a) { addAlias(a, id, true); });
  }

  // ================================================================== TERMS
  // ---------------------------------------------------------------- brightness
  T("apparent_magnitude", "Apparent magnitude",
    ["apparent magnitude", "apparent mag", "apparent mag v", "apparent magnitude v", "v mag", "vmag", "v_mag",
      "visual magnitude", "magnitude", "mag", "ephemeris mag", "brightest first"],
    "How bright the object looks from Earth. Smaller numbers are brighter; the brightest objects have negative values.",
    "The scale runs backwards and is logarithmic: each step of 1 magnitude is about 2.5 times in brightness, and 5 steps is exactly 100 times. " +
    "Sirius, the brightest star, is −1.46; Polaris is about 2.0; the faintest stars visible without optical aid are about 6 from a dark site and about 5 from a suburb. " +
    "It says nothing about how powerful the object really is: a nearby dim star can look brighter than a distant luminous one. Unless stated otherwise it is measured through the V (visual, green-yellow) filter.");

  T("absolute_magnitude", "Absolute magnitude",
    ["absolute magnitude", "absolute mag", "abs mag", "abs_mag"],
    "How bright a star really is: the apparent magnitude it would have if it were placed at a standard distance of 10 parsecs (32.6 light-years).",
    "As with apparent magnitude, smaller and negative numbers mean brighter, and each step is about 2.5 times. The Sun is +4.8, Sirius +1.4, and the supergiant Rigel about −7.8. " +
    "Taking distance out of the picture lets you compare stars fairly. It is worked out from the apparent magnitude and the distance (usually from parallax).");

  T("abs_mag_line", "Line of equal absolute magnitude", [],
    "A guide line on the distance chart: every point on it has the same absolute magnitude M, so stars on one line are equally luminous.",
    "A star of a given true brightness looks fainter the farther away it is, so the lines slope down to the right. 'M −10' marks an extremely luminous supergiant; 'M +4' is about as luminous as the Sun. A star above a line is more luminous than that line's value.");

  T("planet_abs_mag", "V(1,0): planet's absolute magnitude",
    ["vis magnitude v(1,0)", "visual mag v(1,0)", "vis mag v(1,0)", "v(1,0)", "visual magnitude v(1,0)"],
    "The brightness a planet would have if it were 1 AU from both the Sun and the observer and seen fully lit. A standard measure of its size and reflectivity.",
    "This is not the same as a star's absolute magnitude, which uses a distance of 10 parsecs. Smaller numbers are brighter: Jupiter's V(1,0) is −9.4 and Mars's about −1.5. The brightness you actually see depends on the planet's real distances and phase; see 'APmag'.");

  T("mag_opposition", "Vis. mag. (opposition)",
    ["vis mag (opposition)", "vis mag opposition", "magnitude at opposition", "opposition magnitude"],
    "The planet's typical apparent magnitude at opposition, when Earth passes between it and the Sun: it is then closest, fully lit and usually brightest.",
    "Jupiter reaches about −2.7 at opposition and Saturn about +0.7 (Saturn's brightness also depends on how far its rings are tilted toward us).");

  T("apmag", "APmag (apparent magnitude at that time)", ["apmag", "ap mag"],
    "The apparent magnitude JPL Horizons calculated for that moment, from the planet's distance from the Sun and Earth and its phase.",
    "Smaller numbers are brighter. Mars, for example, changes from about +1.8 to −2.9 depending on how close it is to Earth.");

  T("color_index", "B−V colour index",
    ["b-v", "b-v color index", "color index", "b minus v", "b_minus_v", "bv", "b-v index"],
    "A star's colour as a number: its blue (B) magnitude minus its visual (V) magnitude. Low or negative means blue-white and hot; high means orange-red and cool.",
    "Rigel is about −0.03, Sirius 0.0, the Sun +0.65, orange giants around +1.2 and the red supergiant Betelgeuse about +1.85. Because magnitudes run backwards, a star that is relatively bright in blue light gets a smaller B and so a smaller B−V. It is a quick stand-in for surface temperature.");

  T("photometry", "Photometry", ["photometry", "fluxes", "flux", "flux filters"],
    "Measurements of the object's brightness through different coloured filters (bands), each given as a magnitude.",
    "Comparing the bands shows colour and temperature: a cool red star is much brighter in the infrared bands (J, H, K) than in blue (B). 'mag' is the magnitude in that band and 'err' its uncertainty. Hover a band letter for its wavelength.");

  T("photometric_band", "Band (photometric filter)",
    ["band", "filter", "photometric band", "passband", "magtyp", "magnitude type"],
    "A standard colour filter used to measure brightness, named by a letter: U, B, V, R, I in visible light, J, H, K in the infrared, G for the Gaia satellite.",
    "Each band lets through a set range of wavelengths. V (visual, about 550 nm, green-yellow) matches the eye best and is the usual 'magnitude'. In a variability table 'magtyp' names the band the brightest and faintest magnitudes were measured in.");

  T("uncertainty", "Error (uncertainty)",
    ["err", "error", "errors", "plus err", "minus err", "plx err", "pmra err", "pmde err", "pmdec err", "vsini err",
      "rvz err", "vlsr err", "mean error", "meanerror", "uncertainty", "±", "+/-", "1-sigma", "sigma"],
    "How far the true value might reasonably be from the stated value. 10 ± 0.5 means the value is probably between 9.5 and 10.5.",
    "Usually a '1-sigma' error: there is about a 68% chance that the true value lies within the range. 'plus err' and 'minus err' give the upper and lower sides when they differ. A smaller error means a more precise measurement.");

  T("error_ellipse", "Position error ellipse",
    ["coo err maj", "coo err min", "coo err angle", "err maj mas", "err min mas", "err angle deg", "pm err maj", "pm err min",
      "pm err angle", "position uncertainty", "mesuncertainty", "error ellipse"],
    "The uncertainty of a sky position or motion, described as an ellipse: its long axis (maj), short axis (min) and tilt (angle).",
    "Sizes are in milliarcseconds (mas) for positions, or mas per year for proper motion; the angle is measured from north through east. Gaia positions of bright stars are good to a small fraction of a mas.");

  T("naked_eye", "Naked eye ≤ 6", ["naked eye", "naked eye ≤ 6", "naked eye <= 6", "naked-eye", "naked eye limit"],
    "Shows only objects of magnitude 6 or brighter: roughly what a person can see without binoculars from a dark site.",
    "From a bright suburban sky (Bortle 6) the practical limit is closer to magnitude 5–5.5, so some objects that pass this filter will still be hard to see by eye.");

  T("mag_limit", "Magnitude limit", ["magnitude limit", "limiting magnitude", "mag limit"],
    "Filter: show only objects at least this bright, i.e. with an apparent magnitude at or below the chosen number.",
    "Because the scale runs backwards, moving the limit to a higher number lets fainter objects in. 6 is about the naked-eye limit under dark skies; binoculars reach about 9 and a small telescope 11–13.");

  T("surface_brightness", "S-brt (surface brightness)", ["s-brt", "surface brightness", "sbrt"],
    "Brightness per patch of sky, in magnitudes per square arcsecond: how bright each part of the planet's disc looks, rather than the planet as a whole.",
    "Smaller numbers are brighter. It matters for objects with a visible size: two planets of equal total brightness look different in a telescope if one is spread over a larger disc.");

  T("illumination", "Illu% (illuminated fraction)",
    ["illu%", "illu", "illuminated pct", "illuminated percent", "illuminated fraction", "% lit", "lit", "illumination", "percent illuminated"],
    "The percentage of the planet's visible disc that is lit by the Sun, as seen from Earth. 100% is fully lit, like a full Moon.",
    "Jupiter and Saturn always appear nearly 100% lit from Earth. Mars can drop to about 85%. Venus and Mercury show the full range of phases, like the Moon.");

  T("angular_diameter", "Angular diameter",
    ["angular diameter", "ang-diam", "angdiam", "angular diameter arcsec", "angular_diameter_arcsec", "max angular diam",
      "maximum angular diameter", "angular size", "apparent diameter"],
    "How large the object looks across, as an angle on the sky, usually in arcseconds (″). One arcsecond is 1/3600 of a degree.",
    "The full Moon is about 1,800″ (half a degree) across. Jupiter ranges from about 30″ to 50″, Saturn's globe from 15″ to 21″, Mars from 4″ to 25″. Other stars are far too small to show a disc (a few thousandths of an arcsecond at most). 'Max. angular diam.' is the largest the planet gets, at its closest approach.");

  T("albedo", "Albedo", ["albedo", "geometric albedo"],
    "How much sunlight a surface reflects, from 0 (perfectly black) to 1 (reflects everything). Geometric albedo is measured with the body fully lit.",
    "Jupiter's geometric albedo is about 0.52 and Saturn's 0.47, thanks to bright clouds; dusty Mars is about 0.15–0.17 and the Moon about 0.12. Geometric albedo can exceed 1 for very bright surfaces that reflect light straight back.");

  T("solar_constant", "Solar constant (W/m²)", ["solar constant", "solar constant (w/m^2)", "solar irradiance"],
    "The power of sunlight arriving at the planet's distance, in watts per square metre, at perihelion, at aphelion and on average.",
    "At Earth it is about 1,361 W/m². Jupiter, five times farther from the Sun, receives about 51 W/m² (about 1/27 as much), because sunlight weakens with the square of distance.");

  T("planetary_ir", "Planetary IR (maximum / minimum)",
    ["maximum planetary ir", "minimum planetary ir", "planetary ir", "max planetary ir", "min planetary ir",
      "maximum planetary ir (w/m^2)", "minimum planetary ir (w/m^2)"],
    "The infrared (heat) power the planet radiates per square metre, in W/m²: the highest and lowest values, for example on its day and night sides.",
    "For the giant planets the two are equal because heat spreads around them; Jupiter and Saturn also radiate more heat than they absorb from the Sun, left over from their formation. On Mars the day side gives off far more heat than the night side.");

  T("perihelion", "Perihelion / periapsis", ["perihelion", "periapsis", "pericenter", "periapsis distance", "pericentre"],
    "The point of an orbit closest to the body being orbited (called perihelion for orbits around the Sun), or the distance at that point.",
    "In the Horizons table the Perihelion column gives values when the planet is closest to the Sun. Mars is about 207 million km from the Sun at perihelion and 249 million km at aphelion.");

  T("aphelion", "Aphelion / apoapsis", ["aphelion", "apoapsis", "apocenter", "apocentre"],
    "The point of an orbit farthest from the body being orbited (called aphelion for orbits around the Sun), or the distance at that point.",
    "In the Horizons table the Aphelion column gives values when the planet is farthest from the Sun, where it receives the least sunlight.");

  T("orbit_mean", "Mean (orbit average)", ["mean", "orbit average"],
    "In the Horizons table: the average value over a whole orbit, between the perihelion and aphelion values.");

  // ---------------------------------------------------------------- distance and angle units
  T("distance", "Distance",
    ["distance", "distance from earth", "dist", "nearest first", "mesdistance", "distance ly", "distance pc", "distance au", "distance_ly", "distance_pc"],
    "How far away the object is: in light-years (ly) and parsecs (pc) for stars, in km or AU for planets.",
    "A light-year is the distance light travels in a year (about 9.46 trillion km), so a distance in light-years is also how long ago the light you see set off: Sirius is 8.6 ly away, so you see it as it was 8.6 years ago. " +
    "Star distances are usually worked out from parallax (1 parsec = 3.26 ly). Beyond a few thousand light-years they become much less certain.");

  T("distance_axis", "Distance (light-years, log scale)", ["distance (light-years, log scale)", "log scale", "logarithmic scale"],
    "Distance on a log scale: each equal step multiplies the distance (10, 100, 1,000 ly), so near and very far objects fit on one chart.");

  T("light_year", "Light-year (ly)", ["ly", "light-year", "light-years", "light year", "light years", "lightyear"],
    "The distance light travels in one year: about 9.46 trillion km (5.9 trillion miles).",
    "The nearest star beyond the Sun, Proxima Centauri, is 4.2 ly away. A distance in light-years also tells you the age of the light: a star 500 ly away is seen as it was 500 years ago.");

  T("parsec", "Parsec (pc)", ["pc", "parsec", "parsecs", "kpc", "kiloparsec", "kiloparsecs", "mpc", "megaparsec"],
    "An astronomer's distance unit equal to 3.26 light-years (about 31 trillion km). A kiloparsec (kpc) is 1,000 parsecs.",
    "It is defined by parallax: a star 1 parsec away shifts by 1 arcsecond as Earth moves around the Sun. So distance in parsecs = 1000 ÷ parallax in milliarcseconds.");

  T("au", "Astronomical unit (AU)", ["au", "astronomical unit", "astronomical units", "ua"],
    "The average distance between Earth and the Sun, about 149.6 million km (93 million miles), used for distances within the Solar System.",
    "Jupiter orbits at about 5.2 AU and Saturn at 9.5 AU. Light takes about 8.3 minutes to cross 1 AU.");

  T("gigametre", "Gigametre (Gm)", ["gigametre", "gigameter", "gm (unit)"],
    "One million kilometres. Jupiter orbits the Sun at about 778 Gm.");

  T("parallax", "Parallax", ["parallax", "plx", "plx value", "plx_value", "mesplx", "trigonometric parallax"],
    "The tiny yearly shift in a star's position as Earth orbits the Sun, in milliarcseconds (mas). A bigger parallax means a closer star.",
    "Distance in parsecs = 1000 ÷ parallax in mas; in light-years, 3262 ÷ parallax in mas. A parallax of 100 mas means 10 pc (32.6 ly); 5 mas means 200 pc (650 ly). " +
    "The Gaia satellite measures parallaxes to about 0.02–0.1 mas, but a small parallax with a large error gives an uncertain distance.");

  T("mas", "Milliarcsecond (mas)", ["mas", "milliarcsecond", "milliarcseconds", "milli-arcsecond"],
    "One thousandth of an arcsecond: an extremely small angle, about the width of a coin seen from 5,000 km away.",
    "Parallaxes and proper motions of stars are usually given in mas. 1 mas = 1/3,600,000 of a degree.");

  T("mas_per_yr", "mas/yr", ["mas/yr", "mas/year", "mas yr-1", "mas a-1"],
    "Milliarcseconds per year: the unit of proper motion, i.e. how fast a star drifts across the sky.",
    "Most bright stars move less than 100 mas/yr, which would take tens of thousands of years to cover the width of the full Moon. Barnard's Star, the fastest, moves about 10,400 mas/yr.");

  T("arcsec", "Arcsecond (″)", ["arcsec", "arcsecond", "arcseconds", "″", "\"", "seconds of arc", "asec"],
    "A small angle: 1/3600 of a degree, or 1/60 of an arcminute. The full Moon is about 1,800″ across.",
    "Planet sizes in a telescope are given in arcseconds (Jupiter is about 40″). Turbulence in the air (seeing) typically blurs stars to 1–3″.");

  T("arcmin", "Arcminute (′)", ["arcmin", "arcminute", "arcminutes", "′", "minutes of arc", "amin"],
    "1/60 of a degree. The full Moon is about 31′ across.");

  T("degree", "Degree (°)", ["°", "deg", "degree", "degrees"],
    "The unit of angle; a full circle is 360°. On the sky your fist at arm's length covers about 10°, a fingertip about 1°.");

  T("square_degree", "Square degree (deg²)", ["deg²", "deg2", "deg^2", "sq deg", "square degree", "square degrees"],
    "A unit of sky area: a patch 1° by 1°. The whole sky is about 41,253 deg²; the full Moon covers about 0.2 deg².",
    "Constellations range from 68 deg² (Crux, the Southern Cross) to 1,303 deg² (Hydra); Orion covers 594 deg².");

  T("area", "Area", ["area"],
    "For a constellation: how much of the sky it covers, in square degrees (deg²). For a planet: its surface area in km².",
    "The whole sky is 41,253 deg². Earth's surface is about 510 million km²; Jupiter's is about 120 times larger.");

  T("km", "Kilometre (km)", ["km", "kilometre", "kilometer", "km²", "km2", "km^2", "square kilometre", "kilometres"],
    "1,000 metres, about 0.62 miles. km² means square kilometres (an area).");

  T("kg", "Kilogram (kg)", ["kg", "kilogram", "kilograms"],
    "The unit of mass (2.2 lb). Planet masses are huge: Jupiter's is 1.9 × 10^27 kg, often shown as 1.9e+27.",
    "'e+27' and '× 10^27' both mean 'multiplied by 1 followed by 27 zeros', so 1.9e+27 is 19 followed by 26 zeros.");

  T("metre", "Metre (m)", ["metre", "meter", "metres", "meters"],
    "The basic unit of length, about 3.3 feet.");

  T("unit", "Unit", ["unit", "units"],
    "The unit the neighbouring value is given in, for example pc or kpc (parsecs, kiloparsecs), km, or mas (milliarcseconds).");

  T("url", "URL (web address)", ["url", "link"],
    "The web address of the original record in the online database.");

  T("measurement_lists", "Measurement lists", ["vsini measurements", "atmosphere measurements", "distance measurements"],
    "Lists of individual published measurements (rotation speed, temperature and gravity, distance), one entry per study.");

  T("obscode", "obscode (observation code)", ["obscode", "observation code"],
    "A code for the observation or instrument behind the value, when the source catalogue provides one.");

  T("complid", "complid (component)", ["complid", "component", "component id"],
    "Which component of a double or multiple star the measurement refers to, for example A or B.");

  T("mssnote", "mssnote (catalogue note)", ["mssnote", "mss note"],
    "A note code from the source spectral catalogue attached to this classification.");

  // ---------------------------------------------------------------- sky positions
  T("right_ascension", "Right ascension (RA)",
    ["right ascension", "ra", "ra (icrs, j2000)", "ra (icrf)", "ra icrf", "ra icrs", "ra deg", "ra hms", "ra_deg", "ra_hms", "alpha", "α", "r a"],
    "The sky's equivalent of longitude: how far east an object lies along the celestial equator, measured in hours (0h–24h) from a fixed starting point.",
    "1 hour of RA equals 15°. The starting point (0h) is where the Sun crosses the celestial equator in March. With declination it fixes a position on the sky that does not depend on the time of night or your location. Written like 5h 35m 17s, or in degrees from 0 to 360°.");

  T("declination", "Declination (Dec)",
    ["declination", "dec", "dec (icrs, j2000)", "dec (icrf)", "dec icrf", "dec icrs", "dec deg", "dec dms", "dec_deg", "dec_dms", "δ"],
    "The sky's equivalent of latitude: how far north (+) or south (−) of the celestial equator an object is, from +90° (above Earth's North Pole) to −90°.",
    "From Royse City, Texas (latitude 33° N), objects north of declination +57° never set and objects south of −57° never rise. Written like +07° 24′ 25″ (degrees, arcminutes, arcseconds).");

  T("delta", "delta (distance from observer)", ["delta"],
    "In the JPL Horizons table: the distance from you (Earth) to the object at that moment, in AU (1 AU ≈ 149.6 million km).",
    "Jupiter's delta ranges from about 4 to 6.4 AU. In Herschel observation tables 'delta' (δ) means something else: the declination of the telescope pointing, with 'alpha' (α) its right ascension.");

  T("deldot", "deldot (range rate)", ["deldot", "range rate", "delta-dot"],
    "How fast the distance between you and the object is changing, in km/s. Negative means it is getting closer; positive means it is moving away.",
    "For planets this mostly reflects Earth's own motion around the Sun: a planet approaching opposition shows negative values.");

  T("reference_frame", "ICRS / ICRF (reference frame)",
    ["icrs", "icrf", "frame", "coosystem", "coordinate system", "fk4", "fk5", "j2000", "icrs, j2000", "reference frame"],
    "The standard grid used to state sky positions, anchored to distant quasars. ICRS is the system; ICRF is its practical realisation.",
    "J2000 means the positions refer to the orientation of Earth's axis at noon on 1 January 2000. FK4 and FK5 are older frames; FK4 positions are usually given for 1950, so they differ from J2000 positions by up to about 0.7° because Earth's axis slowly wobbles (precession).");

  T("epoch", "Epoch", ["epoch", "r epoch epoch"],
    "The date a set of values applies to. Star positions are usually for epoch J2000 (1 January 2000); satellite elements are valid at the EPOCH time.",
    "Stars move slowly and Earth's axis wobbles, so positions need a date. Satellite elements go out of date quickly: after a few days predictions can be off by kilometres. In a variable-star table the epoch is the time of a reference maximum or minimum, as a Julian Date (a continuous day count).");

  T("galactic_longitude", "Galactic longitude (l)",
    ["galactic longitude l", "galactic longitude", "gal l", "gal_l", "glon", "galactic l"],
    "Position measured around the plane of our Milky Way galaxy, from 0° (toward the galaxy's centre, in Sagittarius) to 360°.",
    "Galactic coordinates show where an object sits relative to the Milky Way rather than to Earth. l = 180° points directly away from the centre, toward Auriga and Taurus.");

  T("galactic_latitude", "Galactic latitude (b)",
    ["galactic latitude b", "galactic latitude", "gal b", "gal_b", "glat", "galactic b"],
    "Angle above (+) or below (−) the plane of the Milky Way. Near 0° the object lies in the band of the Milky Way; ±90° looks straight out of the galaxy.");

  T("coordinates", "Coordinates", ["coordinates", "position", "mespos", "sky position"],
    "Where the object is on the sky, given as right ascension (east–west) and declination (north–south).");

  T("quality_grade", "Quality grade (A–E)",
    ["qual", "quality", "coo qual", "pm qual", "plx qual", "rvz qual", "sp qual", "morph qual", "galdim qual", "quality code"],
    "SIMBAD's rating of how reliable a value is, from A (best, most precise) to E (poor). Blank means not graded.",
    "For positions, A usually means a modern space-based measurement such as Gaia. Treat D and E values with caution.");

  T("wavelength_domain", "Wavelength (domain)",
    ["wavelength", "coo wavelength", "rvz wavelength", "vlsr wavelength", "galdim wavelength", "wdomain", "wavelength domain"],
    "The kind of light used for a measurement: O or Opt = visible, I/IR/NIR = infrared, R or Rad = radio, U or UV = ultraviolet, X = X-ray.");

  T("altitude", "Altitude",
    ["altitude", "alt", "altitude deg", "altitude_deg", "elev (a-app)", "elev", "elevation", "elev a-app"],
    "How high the object was above your horizon, in degrees: 0° on the horizon, 90° straight overhead (the zenith).",
    "Objects below about 20–30° are seen through much more air, so they look dimmer, redder and blurrier. In Horizons '(a-app)' means 'airless apparent': corrected for light travel time but not for the atmosphere's bending of light, which lifts objects near the horizon by up to about half a degree.");

  T("altitude_direction", "Altitude / direction", ["altitude / direction", "altitude/direction", "altitude and direction"],
    "Where the object was in your sky when you observed it: its height above the horizon (altitude) and its compass bearing (azimuth), e.g. 23° ESE 107°.",
    "Computed from the object's position, your location and the time of the observation.");

  T("azimuth", "Azimuth",
    ["azimuth", "az", "azi", "azi (a-app)", "azi a-app", "azimuth deg", "azimuth_deg", "direction", "bearing", "compass direction"],
    "The compass direction of the object, in degrees from north through east: 0° north, 90° east, 180° south, 270° west.",
    "With altitude it tells you exactly where to look. Letters such as ESE are the matching compass points (east-south-east is 112.5°).");

  T("zenith", "Zenith", ["zenith"],
    "The point directly overhead, at altitude 90°. On the 'Where they were in my sky' chart it is the centre.");

  T("horizon", "Horizon", ["horizon"],
    "Where the sky meets the ground, at altitude 0°. On the polar chart it is the outer ring; objects below it cannot be seen.");

  T("polar_chart", "Where they were in my sky", ["where they were in my sky", "altitude-azimuth plot", "alt-az plot", "polar plot"],
    "A map of your sky: the centre is straight overhead, the rim is the horizon, north is at the top and east on the right. Each dot is one observation.",
    "Dots are placed by altitude and azimuth at the moment of observation. The chart is drawn as seen from above, like a map, so east is on the right; when you lie back and look up with north at the top, east is on your left.");

  T("at_that_moment", "At that moment", ["at that moment"],
    "Values JPL Horizons calculated for the time of your observation: magnitude, apparent size (″), percent lit and distance from you (AU).");

  T("local_time", "Local time", ["local time", "datetime", "date time", "observation time"],
    "The date and clock time of the observation in the time zone of the observing site (US Central Time for Royse City).");

  T("utc", "UTC (Universal Time)",
    ["utc", "ut", "universal time", "date (ut) hr:mn:sc.fff", "date (ut) hr:mn:scfff", "date (ut)", "date ut hr:mn:scfff"],
    "Coordinated Universal Time: the single world clock used in astronomy. Texas is 5 hours behind UTC in summer (CDT) and 6 hours in winter (CST).",
    "In the Horizons table, 'Date (UT) HR:MN:SC.fff' is the date and time in Universal Time to a thousandth of a second.");

  T("location", "Location", ["location", "location assumed", "location_assumed", "site", "observing site"],
    "Where the observation was made; an asterisk (*) means the place was not visible in the app screenshot and was assumed. On Wikidata: where the object is.");

  T("incomplete", "Partial (incomplete log)", ["partial", "incomplete", "incomplete log"],
    "The log card for this observation was cut off in the screenshot, so some of its values may be missing.");

  T("constellation", "Constellation", ["constellation", "constellations", "iau constellation"],
    "One of the 88 official areas of the sky, named after the traditional star pattern inside it (Orion, Ursa Major…). Every point belongs to exactly one.",
    "The boundaries were fixed by the International Astronomical Union (IAU) in 1930. Stars in one constellation are usually at very different distances and unrelated; they only look close together from Earth. Familiar patterns such as the Big Dipper are 'asterisms', parts of a constellation.");

  T("abbreviation", "Abbreviation", ["abbreviation", "short name", "abbr", "iau abbreviation"],
    "The official three-letter IAU abbreviation of the constellation, e.g. Ori for Orion and UMa for Ursa Major.",
    "Star names such as '20 Cet' or 'α Ori' use it: 20 Cet is star number 20 in Cetus, α Ori the star labelled alpha in Orion.");

  T("iau_boundaries", "IAU boundaries", ["iau boundaries", "iau boundary", "constellation boundaries", "boundaries", "boundary"],
    "The official dividing lines between constellations, set by the International Astronomical Union in 1930 along lines of RA and declination.");

  T("shares_border_with", "Shares border with", ["shares border with", "neighbouring constellations", "neighboring constellations"],
    "Constellations that touch this one along the official IAU boundary lines.");

  T("celestial_equator", "Celestial equator", ["equator", "celestial equator"],
    "Earth's equator projected onto the sky (declination 0°). It divides the sky into northern and southern halves.",
    "From Royse City it arcs from due east, through the south at about 57° altitude, to due west.");

  T("ecliptic", "Ecliptic", ["ecliptic"],
    "The path the Sun appears to follow across the sky over a year. The planets and the Moon always stay close to it, because the Solar System is nearly flat.",
    "It is tilted 23.4° to the celestial equator, the same as the tilt of Earth's axis. The zodiac constellations lie along it.");

  T("all_sky_map", "All-sky map", ["all-sky map", "all sky map", "sky map"],
    "The whole sky flattened onto one oval: right ascension across (increasing to the left, as on a star chart), declination up and down.",
    "Each mark is an object you observed. Dot size shows apparent brightness (bigger = brighter) and colour shows temperature (blue = hot, red = cool). Faint lines are constellation boundaries; diamonds are planets and crosses are constellations. Labels such as 0h and 12h are right ascension hours; +30° and −30° are declinations.");

  T("hammer_projection", "Hammer projection", ["hammer projection", "hammer", "hammer-aitoff projection"],
    "A way to draw the whole sphere of the sky as a flat oval while keeping areas true (equal-area), so regions are not inflated as on a rectangular map.",
    "Shapes are distorted near the left and right edges. This map is centred on right ascension 6h, the winter sky around Orion.");

  T("hr_diagram", "Hertzsprung–Russell diagram",
    ["hertzsprung-russell diagram", "h-r diagram", "hr diagram", "hertzsprung russell diagram", "hrd", "color-magnitude diagram"],
    "The key chart of stellar astronomy: stars plotted by colour (temperature) across and true brightness up. Their position shows their life stage.",
    "Most stars, including the Sun, lie on the diagonal 'main sequence' (hot and bright at top left, cool and dim at bottom right) while they burn hydrogen in their cores. Giants and supergiants sit above it to the right (cool but very luminous because they are huge); white dwarfs sit below to the left. Named after Ejnar Hertzsprung and Henry Norris Russell, around 1910.");

  T("main_sequence", "Main sequence", ["main sequence", "main-sequence", "dwarf star", "main sequence star"],
    "The band on the H-R diagram where stars spend about 90% of their lives, steadily fusing hydrogen into helium in their cores. The Sun is a main-sequence star.",
    "A star's place along it depends mainly on its mass: heavy stars are hot, blue and bright (top left) and live only millions of years; light stars are cool, red and dim (bottom right) and last far longer than the Sun. Luminosity class V means main sequence.");

  T("dist_mag_chart", "Distance and apparent magnitude", ["distance and apparent magnitude", "distance against apparent magnitude"],
    "Objects plotted by distance (across, log scale) against how bright they look (up). Diagonal lines join points of equal true brightness (M).",
    "Two stars that look equally bright but sit far apart horizontally differ greatly in real power: the distant one must be much more luminous.");

  T("conditions_chart", "Conditions and rating", ["conditions and rating", "conditions"],
    "How your rating of each observation (1–5) relates to the object's altitude and to the seeing and transparency reported that night.",
    "Each dot is one observation, nudged slightly sideways so overlapping dots stay visible. Short horizontal ticks mark the average rating at each seeing or transparency level.");

  T("sessions", "Sessions (nights)", ["sessions", "session", "nights", "night", "observing night", "observations per night"],
    "Your observing nights. Each bar counts that night's observations; a night runs noon to noon, so after-midnight observations count with the evening before.",
    "Click a bar to show only that night in every chart.");

  T("new_object", "New object", ["new object", "new objects", "first observation"],
    "An observation of an object for the first time: its earliest logged observation.");

  T("repeat", "Repeat", ["repeat", "repeats", "repeat observation"],
    "An observation of an object you had already logged on an earlier occasion.");

  T("highlighted", "Highlighted", ["highlighted", "clear highlight", "highlight", "objects highlighted"],
    "Objects picked by dragging a box on any chart. They are emphasised in every chart and in the table; press Esc or 'Clear highlight' to undo.");

  T("temperature_scale", "Temperature colour scale", ["temperature color scale", "temperature scale", "color scale"],
    "Colour key for star temperature: blue-white for hot stars (about 30,000 K), through white and yellow, to orange-red for cool stars (about 3,000 K).",
    "These are the colours stars really tend to have, although to the eye most stars look white apart from the coolest and hottest.");

  T("category", "Category", ["category", "object category"],
    "The kind of object: star, planet, constellation, satellite and so on.");

  T("rating", "Rating", ["rating", "best rating", "best", "best rated", "min rating", "minimum rating", "observation rating"],
    "Your own score for the observation, from 1 to 5 stars, taken from your observing log. 'Best' is the highest rating any observation of the object received.");

  T("seeing", "Seeing", ["seeing", "astronomical seeing"],
    "How steady the air was, on MO Pro's 1–5 scale (5 = best). Poor seeing makes stars twinkle strongly and blurs planets in a telescope.",
    "Seeing is caused by turbulence in the atmosphere. It matters most for planets, the Moon and close double stars, where fine detail is needed, and little for faint, diffuse objects. It is not the same as transparency: a sky can be crystal clear but turbulent.");

  T("transparency", "Transparency", ["transparency", "transp", "sky transparency"],
    "How clear the air was, on MO Pro's 1–5 scale (5 = best): free of haze, humidity, smoke or thin cloud. High transparency lets faint stars show.",
    "Transparency matters most for faint galaxies, nebulae and the Milky Way. A hazy but steady night (low transparency, good seeing) can still be fine for planets.");

  T("bortle", "Bortle scale", ["bortle", "bortle scale", "bortle class", "bortle dark-sky scale"],
    "A 1–9 rating of how dark the night sky is at a site: 1 is a pristine dark site, 9 an inner-city sky. 6 is a bright suburban sky.",
    "At Bortle 6 the Milky Way is faint or invisible, the sky glows grey-white near the horizon and the faintest stars visible by eye are about magnitude 5–5.5. The scale was published by John Bortle in 2001.");

  T("observations", "Observations", ["observations", "observation", "my observations", "obs", "most observed", "times seen", "seen", "observation count"],
    "The number of times you logged this object in your observing records.");

  T("overview", "Overview", ["overview"],
    "Charts that summarise all your logged objects and observations, with filters that apply to every chart at once.");

  T("sky_viewer", "Sky viewer", ["sky viewer", "aladin", "aladin lite", "dss2", "dss", "dss2 color survey", "digitized sky survey"],
    "An interactive photo of the real sky around the object from the Digitized Sky Survey (DSS2), shown with the Aladin Lite viewer.",
    "DSS2 is a set of photographs covering the whole sky. Drag to pan and scroll to zoom. Very bright stars appear as large white blobs because the original photographic plates were exposed for faint stars. Aladin is made by the CDS (Strasbourg astronomical Data Centre).");

  T("field_of_view", "Field of view", ["field of view", "field", "fov", "° field", "fov deg"],
    "How wide an area of sky an image shows, in degrees. The full Moon is about 0.5° across.");

  // ---------------------------------------------------------------- motion
  T("proper_motion", "Proper motion", ["proper motion", "mespm", "pm"],
    "How fast a star drifts across the sky because of its real motion through space, in milliarcseconds per year (mas/yr).",
    "The drift is tiny: at 100 mas/yr a star needs about 18,000 years to move the width of the full Moon. Nearby stars tend to have larger proper motions. It is given in two parts: along right ascension (pm RA, east–west) and along declination (pm Dec, north–south).");

  T("pm_ra", "pm RA (proper motion in right ascension)",
    ["pm ra", "pmra", "right ascension component of proper motion", "pm alpha", "μα*"],
    "The east–west part of a star's proper motion, in mas/yr; positive means moving east.",
    "By convention it already includes the cos(declination) correction (written μα*), so it is a true angle on the sky.");

  T("pm_dec", "pm Dec (proper motion in declination)",
    ["pm dec", "pmdec", "pmde", "declination component of proper motion", "pm delta", "μδ"],
    "The north–south part of a star's proper motion, in mas/yr; positive means moving north.");

  T("radial_velocity", "Radial velocity",
    ["radial velocity", "rv", "rvz radvel", "radvel", "mesrv", "velocity", "velvalue", "velocities", "mesvelocities", "heliocentric radial velocity"],
    "How fast the object moves toward us (negative) or away (positive) along our line of sight, in km/s, measured from the Doppler shift of its spectrum.",
    "Stars near the Sun typically move at 10–50 km/s relative to us; Earth orbits the Sun at about 30 km/s. Combined with proper motion and distance it gives the star's full motion through space.");

  T("velocity_type", "Velocity type / nature", ["rvz type", "veltype", "rvz nature", "nature", "velocity type"],
    "Codes saying how a speed was expressed or measured: for example 'v' for a velocity in km/s, 'z' for a redshift, or 'cz' for redshift times the speed of light.");

  T("redshift", "Redshift (z)", ["redshift", "redshift z", "rvz redshift", "z", "blueshift"],
    "The fractional stretching of an object's light toward red because it is moving away (z ≈ speed ÷ speed of light). For stars it is tiny, e.g. 0.00005.",
    "Negative values (blueshift) mean approaching. For distant galaxies, redshift comes mainly from the expansion of the universe and is used to estimate their distance.");

  T("vlsr", "VLSR (velocity relative to the local standard of rest)", ["vlsr", "vlsr min", "vlsr max", "v lsr", "lsr velocity"],
    "Radial velocity relative to the average motion of stars near the Sun (the 'local standard of rest'), in km/s. Used mostly for gas clouds.");

  T("km_per_s", "km/s", ["km/s", "kilometres per second", "kilometers per second", "km s-1", "kilometre per second"],
    "Kilometres per second. 1 km/s is 3,600 km/h (about 2,240 mph). Earth orbits the Sun at about 30 km/s.");

  T("kmh", "km/h", ["km/h", "kilometre per hour", "kilometres per hour", "kph"],
    "Kilometres per hour (1 km/h ≈ 0.62 mph). 3,600 km/h equals 1 km/s.");

  T("vsini", "Rotation (v sin i)",
    ["v sin i", "vsini", "rotation (v sin i)", "mesrot", "stellar rotational velocity", "rotational velocity", "projected rotational velocity"],
    "How fast the star's surface spins at its equator, in km/s, from the broadening of its spectral lines. A minimum, since the axis tilt (i) is usually unknown.",
    "The Sun rotates at only about 2 km/s; many hot A and B stars spin at 100–300 km/s, fast enough to bulge at the equator. If a star's pole points at us, sin i is near 0 and the measured value is small even for a fast rotator: Vega spins at over 200 km/s but is seen almost pole-on, so its v sin i is only about 20 km/s. 'median of N measurements' is the middle value of the published estimates.");

  T("median", "Median", ["median"],
    "The middle value when several measurements are sorted: half are higher and half lower. Unlike an average it is not thrown off by one odd value.");

  T("rotation_period", "Rotation period",
    ["rotation period", "sidereal rot period", "sid rot period (iii)", "sid rot period", "sidereal rotation period", "period of rotation", "sidereal rot period (iii)"],
    "How long the object takes to spin once on its axis, measured against the stars. Jupiter: about 9 h 56 min; Earth: 23 h 56 min.",
    "'Sidereal' means measured relative to the distant stars rather than the Sun. '(III)' refers to System III, the rotation of Jupiter's or Saturn's magnetic field, used because their cloud tops rotate at different speeds at different latitudes.");

  T("rotation_rate", "Sid. rot. rate (rad/s)",
    ["sid rot rate", "sid rot rate (rad/s)", "sid rot rate, rad/s", "rotation rate", "rad/s", "radian", "radians", "radians per second"],
    "Spin speed as an angle per second, in radians per second (one full turn is 2π ≈ 6.28 radians). A larger number means a faster spin.",
    "Jupiter's 0.000176 rad/s corresponds to one turn in about 9.9 hours.");

  T("mean_solar_day", "Mean solar day", ["mean solar day", "mean solar day, hrs", "mean solar day (sol)", "sol", "solar day"],
    "The average length of the planet's day from noon to noon (Sun to Sun), as opposed to its rotation measured against the stars.",
    "A Mars solar day, a 'sol', is 88,775 seconds, about 24 h 40 min. On fast-spinning giant planets the solar and sidereal days are almost equal.");

  T("orbital_period", "Orbital period",
    ["orbital period", "sidereal orbit period", "mean sidereal orb per", "period min", "period_min", "orbit period", "sidereal orbital period",
      "sidereal period", "min period"],
    "How long the object takes to go once around what it orbits: a planet around the Sun, a satellite around Earth.",
    "'Sidereal' means measured against the stars. Jupiter takes 11.86 years (4,332.6 days), Saturn 29.4 years, a Starlink satellite about 94 minutes.");

  T("period", "Period", ["period", "upperiod period"],
    "The time something takes to repeat: for a satellite, one trip around Earth (in minutes); for a variable star, one cycle of brightening and fading (in days).");

  T("synodic_period", "Synodic period", ["synodic period"],
    "The time between repeats of the same Sun–Earth–object arrangement, for example from one opposition to the next. For Jupiter it is about 399 days.");

  T("mean_daily_motion", "Mean daily motion", ["mean daily motion", "deg/d", "degrees per day", "daily motion"],
    "How far the planet moves along its orbit per day on average, in degrees per day (360° ÷ orbital period in days).",
    "Jupiter moves 0.083° per day, completing 360° in 11.86 years.");

  T("mean_motion", "MEAN_MOTION", ["mean motion", "revolutions per day", "rev/day"],
    "The number of orbits a satellite completes per day: about 15.3 for Starlink (one lap every ~94 minutes) and 1.0 for a geostationary satellite.",
    "A higher value means a lower, faster orbit. Divide 1,440 (minutes in a day) by it to get the orbital period in minutes.");

  T("mean_motion_dot", "MEAN_MOTION_DOT", ["mean motion dot", "ndot", "first derivative of mean motion"],
    "How fast the mean motion is changing (halved by convention). Positive means air drag is lowering the orbit and the satellite is speeding up.");

  T("mean_motion_ddot", "MEAN_MOTION_DDOT", ["mean motion ddot", "nddot", "second derivative of mean motion"],
    "The rate of change of MEAN_MOTION_DOT (divided by 6 by convention). Almost always 0; kept for compatibility with the standard element format.");

  T("bstar", "BSTAR (drag term)", ["bstar", "b*", "bstar drag term"],
    "A drag term in the standard orbit model (SGP4): how strongly the thin upper atmosphere slows the satellite, in units of 1/Earth radii.",
    "Larger means more drag. Values around 0.0001–0.001 are typical for satellites in low orbit. It is a fitted number and can even come out negative.");

  T("eccentricity", "Eccentricity", ["eccentricity", "orbital eccentricity"],
    "How stretched an orbit is: 0 is a perfect circle, and values approaching 1 are long, thin ellipses.",
    "Earth's is 0.017, Jupiter's 0.048, Mars's 0.093 and Halley's Comet's 0.97. A Starlink satellite's is about 0.0002, almost exactly circular.");

  T("inclination", "Inclination", ["inclination", "orbital inclination", "inclination deg", "inclination_deg", "incl"],
    "The tilt of an orbit in degrees, relative to a reference plane: Earth's orbit (the ecliptic) for planets, Earth's equator for satellites.",
    "Jupiter's orbit is tilted 1.3° to Earth's. A satellite at 53° passes over latitudes up to 53° north and south; 90° is a polar orbit, and more than 90° means it travels westward (retrograde).");

  T("raan", "RA_OF_ASC_NODE (ascending node)",
    ["ra of asc node", "right ascension of ascending node", "right ascension of the ascending node", "longitude of ascending node",
      "longitude of the ascending node", "raan", "ascending node"],
    "Where the orbit crosses the reference plane heading north (the ascending node), as an angle measured from a fixed direction in space (the March equinox).",
    "For satellites it is measured along Earth's equator; for planets along the ecliptic. Together with inclination it sets the orientation of the orbit in space. Because Earth bulges at the equator, a satellite's node drifts by several degrees a day.");

  T("arg_periapsis", "Argument of periapsis",
    ["arg of pericenter", "argument of periapsis", "argument of perihelion", "argument of perigee", "argument of pericenter", "arg of perigee"],
    "The angle along the orbit from the ascending node to the point of closest approach (periapsis): which way the ellipse points within its plane.",
    "For nearly circular orbits, like Starlink's, it is poorly defined and changes quickly.");

  T("mean_anomaly", "Mean anomaly", ["mean anomaly"],
    "Where the object is along its orbit at the epoch, as an angle from 0° to 360° counted from the closest point (periapsis), as if it moved at constant speed.",
    "0° means at periapsis and 180° at the farthest point. Orbit software converts it into an exact position.");

  T("time_of_periapsis", "Time of periapsis", ["time of periapsis", "time of perihelion", "perihelion date"],
    "The date when the object was, or will be, at the closest point of its orbit.");

  T("semi_major_axis", "Semi-major axis", ["semi-major axis", "semi-major axis of an orbit", "semimajor axis", "semi major axis"],
    "Half the longest diameter of an elliptical orbit; in effect the average distance from the body being orbited.",
    "Jupiter's is 5.20 AU (778 million km); Earth's is 1 AU.");

  T("perigee", "PERIGEE", ["perigee", "perigee km", "perigee_km"],
    "The lowest point of a satellite's orbit, given here as height above Earth's surface in km.",
    "Starlink satellites orbit roughly 340–570 km up; the International Space Station about 420 km.");

  T("apogee", "APOGEE", ["apogee", "apogee km", "apogee_km"],
    "The highest point of a satellite's orbit, given here as height above Earth's surface in km.");

  T("orbit", "Orbit", ["orbit"],
    "For a satellite: its height above Earth from lowest point (perigee) to highest (apogee) in km, plus its tilt (inclination) and lap time (period).");

  T("orbital_speed", "Orbital speed",
    ["mean orbit speed", "mean orbit speed, km/s", "mean orbit velocity", "orbital speed", "orbital speed, km/s", "speed", "mean orbital speed", "orbit speed", "orbital velocity"],
    "The average speed of the planet along its orbit around the Sun, in km/s. Jupiter: 13.1 km/s; Earth: 29.8 km/s.");

  T("escape_speed", "Escape speed", ["escape speed", "escape speed, km/s", "escape velocity"],
    "The speed needed to leave the planet's surface (or cloud tops) and never fall back, ignoring air resistance. Earth: 11.2 km/s; Jupiter: 59.5 km/s.");

  // ---------------------------------------------------------------- stars: physical properties
  T("spectral_type", "Spectral type",
    ["spectral type", "sp type", "sptype", "messpt", "spectral classification", "sp_type", "spectrum", "mk type"],
    "A code for a star's spectrum, e.g. G2V for the Sun: letter = temperature class (O hottest … M coolest), number = subclass, Roman numeral = size class.",
    "O and B stars are blue-white and very hot, A white, F yellow-white, G yellow (like the Sun), K orange and M red and cool. The Roman numeral says whether the star is a supergiant (I), giant (III) or ordinary main-sequence 'dwarf' (V). Extra letters add details, e.g. e = emission lines, n = broad lines from fast rotation, p = peculiar.");

  T("spectral_class", "Spectral class",
    ["spectral class", "spectral classes", "temperature class", "spectral_class", "harvard class", "harvard spectral class", "class"],
    "The letter part of a spectral type, O B A F G K M, ordered from hottest (O, above 30,000 K, blue) to coolest (M, below about 3,700 K, red).",
    "A traditional memory aid is 'Oh Be A Fine Girl/Guy, Kiss Me'. The Sun is class G. On Wikidata, 'spectral class' holds the full spectral type (e.g. K5III).");

  T("luminosity_class", "Luminosity class",
    ["luminosity class", "luminosity_class", "lum class", "mk luminosity class", "yerkes luminosity class"],
    "The Roman numeral in a spectral type, showing a star's size and luminosity: I supergiant, II bright giant, III giant, IV subgiant, V main sequence.",
    "It is read from details of the spectral lines that depend on the gas pressure in the star's atmosphere: big, bloated stars have thin atmospheres and sharper lines. The Sun is V. Suffixes a, ab and b split a class into brighter and fainter parts (Ia is a more luminous supergiant than Ib).");

  T("dispsystem", "dispsystem (classification system)", ["dispsystem", "disp system"],
    "A code for the kind of spectrum or classification method behind this spectral type, for example photographic plates or an objective prism.");

  T("temperature", "Temperature",
    ["temperature", "temp", "mean temperature", "mean temperature (k)", "surface temperature"],
    "For a star, its surface (effective) temperature in kelvin (K); for a planet, a typical temperature of its surface or cloud tops.",
    "The Sun's surface is about 5,770 K; red stars are about 3,000–3,500 K and blue-white stars 10,000–40,000 K. Temperature sets a star's colour (the small swatch shows roughly what colour). To convert kelvin to °C subtract 273.");

  T("effective_temperature", "Effective temperature (Teff)", ["effective temperature", "teff", "teff k", "teff_k", "t eff", "teff median", "teff_median"],
    "The surface temperature of a star in kelvin (K): the temperature of an ideal glowing body that would give off the same energy per square metre.",
    "It is estimated from the spectrum or colours, so different studies often disagree by 50–200 K. 'Teff median' is the middle value of several published estimates.");

  T("kelvin", "Kelvin (K)", ["k", "kelvin", "kelvins"],
    "The temperature scale that starts at absolute zero. 0 K = −273.15 °C, and a change of 1 K equals a change of 1 °C. Water freezes at 273 K.");

  T("celsius", "Degree Celsius (°C)", ["degree celsius", "degrees celsius", "°c", "celsius"],
    "Degrees Celsius. To convert to kelvin add 273.15; to Fahrenheit multiply by 1.8 and add 32.");

  T("log_g", "log g (surface gravity)", ["log g", "logg", "log_g", "surface gravity (log g)", "log(g)"],
    "A star's surface gravity as the base-10 logarithm of the acceleration in cm/s². The Sun is 4.44; giants about 1–3; white dwarfs about 8.",
    "Each step of 1 means ten times the gravity. A low value means a huge, puffed-up star whose surface gravity is weak; a high value means a compact one. Earth's surface gravity would be log g = 2.99.");

  T("surface_gravity", "Surface gravity", ["surface gravity", "gravity", "gravitational acceleration"],
    "The pull of gravity at the surface or cloud tops, usually in m/s². Earth: 9.8 m/s²; Jupiter: about 24.8 m/s² (2.5 times Earth's).",
    "For stars, Wikidata often stores log g here with the unit 'centimetre per square second': a value such as 3.5 then means 10^3.5 cm/s², not 3.5 cm/s².");

  T("equatorial_gravity", "Equatorial gravity",
    ["equ grav, ge", "equ grav", "equ gravity", "equatorial gravity", "equ grav, ge (m/s^2)", "equ gravity m/s^2", "ge"],
    "Surface gravity at the planet's equator, in m/s² (Earth: 9.78). It is lower than at the poles because the planet spins and bulges outward.");

  T("polar_gravity", "Polar gravity",
    ["pol grav, gp", "pol grav", "polar gravity", "polar gravity m/s^2", "pol grav, gp (m/s^2)", "gp"],
    "Surface gravity at the planet's poles, in m/s². Higher than at the equator on fast-spinning planets: Jupiter 28.3 versus 24.8.");

  T("metallicity", "Metallicity [Fe/H]", ["metallicity", "[fe/h]", "fe/h", "fe h", "fe_h", "iron abundance"],
    "How rich a star is in elements heavier than helium, as [Fe/H]: its iron-to-hydrogen ratio versus the Sun's, in powers of ten. 0 = Sun-like.",
    "−1 means one tenth of the Sun's proportion of iron. +0.3 means about twice the Sun's proportion of iron. Old stars formed before many heavy elements existed and tend to have low (negative) values.");

  T("dex", "dex", ["dex"],
    "A logarithmic unit: 1 dex is a factor of 10, 0.3 dex a factor of 2, −1 dex one tenth.");

  T("atmos_params", "Temperature, gravity and metallicity", ["temperature, gravity and metallicity", "mesfe h", "mesfe_h", "stellar parameters"],
    "Published estimates of the star's surface temperature (Teff), surface gravity (log g) and metal content ([Fe/H]), one row per study.");

  T("compstar", "compstar (comparison star)", ["compstar", "comparison star"],
    "The reference star used for comparison when measuring the metallicity, usually the Sun.");

  T("catno", "catno (catalogue entry)", ["catno", "catalog entry", "cat no"],
    "The entry number in the source catalogue the measurement was taken from.");

  T("mass", "Mass", ["mass", "mass x 10^26 (kg)", "mass x10^23 (kg)", "mass x10^26 (kg)", "mass (kg)"],
    "How much matter the object contains. Stars are given in solar masses (M☉, the Sun = 1); planets in kg or Jupiter masses (M♃).",
    "Mass is the most important property of a star: it decides its temperature, brightness and lifespan. Stars range from about 0.08 to over 100 M☉. Horizons writes 'Mass x 10^26 (kg) = 18.98', meaning 18.98 × 10^26 kg = 1.898 × 10^27 kg.");

  T("solar_mass", "Solar mass (M☉)", ["m☉", "msun", "m sun", "solar mass", "solar masses", "m_sun", "msol"],
    "The mass of the Sun, 2 × 10^30 kg (333,000 Earths), used as the unit for star masses. A star of 2 M☉ has twice the Sun's mass.");

  T("jupiter_mass", "Jupiter mass (M♃)", ["m♃", "mjup", "m jup", "jupiter mass", "jupiter masses", "m_jup", "mj"],
    "The mass of Jupiter, 1.9 × 10^27 kg: about 318 Earth masses or 1/1,050 of the Sun. Used for giant planets.");

  T("radius", "Radius", ["radius", "planet radius", "stellar radius"],
    "The size of the object from centre to surface. Stars are given in solar radii (R☉, the Sun = 1); planets in km.",
    "The Sun's radius is 696,000 km (109 Earths). Giants are 10–100 R☉; red supergiants such as Betelgeuse exceed 700 R☉, larger than the orbit of Mars if placed where the Sun is.");

  T("solar_radius", "Solar radius (R☉)", ["r☉", "rsun", "r sun", "solar radius", "solar radii", "r_sun"],
    "The Sun's radius, 696,000 km (about 109 times Earth's), used as the unit for star sizes.");

  T("diameter", "Diameter", ["diameter", "mesdiameter", "stellar diameter"],
    "The width of the object through its centre (twice the radius). In SIMBAD's diameter table it may be an angle on the sky (mas) or a true size (km).",
    "Star diameters are measured directly by interferometry ('Interfer'), which combines light from several telescopes, or estimated from brightness and colour ('BrighCol').");

  T("method", "Method", ["method", "measurement method"],
    "How the value was obtained: 'paral' = from parallax; 'Interfer' = interferometry; 'BrighCol' = from brightness and colour.",
    "Other codes name photometric or spectroscopic methods described in the source paper.");

  T("equatorial_radius", "Equatorial radius",
    ["equat radius", "equat radius (1 bar)", "equatorial radius", "equatorial radius (km)", "equatorial radius (1 bar)"],
    "The planet's radius at its equator, in km. For giant planets it is measured where the atmospheric pressure equals 1 bar (about Earth's sea-level pressure).",
    "Fast spin makes planets bulge: Jupiter's equatorial radius (71,492 km) is about 4,600 km larger than its polar radius.");

  T("polar_radius", "Polar radius", ["polar radius", "polar radius (km)"],
    "The planet's radius from centre to pole, in km; smaller than the equatorial radius because spinning flattens the planet.");

  T("vol_mean_radius", "Volumetric mean radius", ["vol mean radius", "vol mean radius (km)", "volumetric mean radius", "mean radius"],
    "The radius of a perfect sphere with the same volume as the slightly flattened planet, in km.");

  T("bar", "Bar (pressure)", ["bar", "1 bar", "(1 bar)", "bars", "one bar"],
    "A unit of pressure: 1 bar is about Earth's sea-level air pressure. Giant planets have no surface, so sizes and temperatures are quoted at 1 bar.");

  T("flattening", "Flattening", ["flattening", "flattening, f", "oblateness"],
    "How squashed the planet is by its spin: (equatorial radius − polar radius) ÷ equatorial radius. 0 is a perfect sphere.",
    "Saturn is the flattest planet (0.098, visible even in small telescopes); Jupiter is 0.065, Mars about 1/170 and Earth 1/298.");

  T("density", "Density",
    ["density", "density (g/cm^3)", "mean density", "g/cm^3", "g/cm³", "g/cm3", "kilogram per cubic metre", "kg/m^3", "kg/m³"],
    "Mass divided by volume. In g/cm³, water = 1. Rocky Earth is 5.5; gassy Jupiter 1.33; Saturn 0.69 (it would float in a big enough bath).",
    "In kg/m³ the numbers are 1,000 times larger (Jupiter 1,326 kg/m³).");

  T("volume", "Volume", ["volume", "volume as quantity", "volume (x10^10 km^3)", "cubic kilometre", "km^3", "km³", "km3"],
    "The amount of space the object takes up. Horizons writes 'Volume (x10^10 km^3) = 16.3', meaning 16.3 × 10^10 km³ (Mars, about 15% of Earth's volume).");

  T("luminosity", "Luminosity", ["luminosity", "bolometric luminosity"],
    "The total power a star gives off as light and heat, usually in solar luminosities (L☉, the Sun = 1).",
    "Stars range from below 0.001 L☉ (faint red dwarfs) to over a million L☉ (the brightest supergiants); Rigel is roughly 100,000 L☉. Unlike apparent magnitude it does not depend on distance.");

  T("solar_luminosity", "Solar luminosity (L☉)", ["l☉", "lsun", "l sun", "solar luminosity", "solar luminosities", "l_sun"],
    "The Sun's total power output, 3.8 × 10^26 watts, used as the unit for star luminosities.");

  T("age", "Age", ["age", "age estimated by a dating method", "stellar age"],
    "How long ago the star formed, usually in millions (Myr) or billions (Gyr) of years. The Sun is 4.6 Gyr old.",
    "Stellar ages are hard to measure and often uncertain by 20–50%. Massive stars live short lives (a 20 M☉ star lasts about 10 Myr), so a very luminous blue star must be young.");

  T("myr", "Myr (million years)", ["myr", "million years", "megayear", "megayears"],
    "One million years.");

  T("gyr", "Gyr (billion years)", ["gyr", "billion years", "gigayear", "gigayears"],
    "One billion (thousand million) years. The universe is about 13.8 Gyr old and the Sun 4.6 Gyr.");

  T("year_unit", "Year (yr)", ["yr", "y", "year", "years"],
    "An Earth year, 365.25 days. Orbital periods of planets are often given in years.");

  T("day_unit", "Day (d)", ["d", "day", "days"],
    "24 hours. Orbital periods in Horizons and Wikidata are often given in days (Jupiter: 4,332.6 d).");

  T("hour_unit", "Hour (h)", ["h", "hr", "hrs", "hour", "hours"],
    "60 minutes. Rotation periods are often given in hours (Jupiter: 9.9 h).");

  T("minute_unit", "Minute (min)", ["min", "minute", "minutes"],
    "60 seconds. Satellite orbital periods are given in minutes (Starlink: about 94 min).");

  T("w_m2", "W/m² (watts per square metre)", ["w/m^2", "w/m2", "w/m²", "watts per square metre", "watts per square meter", "w m-2"],
    "Power arriving on, or leaving, each square metre of surface. Sunlight at Earth delivers about 1,361 W/m².");

  T("m_s2", "m/s² (acceleration)",
    ["m/s^2", "m/s2", "m/s²", "metre per square second", "meter per square second", "centimetre per square second", "cm/s^2", "cm/s²"],
    "Metres per second squared, the unit of acceleration used for gravity. Earth's surface gravity is 9.8 m/s².",
    "On star pages Wikidata's 'centimetre per square second' usually accompanies log g values, which are logarithms (see log g).");

  T("gm", "GM (gravitational parameter)", ["gm", "gm (km^3/s^2)", "gravitational parameter", "km^3/s^2", "km³/s²", "standard gravitational parameter"],
    "The planet's mass times the gravitational constant G, in km³/s². Known far more precisely than the mass itself, because spacecraft orbits measure it.",
    "Divide by G (6.674 × 10^-20 km³ kg⁻¹ s⁻²) to get the mass in kg.");

  T("gm_sigma", "GM 1-sigma", ["gm 1-sigma", "gm 1-sigma (km^3/s^2)", "gm sigma"],
    "The uncertainty of GM (1-sigma: about a 68% chance the true value lies within this amount).");

  T("hill_sphere", "Hill sphere", ["hill's sphere rad rp", "hill's sphere rad", "hill sphere", "hill's sphere", "hill radius", "hill sphere radius"],
    "The region around a planet where its gravity beats the Sun's, so moons can orbit stably. Given in planet radii (Rp): Jupiter's is about 740.",
    "That is roughly 53 million km for Jupiter. In practice moons stay well inside it, within about a third to a half of that radius.");

  T("roche_limit", "Roche limit (ice)",
    ["a roche(ice)/rp", "aroche(ice)/rp", "a roche/rp", "aroche/rp", "roche limit", "a roche", "aroche"],
    "The Roche limit for an icy moon, in planet radii (Rp): closer than this, the planet's tidal pull would tear such a moon apart. Jupiter's is 2.76 radii.",
    "Saturn's main rings lie mostly inside its Roche limit (2.71 radii), one reason the ring material never gathered into a moon.");

  T("rocky_core_mass", "Rocky core mass (Mc/M)", ["rocky core mass (mc/m)", "rocky core mass", "core mass", "mc/m"],
    "Estimated mass of the planet's rock-and-ice core as a fraction of its total mass. Jupiter: about 0.026 (2.6%).");

  T("core_radius", "Core radius", ["core radius", "core radius (km)"],
    "Estimated radius of the planet's metallic core. Mars's is about 1,700 km, roughly half the planet's radius.");

  T("obliquity", "Obliquity to orbit (axial tilt)", ["obliquity to orbit", "obliquity", "axial tilt"],
    "The tilt of the planet's spin axis relative to its orbit, in degrees. It causes seasons: Earth 23.4°, Mars 25.2°, Saturn 26.7°, Jupiter only 3.1°.",
    "Saturn's tilt is why its rings appear to open and close over its 29-year orbit as seen from Earth.");

  T("atmos_temp", "Atmos. temp. (1 bar)", ["atmos temp", "atmos temp (1 bar)", "atmospheric temperature"],
    "Temperature of the atmosphere at the 1-bar pressure level (about Earth's sea-level pressure), in kelvin. Jupiter: 165 K (−108 °C).");

  T("atmos_pressure", "Atmos. pressure", ["atmos pressure", "atmos pressure (bar)", "surface pressure", "atmospheric pressure"],
    "Average air pressure at the surface, in bar (Earth ≈ 1 bar). Mars has only 0.0056 bar, less than 1% of Earth's.");

  T("atmos_mass", "Mass of atmosphere", ["mass of atmosphere", "mass of atmosphere, kg", "atmosphere mass"],
    "The total mass of the planet's atmosphere. Mars: about 2.5 × 10^16 kg, roughly 1/200 of Earth's.");

  T("mass_ratio", "Mass ratio (Sun/planet)", ["mass ratio", "mass ratio (sun/mars)", "mass ratio (sun/planet)"],
    "How many times more massive the Sun is than the planet. For Mars it is about 3.1 million.");

  T("magnetic_moment", "Magnetic moment", ["magnetic moment", "joule per tesla", "j/t", "magnetic dipole moment"],
    "The strength of the planet's magnetic field treated as a bar magnet, in joules per tesla (J/T). Jupiter's is about 20,000 times Earth's.");

  T("m_sin_i", "M sin i (minimum mass)", ["m sin i", "msini", "minimum mass"],
    "The minimum mass of an exoplanet, found from the wobble it causes in its star. The true mass is larger unless the orbit is seen exactly edge-on.",
    "i is the tilt of the orbit to our line of sight.");

  T("variable_type", "Type of variable star", ["type of variable star", "variable star type", "vartyp", "variability type", "var type"],
    "The class of variable star, i.e. why its brightness changes: pulsation (e.g. Cepheid), eclipses (E), a rotating spotted surface (ROT), outbursts…",
    "Codes follow the General Catalogue of Variable Stars: E = eclipsing binary, BY = BY Draconis spotted star, HMXB = high-mass X-ray binary, ROT = rotating variable; a trailing ':' means uncertain.");

  T("variability", "Variability", ["variability", "mesvar", "variable", "variable star"],
    "How the star's brightness changes: its type, period, and its brightest (vmax) and faintest (vmin) magnitudes.");

  T("vmax", "vmax (brightest magnitude)", ["vmax", "max magnitude", "maximum magnitude", "lowvmax vmax"],
    "The star's magnitude at its brightest (remember: a smaller number is brighter).");

  T("vmin", "vmin (faintest magnitude)", ["vmin", "min magnitude", "minimum magnitude"],
    "The star's magnitude at its faintest.");

  T("raisingtime", "Rising time", ["raisingtime", "raising time", "rising time", "m-m"],
    "For a variable star: the time it takes to go from faintest to brightest, usually as a percentage of the period.");

  T("value_flag", "Value flag (r_…)", ["r epoch", "r period", "r raisingtime", "r vmax", "r vmin", "flag", "remark", "remarks", "value flag"],
    "A note attached to the neighbouring value, typically ':' (uncertain), '<' or '>' (a limit), or a code letter defined by the source catalogue.");

  T("limit_flag", "Limit flag", ["upperiod", "uppvmin", "upvsini", "lowvmax", "upper limit", "lower limit", "limit flag"],
    "Shows whether a value is a limit rather than a measurement: '<' means the true value is below the number shown (an upper limit), '>' above it.");

  T("nbmes", "nbmes (number of measurements)", ["nbmes", "number of measurements", "n mes", "nmes"],
    "The number of individual measurements averaged to produce this value.");

  T("resolution", "Resolution (spectral)", ["resolution", "spectral resolution", "resolving power"],
    "How finely the spectrograph separated wavelengths (λ/Δλ). Higher values reveal more detail and give more precise velocities.");

  // ---------------------------------------------------------------- SIMBAD
  T("simbad", "SIMBAD", ["simbad", "simbad page", "simbad id", "simbad database"],
    "The astronomical database run by the CDS in Strasbourg, France: the standard reference for data, names and papers on objects beyond the Solar System.");

  T("cds", "CDS (Strasbourg astronomical Data Centre)", ["cds", "centre de données astronomiques de strasbourg", "vizier"],
    "The data centre in Strasbourg, France, that runs SIMBAD, the VizieR catalogue service and the Aladin sky viewer.");

  T("basic_data", "Basic data", ["basic data"],
    "SIMBAD's main summary values for the object: position, motion, distance (parallax), velocity, spectral type and size.");

  T("identifier", "Identifier (main ID)", ["identifier", "main id", "main_id", "designation", "primary designation"],
    "The object's main catalogue name, such as 'HD 5112' or '20 Cet' (star number 20 in Cetus).",
    "SIMBAD adds prefixes: '*' marks a star, 'NAME' a proper name, 'V*' a variable star; Greek letters are abbreviated, e.g. 'alf Ori' = α (alpha) Orionis.");

  T("identifiers", "Identifiers (catalogue names)",
    ["identifiers", "ids", "catalog code", "catalog designation", "other names", "aliases", "catalog codes"],
    "All the names this object has in different catalogues. A bright star can have dozens: HD, HIP (Hipparcos), HR, SAO, TYC, 2MASS, Gaia DR3…",
    "HD is the Henry Draper catalogue and HR the Bright Star Catalogue. The number after the catalogue name is the entry in that catalogue; for 2MASS, WISE and IRAS names it encodes the sky position.");

  T("classifications", "Classifications (object-type codes)", ["classifications", "types", "object types", "type codes"],
    "Every object-type code SIMBAD has attached to this object, e.g. '*' star, 'PM*' high proper-motion star, 'IR' infrared source.");

  T("object_type", "Object type",
    ["object type", "otype", "otype desc", "otype_desc", "object_type", "type", "app type", "app_type"],
    "What kind of object this is (single star, double star, variable star, cluster and so on), as classified by SIMBAD.",
    "SIMBAD uses short codes such as '*' (star), '**' (double or multiple star), 'SB*' (spectroscopic binary) or 'V*' (variable star). In CelesTrak records OBJECT TYPE is PAY (payload, i.e. a working satellite), R/B (rocket body), DEB (debris) or UNK (unknown).");

  T("otype_history", "Object type history", ["object type history", "mesotype"],
    "Each object type SIMBAD has assigned to this object and where it came from; 'from id IRAS…' means it was detected by the IRAS infrared satellite.");

  T("measurements", "Measurements (SIMBAD tables)", ["measurements", "measurement tables", "simbad measurements"],
    "SIMBAD's tables of individual published measurements (parallaxes, velocities, spectral types…), one row per study, each with the code of its source paper.");

  T("hierarchy", "Hierarchy", ["hierarchy", "relation", "parent", "child", "parents", "children"],
    "Groups this object belongs to (parents, such as a cluster or a double-star system) and members it contains (children).");

  T("membership", "Membership", ["membership", "membership probability"],
    "SIMBAD's estimate, as a percentage, of how likely the star is to really belong to the listed group (cluster, association or stream). 100% means certain.");

  T("bibcode", "Bibcode (paper code)",
    ["bibcode", "paper", "coo bibcode", "pm bibcode", "plx bibcode", "rvz bibcode", "sp bibcode", "vlsr bibcode", "morph bibcode",
      "galdim bibcode", "coordinate source", "ref", "reference", "source paper"],
    "A 19-character code identifying the published paper or catalogue a value comes from, e.g. 2007A&A...474..653V. Click it to open the paper in NASA ADS.",
    "It packs year, journal, volume, page and the first author's initial: 2007A&A...474..653V is a 2007 paper in Astronomy & Astrophysics, volume 474, page 653, first author's surname starting with V. 'yCat' codes are data catalogues; 2020yCat.1350....0G is the Gaia early third data release (catalogue I/350).");

  T("references", "References (research papers)",
    ["references", "nbref", "research papers", "papers", "papers count", "references in simbad", "papers_count", "number of references"],
    "The number of published research papers that mention this object, as counted by SIMBAD. Famous stars have thousands; faint ones only a handful.",
    "Click to browse titles; each paper links to NASA ADS (the astronomy literature database) or to its DOI.");

  T("ads", "ADS (Astrophysics Data System)", ["ads", "nasa ads", "astrophysics data system"],
    "NASA's Astrophysics Data System: a free search engine and archive for astronomy and physics research papers.");

  T("doi", "DOI", ["doi", "digital object identifier"],
    "Digital Object Identifier: a permanent link to a published paper, opened through doi.org.");

  T("oid", "oid (SIMBAD record number)", ["oid", "oidref"],
    "SIMBAD's internal record number for the object; it has no astronomical meaning.");

  T("update_date", "Update date", ["update date", "updated", "last update"],
    "When SIMBAD last changed its record for this object.");

  T("notes", "Notes", ["notes", "simbad notes", "annotations"],
    "Remarks added by SIMBAD staff, for example that an object could not be matched in a catalogue such as Gaia.");

  T("morphology", "Morphology", ["morphology", "morph type", "morph_type", "morphological type", "hubble type"],
    "For a galaxy: its shape class in the Hubble scheme, such as E (elliptical), S (spiral, a–c from tight to loose arms), SB (barred spiral) or Irr (irregular).");

  T("dimensions", "Dimensions", ["dimensions", "galdim majaxis", "galdim minaxis", "galdim", "major axis", "minor axis", "apparent dimensions"],
    "The apparent size of an extended object (galaxy, nebula, cluster) on the sky: major axis × minor axis in arcminutes (′), and its tilt (PA).");

  T("position_angle", "Position angle (PA)", ["pa", "position angle", "galdim angle"],
    "The direction an object's long axis (or a companion star) points on the sky, in degrees measured from north through east.");

  T("iue", "IUE ultraviolet spectra", ["iue ultraviolet spectra", "mesiue", "iue", "international ultraviolet explorer"],
    "Ultraviolet spectra taken by the International Ultraviolet Explorer satellite (1978–1996). Each row is one exposure.",
    "Ultraviolet light is blocked by Earth's atmosphere, so it can only be observed from space. Hot stars give off much of their energy in the ultraviolet.");

  T("camid", "camid (IUE camera)", ["camid", "camera"],
    "Which IUE camera took the spectrum: SWP = short wavelengths (115–200 nm), LWP/LWR = long wavelengths (185–330 nm), FES = guide sensor.");

  T("aperture", "Aperture (IUE)", ["aperture"],
    "Which entrance aperture of the IUE spectrograph was used: L = large (10 × 20 arcsec), S = small (3 arcsec).");

  T("dispcode", "dispcode (IUE dispersion)", ["dispcode", "dispersion"],
    "IUE dispersion mode: H = high resolution (fine wavelength detail, for bright stars), L = low resolution.");

  T("exptime", "Exposure time", ["exptime", "exposure time", "exposure"],
    "How long the detector collected light, in seconds.");

  T("fes", "FES counts / mode", ["fescount", "fesmode", "fes", "fine error sensor", "fes count"],
    "Readings from IUE's Fine Error Sensor, a guide camera that also measured the star's brightness; fesmode is the sensor setting used.");

  T("obsdate", "Observation date", ["obsdate", "observation date", "obs date"],
    "Date of the observation: for IUE as YYMMDD; in velocity tables as a day count (Julian Date minus 2,400,000).");

  T("obstime", "Observation time", ["obstime", "obs time"],
    "Time of day of the observation, as HHMMSS in Universal Time.");

  T("progid", "progid (programme ID)", ["progid", "program id", "programme id", "proposal id"],
    "Identifier of the observing programme (the proposal that requested the observation).");

  T("station", "Station (IUE)", ["station", "ground station"],
    "The IUE ground station that ran the observation: G = Goddard (USA), V = Villafranca (Spain).");

  T("iue_codes", "IUE archive codes", ["expqualcode", "classcode", "abnormcode", "exposure quality code"],
    "IUE archive codes: expqualcode rates exposure quality, classcode is the category of target, abnormcode flags abnormal exposures.");

  T("comments", "Comments", ["comments", "comment"],
    "Free-text notes from the source catalogue, for example camera settings or where an object type came from.");

  T("obsid", "obsid (observation ID)", ["obsid", "observation id", "obs id"],
    "The archive identifier of the observation, used to retrieve the data from the mission's archive.");

  T("xmm", "XMM-Newton X-ray observations", ["xmm-newton x-ray observations", "mesxmm", "xmm", "xmm-newton"],
    "X-ray observations by ESA's XMM-Newton space telescope (launched 1999) that include this object.",
    "X-rays come from very hot gas: active stellar coronas, colliding winds of massive stars, or gas falling onto a compact companion.");

  T("herschel", "Herschel observations", ["herschel observations", "mesherschel", "herschel", "herschel space observatory"],
    "Far-infrared observations by ESA's Herschel Space Observatory (2009–2013) that covered this object. Far-infrared light reveals cool dust and gas.");

  T("iso", "ISO observations", ["iso observations", "mesiso", "iso", "infrared space observatory"],
    "Infrared observations by ESA's Infrared Space Observatory (1995–1998) that covered this object.");

  // ---------------------------------------------------------------- Wikidata and other sources
  T("wikidata", "Wikidata", ["wikidata", "wikidata properties", "wikidata id", "properties", "property"],
    "Wikidata, the free structured database behind Wikipedia. Each row is a 'property' (such as mass or constellation) with one or more values.",
    "Values come from many catalogues and can disagree slightly; a property may list several values from different studies.");

  T("wikipedia", "Wikipedia", ["wikipedia"],
    "The free online encyclopedia. The article text shown here is a plain-text copy.");

  T("external_id", "Catalogue / database identifier",
    ["external identifier", "catalog identifier", "external id", "dewey decimal classification", "baidu tieba name", "omegawiki defined meaning",
      "subreddit", "stack exchange tag", "iconclass notation", "aricns", "mesh tree code", "hashtag"],
    "A reference number or name for this object in another database, encyclopedia, library catalogue or website. It links records together; it is not a measurement.");

  T("naif_id", "NAIF ID", ["naif id", "naif"],
    "The number NASA's spacecraft-navigation software (SPICE) uses for the body, e.g. 599 for Jupiter and 499 for Mars.");

  T("gaia_id", "Gaia ID", ["gaia id", "gaia source id", "gaia dr3", "gaia"],
    "The star's source number in the catalogue of ESA's Gaia satellite, which has measured positions, distances and motions of nearly two billion stars.");

  T("astro_symbol", "Astronomical symbol", ["astronomic symbol image", "unicode character", "astronomical symbol"],
    "The traditional symbol for the body, e.g. ♃ for Jupiter, ♄ for Saturn, ♂ for Mars.");

  T("instance_of", "Instance of", ["instance of"],
    "What kind of thing Wikidata says this is, e.g. 'star', 'gas giant' or 'constellation'.");

  T("part_of", "Part of", ["part of"],
    "A larger thing this object belongs to, such as the Solar System or a star cluster.");

  T("has_parts", "Has part(s)", ["has part(s)", "has part(s) of the class", "has parts", "has part"],
    "Components Wikidata lists for this object, such as the stars of a multiple system or the layers of a planet.");

  T("parent_body", "Parent astronomical body", ["parent astronomical body", "parent body"],
    "The body this object orbits: for a planet the Sun, for a moon its planet.");

  T("child_body", "Child astronomical body", ["child astronomical body", "child body"],
    "Bodies that orbit this one, such as a planet's moons.");

  T("companion_of", "Companion of", ["companion of", "companion"],
    "Another star bound to this one by gravity, in a double or multiple star system.");

  T("discoverer", "Discoverer", ["discoverer or inventor", "discoverer", "discovered by"],
    "Who first discovered or identified the object.");

  T("inception", "Inception", ["inception"],
    "When the object or project came into being; for a satellite constellation, when launches began.");

  T("significant_event", "Significant event", ["significant event"],
    "Notable events Wikidata records for the object, such as a launch, a discovery or a spacecraft visit.");

  T("studied_by", "Studied by", ["studied by"],
    "The branch of science that studies this kind of object, e.g. planetary science or stellar astronomy.");

  T("described_by_source", "Described by source", ["described by source"],
    "Reference works that have an entry about this object, such as encyclopedias or star atlases.");

  T("surface_extremes", "Highest / lowest point", ["highest point", "lowest point"],
    "The highest or lowest surface feature of the planet, such as Olympus Mons on Mars.");

  T("operator", "Operator", ["operator", "operating area"],
    "The company or agency that runs the satellite or service, and the area it serves.");

  T("ipa", "IPA transcription", ["ipa transcription", "ipa"],
    "How the name is pronounced, written in the International Phonetic Alphabet.");

  T("wikimedia_commons", "Wikimedia Commons", ["commons category", "commons gallery", "wikimedia commons", "commons"],
    "Wikimedia Commons, the free media library behind Wikipedia; this points to its collection of images about the object.");

  T("locator_map", "Locator map image", ["locator map image", "locator map"],
    "A map showing where the constellation lies on the sky, with its boundary and main stars.");

  T("same_or_different", "Said to be the same as / different from", ["said to be the same as", "different from"],
    "Wikidata links to items that may be the same thing under another name, or that are easily confused with this one but are distinct.");

  T("computed_here", "Computed here", ["computed here"],
    "The source did not give this value, so the app calculated it from the object's right ascension and declination.");

  T("last_observed", "Last observed", ["last observed", "last seen"],
    "The most recent date you logged this object.");

  T("manufacturer", "Manufacturer", ["manufacturer"],
    "Who built the spacecraft.");

  T("sources", "Sources", ["sources", "source", "data sources"],
    "The online databases these values came from; each link opens the original record.");

  T("resolved_via", "Resolved via", ["resolved via", "resolved", "resolution method"],
    "How the app matched the name in your observing log to database records (SIMBAD, Wikipedia or CelesTrak).");

  T("harvested", "Harvested", ["harvested", "retrieved"],
    "When the data was downloaded from the online sources.");

  T("raw_data", "Raw data (object.json)", ["raw data (object.json)", "raw data", "object.json", "json"],
    "All data stored for this object, in its original machine-readable form (JSON).");

  // ---------------------------------------------------------------- CelesTrak
  T("celestrak", "CelesTrak", ["celestrak"],
    "A long-running public website that redistributes the US Space Force catalogue of satellites and their orbital elements.");

  T("satcat", "Satellite catalogue record", ["satellite catalog record", "satcat", "satellite catalog", "satellite catalog entry"],
    "The satellite's entry in the official catalogue of objects in Earth orbit: identifiers, launch, owner, status and basic orbit.");

  T("orbital_elements", "Current orbital elements",
    ["current orbital elements", "orbital elements", "tle", "two-line elements", "two-line element set", "gp elements", "keplerian elements"],
    "The numbers that describe the satellite's orbit at one moment (the epoch), used to predict where it will be. Updated about daily.",
    "They come from the US Space Force.");

  T("object_name", "Object name", ["object name", "object_name"],
    "The catalogue name of the object, e.g. STARLINK-37502.");

  T("object_id", "OBJECT_ID (international designator)", ["object id", "international designator", "cospar id", "intldes", "cospar"],
    "The international (COSPAR) designator: launch year, launch number that year, and a letter code for the piece. 2026-117AB = the 117th launch of 2026, object AB.");

  T("norad_id", "NORAD ID", ["norad id", "norad cat id", "norad catalog number", "norad", "satnum", "norad number", "satellite catalog number"],
    "The satellite's number in the US Space Force catalogue (NORAD = North American Aerospace Defense Command). Every tracked object in orbit, even debris, has one.",
    "Tracking sites such as Heavens-Above use it to look up passes over your location.");

  T("ops_status", "OPS_STATUS_CODE (operational status)", ["ops status code", "operational status", "ops status"],
    "Operational status: + operational, − not operational, P partly operational, B backup, S spare, X extended mission, D decayed, ? unknown.");

  T("owner", "Owner", ["owner", "owner code"],
    "The country or organisation responsible for the satellite: US = United States, PRC = China, CIS = Russia/former Soviet Union, ESA = European Space Agency.");

  T("launch_date", "Launch date", ["launch date", "launched", "launch", "launch_date"],
    "The date the object was launched into space.");

  T("launch_site", "Launch site", ["launch site"],
    "Where the satellite was launched from: AFETR = Cape Canaveral/Kennedy (Eastern Range), AFWTR = Vandenberg (Western Range), TYMSC = Baikonur.");

  T("decay_date", "Decay date", ["decay date", "decay", "reentry date"],
    "The date the object re-entered the atmosphere. Blank means it is still in orbit.");

  T("rcs", "RCS (radar cross-section)", ["rcs", "radar cross section", "radar cross-section", "rcs size"],
    "How large the object appears to tracking radar, in square metres. Often blank for newer objects because the value is no longer published.");

  T("data_status", "DATA_STATUS_CODE", ["data status code", "data status"],
    "Flags problems with the catalogue entry: NEA = no elements available, NIE = no initial elements, NCE = no current elements. Blank means normal.");

  T("orbit_center", "ORBIT_CENTER", ["orbit center", "orbit centre"],
    "The body the object orbits: EA = Earth, MO = Moon, SU = the Sun (for deep-space probes), and others.");

  T("orbit_type", "ORBIT_TYPE", ["orbit type"],
    "The kind of trajectory: ORB = in orbit, LAN = landed, IMP = impacted, DOC = docked to another object, R/T = round trip.");

  T("classification_type", "CLASSIFICATION_TYPE", ["classification type", "classification"],
    "Security classification of the orbital data: U = unclassified (public).");

  T("ephemeris_type", "EPHEMERIS_TYPE", ["ephemeris type"],
    "Which orbit model the elements are meant for; 0 means the standard SGP4 model used for public data.");

  T("element_set_no", "ELEMENT_SET_NO", ["element set no", "element set number", "element number"],
    "A running counter of the published orbital element sets for this satellite; 999 is a common placeholder.");

  T("rev_at_epoch", "REV_AT_EPOCH", ["rev at epoch", "revolution number", "revolution number at epoch"],
    "How many orbits the satellite had completed since launch, at the time of the epoch.");

  T("heavens_above", "Heavens-Above", ["heavens-above", "heavens above"],
    "A website that predicts when satellites pass over your location and how bright they will be.");

  // ---------------------------------------------------------------- JPL Horizons
  T("horizons", "JPL Horizons", ["jpl horizons", "horizons", "jpl"],
    "NASA Jet Propulsion Laboratory's online service that calculates precise positions and physical data for Solar System bodies.");

  T("physical_data", "Physical data", ["physical data"],
    "Physical properties of the planet as published by JPL Horizons: size, mass, density, gravity, rotation, orbit and energy balance.");

  T("ephemeris", "Ephemeris", ["ephemeris", "ephemerides", "ephem"],
    "A table of an object's calculated position and appearance at given times. Here: JPL Horizons values for the moments of your observations.",
    "The word comes from the Greek for 'daily'; printed ephemerides were the almanacs that navigators and astronomers used.");

  T("elongation", "S-O-T (solar elongation)", ["s-o-t", "sot", "elongation", "elongation deg", "elongation_deg", "solar elongation"],
    "How far the object appears from the Sun in your sky, in degrees (Sun–Observer–Target). Near 0° it is lost in the glare; near 180° it is up all night.");

  T("leading_trailing", "/r (leading or trailing the Sun)", ["/r", "/l", "/t", "r flag"],
    "Whether the object trails (/T) or leads (/L) the Sun across the sky. /T: east of the Sun, best seen in the evening. /L: west of the Sun, best seen before dawn.");

  T("phase_angle", "S-T-O (phase angle)", ["s-t-o", "sto", "phase angle"],
    "The angle at the planet between the directions to the Sun and to you (Sun–Target–Observer). 0° = fully lit as seen from Earth.",
    "Larger angles show more shadow. Outer planets never show large phase angles: Jupiter at most about 12°, Saturn about 6°.");

  // ---------------------------------------------------------------- everyday object kinds
  T("star", "Star", ["star", "stars"],
    "A huge ball of hot gas that shines by nuclear fusion in its core. The Sun is an ordinary star; the others look like points because they are so far away.");

  T("planet", "Planet", ["planet", "planets"],
    "A large body orbiting the Sun (or another star) that shines by reflected sunlight. Jupiter, Saturn and Mars are planets; they usually twinkle less than stars.");

  T("moon", "Moon", ["moon", "moons", "natural satellite"],
    "A natural body orbiting a planet. Jupiter has dozens of known moons; its four largest are visible in binoculars.");

  T("satellite", "Satellite", ["satellite", "satellites", "artificial satellite"],
    "Here: an artificial satellite, a human-made spacecraft orbiting Earth. They shine by reflected sunlight and are best seen soon after dusk or before dawn.");

  T("star_cluster", "Star cluster", ["cluster", "clusters", "star cluster", "star clusters"],
    "A group of stars born together from the same cloud of gas, still close together in space.");

  T("nebula", "Nebula", ["nebula", "nebulae", "nebulas"],
    "A cloud of gas and dust in space. Some glow because nearby hot stars energise them, some reflect starlight, and some are dark silhouettes.");

  T("galaxy", "Galaxy", ["galaxy", "galaxies"],
    "A vast system of billions of stars, gas and dust held together by gravity. The Milky Way is ours; the Andromeda Galaxy is visible to the eye from dark sites.",
    "Andromeda is 2.5 million light-years away.");

  T("comet", "Comet", ["comet", "comets"],
    "An icy body from the outer Solar System that grows a glowing head and tail of gas and dust as it nears the Sun.");

  T("minor_body", "Minor body", ["minor bodies", "minor body", "asteroid", "asteroids", "minor planet", "minor planets", "dwarf planet"],
    "A small Solar System object that is not a planet or a moon: asteroids, dwarf planets and similar bodies.");

  // ================================================================== SIMBAD object types
  // [code, name, explanation, extra aliases]
  var OTYPES = [
    ["*", "Star", "A star, with no more specific type assigned."],
    ["**", "Double or Multiple Star", "Two or more stars that appear close together on the sky; most such pairs orbit each other, though some are chance alignments.", ["double star", "multiple star", "binary star", "binary"]],
    ["SB*", "Spectroscopic Binary", "A pair of stars too close to see separately; the pairing shows up as a regular back-and-forth Doppler shift in the spectrum."],
    ["EB*", "Eclipsing Binary", "A pair of stars whose orbit is seen nearly edge-on, so they pass in front of each other and the combined light dips regularly (like Algol)."],
    ["El*", "Ellipsoidal Variable", "A close pair whose stars are stretched into egg shapes by each other's gravity, so the total light varies gently as they orbit."],
    ["Sy*", "Symbiotic Star", "A pair made of a cool red giant and a hot compact star (usually a white dwarf) that feeds on the giant's wind, giving a mixed spectrum."],
    ["CV*", "Cataclysmic Binary", "A close pair in which a white dwarf pulls gas from a companion star, causing outbursts (dwarf novae and novae)."],
    ["No*", "Classical Nova", "A star system that suddenly brightened by a large factor in a nova: a thermonuclear flash on a white dwarf's surface."],
    ["XB*", "X-ray Binary", "A pair in which a neutron star or black hole pulls gas from a companion; the gas heats to millions of degrees and shines in X-rays."],
    ["LXB", "Low Mass X-ray Binary", "An X-ray binary whose companion is a low-mass star, similar to or smaller than the Sun, feeding a neutron star or black hole."],
    ["HXB", "High Mass X-ray Binary", "An X-ray binary whose companion is a massive hot star: a neutron star or black hole captures part of its wind and glows in X-rays."],
    ["PM*", "High Proper Motion Star", "A star that drifts across the sky unusually fast (large proper motion), usually because it is relatively close to the Sun."],
    ["HV*", "High Velocity Star", "A star moving through the Galaxy much faster than its neighbours, often a visitor from the Galaxy's halo."],
    ["V*", "Variable Star", "A star whose brightness changes noticeably over time, for any reason: pulsation, eclipses, spots or eruptions."],
    ["Pu*", "Pulsating Variable", "A variable star whose brightness changes because the star itself rhythmically swells and shrinks."],
    ["Ce*", "Cepheid Variable", "A pulsating yellow supergiant that brightens and fades in a regular 1–100 day cycle. Brighter Cepheids have longer periods, which makes them distance markers.", ["cepheid"]],
    ["cC*", "Classical Cepheid Variable", "A young, massive Cepheid such as Delta Cephei or Polaris; its period–brightness relation is used to measure distances to galaxies.", ["classical cepheid"]],
    ["WV*", "Type II Cepheid Variable", "An old, low-mass pulsating star resembling a Cepheid but fainter for its period (W Virginis type)."],
    ["RR*", "RR Lyrae Variable", "An old, low-mass pulsating star with a period under a day; all have similar luminosity, so they serve as distance markers."],
    ["dS*", "delta Sct Variable", "A pulsating A- or F-type star, a little hotter than the Sun, with small brightness changes over hours (Delta Scuti type).", ["delta scuti variable"]],
    ["bC*", "beta Cep Variable", "A hot, massive B-type star that pulsates over a few hours with small brightness changes (Beta Cephei type).", ["beta cephei variable"]],
    ["gD*", "gamma Dor Variable", "An F-type star slightly hotter than the Sun with slow, small pulsations over 0.3–3 days (Gamma Doradus type)."],
    ["SX*", "SX Phe Variable", "An old, metal-poor pulsating star similar to a Delta Scuti star, with periods of hours (SX Phoenicis type)."],
    ["LP*", "Long-Period Variable", "A cool giant whose brightness changes slowly, over tens to hundreds of days or irregularly, as it pulsates.", ["long period variable"]],
    ["Mi*", "Mira Variable", "A cool red giant that pulsates over 80–1,000 days and changes brightness by a large factor (Mira, in Cetus, is the prototype)."],
    ["RV*", "RV Tauri Variable", "A yellow supergiant pulsating with alternating deep and shallow minima over 30–150 days (RV Tauri type)."],
    ["Ro*", "Rotating Variable", "A star whose brightness varies as it spins, because its surface has dark or bright patches."],
    ["a2*", "alpha2 CVn Variable", "A chemically peculiar A or B star with a strong magnetic field and patches of unusual elements; its light changes slightly as it rotates.", ["alpha2 canum venaticorum variable"]],
    ["BY*", "BY Dra Variable", "A cool, usually young star with large dark starspots; its brightness wobbles slightly as it rotates (BY Draconis type).", ["by draconis variable"]],
    ["RS*", "RS CVn Variable", "A close pair containing an active, spotted giant or subgiant with strong magnetic activity and flares (RS Canum Venaticorum type)."],
    ["Er*", "Eruptive Variable", "A star whose brightness changes through outbursts or flares rather than regular pulsation."],
    ["Fl*", "Flare Star", "A dim red dwarf that occasionally brightens sharply for minutes in a magnetic flare."],
    ["Or*", "Orion Variable", "A young star still in or near its birth nebula, varying irregularly in brightness (Orion variable type)."],
    ["TT*", "T Tauri Star", "A young, Sun-like star less than about 10 million years old, still contracting and often surrounded by a disc of gas and dust."],
    ["Ae*", "Herbig Ae/Be Star", "A young star of a few solar masses (type A or B), still forming and surrounded by a disc; shows emission lines."],
    ["Y*O", "Young Stellar Object", "A star still in the process of forming, often wrapped in the gas and dust it formed from.", ["yso"]],
    ["pr*", "Pre-Main Sequence Star", "A young star that has not yet started steady hydrogen fusion in its core; it is still shrinking toward the main sequence."],
    ["Em*", "Emission-line Star", "A star whose spectrum shows bright emission lines from hot gas around it, for example a disc or a strong wind."],
    ["Be*", "Be Star", "A fast-spinning hot B-type star surrounded by a disc of gas it has shed; the disc adds bright emission lines (the 'e')."],
    ["BS*", "Blue Straggler", "A star in a cluster that is hotter and bluer than it should be at the cluster's age, probably made by a merger or mass transfer."],
    ["RG*", "Red Giant Branch star", "A star that has used up the hydrogen in its core and swollen into a red giant; it now burns hydrogen in a shell around the core.", ["red giant"]],
    ["AB*", "Asymptotic Giant Branch Star", "An aged giant in a late stage: very large, cool and luminous, burning helium and hydrogen in shells and shedding mass.", ["agb star"]],
    ["C*", "Carbon Star", "A cool giant whose atmosphere has more carbon than oxygen, giving it a deep red colour."],
    ["S*", "S Star", "A cool giant between ordinary M giants and carbon stars, showing bands of zirconium oxide."],
    ["sg*", "Evolved Supergiant", "A massive star that has left the main sequence and swollen into a supergiant, among the most luminous stars.", ["supergiant"]],
    ["s*r", "Red Supergiant", "A massive star late in life, swollen to hundreds of times the Sun's size, cool and red; Betelgeuse and Antares are examples."],
    ["s*y", "Yellow Supergiant", "A rare, short-lived supergiant stage between blue and red, with a yellowish colour (class F or G)."],
    ["s*b", "Blue Supergiant", "A hot, massive, extremely luminous supergiant (class O or B) such as Rigel, tens of thousands of times brighter than the Sun."],
    ["HS*", "Hot Subdwarf", "A small, very hot star that has lost most of its outer hydrogen and burns helium in its core (subdwarf O or B)."],
    ["pA*", "Post-AGB Star", "A star that has just shed its outer layers after the giant stage, on its way to becoming a white dwarf."],
    ["WD*", "White Dwarf", "The dense, Earth-sized remnant core of a dead Sun-like star; it no longer fuses and slowly cools over billions of years."],
    ["LM*", "Low-mass Star", "A star of much lower mass than the Sun, typically a red dwarf."],
    ["BD*", "Brown Dwarf", "An object between a star and a planet (13–80 Jupiter masses), too small to sustain hydrogen fusion; it glows dimly as it cools."],
    ["N*", "Neutron Star", "The collapsed core of a massive star after a supernova: more mass than the Sun packed into a ball about 20 km across."],
    ["Psr", "Pulsar", "A rapidly spinning neutron star whose beams of radiation sweep past Earth, seen as regular pulses."],
    ["OH*", "OH/IR Star", "A cool, dust-shrouded giant losing mass, bright in infrared light and in radio emission from OH molecules."],
    ["WR*", "Wolf-Rayet Star", "A very hot, massive star that has blown away its hydrogen envelope and drives an extremely strong wind."],
    ["Pe*", "Chemically Peculiar Star", "A star (usually type A or B) whose surface shows unusual amounts of some elements, such as silicon, strontium, mercury or manganese."],
    ["HB*", "Horizontal Branch Star", "An old star burning helium in its core after the red-giant stage."],
    ["St*", "Stellar Stream", "A long stream of stars moving together through the Galaxy, usually the stretched-out remains of a cluster or small galaxy."],
    ["MGr", "Moving Group", "A loose group of stars with a common origin that still move through space in the same direction, though no longer bound together."],
    ["OpC", "Open Cluster", "A loose group of tens to thousands of young stars born together from one cloud, like the Pleiades. Its stars drift apart over time.", ["open star cluster"]],
    ["GlC", "Globular Cluster", "A dense, ball-shaped swarm of hundreds of thousands of very old stars orbiting in the Galaxy's halo."],
    ["Cl*", "Cluster of Stars", "A group of stars that formed together and are, or once were, held together by gravity."],
    ["As*", "Association of Stars", "A very loose group of young stars with a common origin, spread over a large region and no longer bound by gravity.", ["stellar association", "ob association"]],
    ["Pl", "Extra-solar Planet", "A planet orbiting a star other than the Sun (an exoplanet).", ["exoplanet", "extrasolar planet"]],
    ["ISM", "Interstellar Medium Object", "Gas or dust between the stars (the interstellar medium) associated with this position.", ["interstellar medium"]],
    ["RNe", "Reflection Nebula", "A cloud of dust that shines by reflecting the light of nearby stars, usually looking blue."],
    ["HII", "HII Region", "A cloud of hydrogen made to glow red by ultraviolet light from hot young stars (an emission nebula, like the Orion Nebula).", ["emission nebula"]],
    ["PN", "Planetary Nebula", "A glowing shell of gas thrown off by a dying Sun-like star, lit by the hot core left behind (nothing to do with planets)."],
    ["SNR", "Supernova Remnant", "The expanding debris of a star that exploded as a supernova."],
    ["MoC", "Molecular Cloud", "A cold, dense cloud of gas, mostly hydrogen molecules, where new stars form."],
    ["DNe", "Dark Cloud (nebula)", "A cloud of dust dense enough to block the light of stars behind it, seen as a dark patch.", ["dark nebula"]],
    ["G", "Galaxy", "A vast system of billions of stars."],
    ["QSO", "Quasar", "The extremely bright centre of a distant galaxy, powered by gas falling into a supermassive black hole."],
    ["AGN", "Active Galaxy Nucleus", "The centre of a galaxy that gives off far more energy than its stars can explain, powered by a supermassive black hole."],
    ["X", "X-ray Source", "Detected as a source of X-rays, a sign of very hot gas (millions of degrees)."],
    ["UV", "UV-emission Source", "Detected as a source of ultraviolet light, typical of hot stars.", ["ultraviolet source"]],
    ["IR", "Infra-Red Source", "Detected as a source of infrared (heat) radiation, for example by the IRAS satellite.", ["infrared source"]],
    ["NIR", "Near-IR Source", "Detected in near-infrared light (just beyond red, about 1–5 micrometres), for example by the 2MASS survey.", ["near-infrared source"]],
    ["MIR", "Mid-IR Source", "Detected in mid-infrared light (about 5–25 micrometres), for example by the WISE satellite.", ["mid-infrared source"]],
    ["FIR", "Far-IR Source", "Detected in far-infrared light (about 25–350 micrometres), which comes from cool dust.", ["far-infrared source"]],
    ["Rad", "Radio Source", "Detected as a source of radio waves."],
    ["smm", "Sub-Millimetric Source", "Detected at sub-millimetre wavelengths, between infrared and radio, which trace cold dust and gas."],
    ["mm", "Millimetric Radio Source", "Detected at millimetre radio wavelengths."],
    ["cm", "Centimetric Radio Source", "Detected at centimetre radio wavelengths."],
    ["gam", "Gamma-ray Source", "Detected as a source of gamma rays, the most energetic form of light."],
    ["EmO", "Emission Object", "An object with bright emission lines in its spectrum."],
    ["?", "Object of Unknown Nature", "An object whose nature is not known."]
  ];
  var OT_BY_CODE = {}, OT_BY_NAME = {};
  // Codes left out of the exact-case code table because they clash with other labels
  // (G = Gaia band, mm/cm = units, ? = punctuation).
  var CODE_EXCLUDE = { G: 1, mm: 1, cm: 1, "?": 1 };
  OTYPES.forEach(function (o) {
    var code = o[0], name = o[1], expl = o[2];
    var id = "otype_" + name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    var longText = "SIMBAD object-type code '" + code + "'. A '?' in place of the last character (e.g. '" +
      (code.length > 1 ? code.slice(0, -1) + "?" : code + "?") + "') marks a candidate that is not yet confirmed.";
    if (!TERMS[id]) TERMS[id] = { term: name, short: expl, long: longText };
    OT_BY_CODE[code] = { code: code, name: name, expl: expl, id: id };
    OT_BY_NAME[name.toLowerCase()] = OT_BY_CODE[code];
    addAlias(name, id, false);
    addAlias(name + " candidate", id, false);
    (o[3] || []).forEach(function (a) { addAlias(a, id, false); OT_BY_NAME[a.toLowerCase()] = OT_BY_CODE[code]; });
    if (!CODE_EXCLUDE[code]) {
      CODES[code] = id;
      var cand = code === "Y*O" ? "Y*?" : code.length > 1 ? code.slice(0, -1) + "?" : null;
      if (code === "Pl") cand = "Pl?";
      if (cand && !CODES[cand]) CODES[cand] = id;
    }
  });

  // Single letters whose meaning depends on case (overview table headers, unit spans).
  CODES.M = "absolute_magnitude";
  CODES.V = "apparent_magnitude";
  CODES.m = "metre";
  CODES.K = "kelvin";
  CODES["Δ"] = "delta";

  // ================================================================== lookup
  var UNIT_TAIL = /(?:,|\s)\s*(?:km\/s|m\/s\^?2|m\/s²|kg|km|hrs?|h|d|y|yr|k|deg|°|w\/m\^?2|rad\/s|g\/cm\^?3|km\^?3\/s\^?2|ly|pc|au|mas|mas\/yr|%|bar|rp|f)$/;

  function tryKey(k) { return k && Object.prototype.hasOwnProperty.call(ALIAS, k) ? ALIAS[k] : null; }

  function regexFallback(k) {
    if (/^m\s?[-+]?\s?\d+(\.\d+)?$/.test(k)) return "abs_mag_line";
    if (/^v\s?[-+]?\d+(\.\d+)?$/.test(k)) return "apparent_magnitude";
    if (/^mag\s?[-+]?\d/.test(k)) return "apparent_magnitude";
    if (/^[\d,]+\s?k$/.test(k)) return "temperature_scale";
    if (/^\d{1,2}\s?h$/.test(k)) return "right_ascension";
    if (/^\d+\s?×\s?seen$/.test(k)) return "observations";
    if (/^class [obafgkm]$/.test(k)) return "spectral_class";
    if (/^b-v\s?[-+]?\d/.test(k)) return "color_index";
    if (/^median of \d+ measurements?$/.test(k)) return "median";
    if (/^about [\d,]+ k$/.test(k)) return "temperature";
    if (/^\d+(\.\d+)?\s?° field$/.test(k)) return "field_of_view";
    // Wikidata external identifiers ("GND ID", "Freebase ID", "Krugosvet article", "IMDb keyword"…)
    if (/\S\s(id|ids|identifier|entry|tag|keyword|notation|code|article|uri|slug)$/.test(k)) return "external_id";
    if (/\b(id|identifier) (in|on|at|for) the\b/.test(k)) return "external_id";
    return null;
  }

  function lookup(text) {
    if (text == null) return null;
    var raw = String(text).trim();
    if (!raw) return null;
    // Exact-case SIMBAD object-type codes ("PM*", "SB*", "Rad"…).
    var rc = raw.replace(/\s+/g, " ");
    if (Object.prototype.hasOwnProperty.call(CODES, rc)) return CODES[rc];
    var k0 = key(raw);
    if (!k0) return null;
    var tries = [];
    var push = function (s) {
      s = String(s || "").replace(/\s+/g, " ").replace(/^[\s:=,;·]+|[\s:=,;·]+$/g, "").trim();
      if (s && tries.indexOf(s) < 0) tries.push(s);
    };
    push(k0);
    var a = k0.replace(/[↗↑↓←→⇧⇩⇨⇦]/g, " ").replace(/\bbrowse( papers)?\b.*$/, "");
    push(a);
    var b = a.replace(/\s*·.*$/, "");                      // "Photometry · 9 bands", "Hierarchy · 3"
    push(b);
    var c = b.replace(/\(?\s*x\s?10\^?-?\d+\s*\)?/g, " ");  // "Mass x 10^26 (kg)"
    push(c);
    var d = c.replace(/\([^()]*\)/g, " ").replace(/\[[^\]]*\]$/, " ");   // "(kg)", "(1-5)", "(hotter ← → cooler)"
    push(d);
    var e = d, prev;
    do { prev = e; e = e.replace(UNIT_TAIL, "").trim(); } while (e !== prev && e);
    push(e);
    var f = e.replace(/^(min|minimum|max|maximum)\s+/, "");
    push(f);
    var g = f.replace(/\s+\d+$/, "");                       // trailing counts "Identifiers 36"
    push(g);
    var i, id;
    for (i = 0; i < tries.length; i++) { id = tryKey(tries[i]); if (id) return id; }
    // Plurals: "Sessions", "Velocities" -> singular, only when the singular is known.
    for (i = 0; i < tries.length; i++) {
      var t = tries[i];
      if (/ies$/.test(t) && (id = tryKey(t.replace(/ies$/, "y")))) return id;
      if (/[^su]s$/.test(t) && t.length > 4 && (id = tryKey(t.slice(0, -1)))) return id;
    }
    for (i = 0; i < tries.length; i++) { id = regexFallback(tries[i]); if (id) return id; }
    return null;
  }

  // ================================================================== explainValue
  function fmtNum(n) {
    if (n >= 100) { var p = Math.pow(10, Math.floor(Math.log10(n)) - 1); return (Math.round(n / p) * p).toLocaleString("en-US"); }
    if (n >= 10) return String(Math.round(n));
    return String(Math.round(n * 10) / 10);
  }

  // ---------------------------------------------------------------- spectral types
  var SPEC = {
    O: ["blue", "30,000 K and hotter", "the hottest, most massive and rarest stars"],
    B: ["blue-white", "about 10,000–30,000 K", "hot, massive stars such as Rigel and Spica"],
    A: ["white", "about 7,500–10,000 K", "like Sirius and Vega"],
    F: ["yellow-white", "about 6,000–7,500 K", "like Procyon and Polaris"],
    G: ["yellow", "about 5,200–6,000 K", "like the Sun, which is G2"],
    K: ["orange", "about 3,700–5,200 K", "like Arcturus and Aldebaran"],
    M: ["red", "about 2,400–3,700 K", "the coolest ordinary stars, like Betelgeuse and most red dwarfs"],
    L: ["dark red", "about 1,300–2,400 K", "very cool dwarfs, many of them brown dwarfs"],
    T: ["very dark red", "about 550–1,300 K", "cool brown dwarfs with methane in their atmospheres"],
    Y: ["very dark", "below about 550 K", "the coldest brown dwarfs"],
    W: ["blue", "very hot (above about 30,000 K)", "Wolf-Rayet stars: massive stars that have blown off their outer hydrogen"],
    C: ["deep red", "about 2,500–5,000 K", "carbon stars: cool giants with more carbon than oxygen"],
    S: ["red", "about 2,500–3,500 K", "S-type stars: cool giants between M giants and carbon stars"]
  };
  // Rough main-sequence temperatures by spectral index (class*10 + subclass), for an "about X K" hint.
  var MS_TEFF = [[5, 41400], [9, 32500], [10, 31400], [15, 15700], [20, 9700], [25, 8100], [30, 7200], [35, 6500],
    [40, 5900], [42, 5770], [45, 5600], [50, 5250], [55, 4400], [60, 3850], [65, 3050], [69, 2400]];
  var ORDER = "OBAFGKM";
  function msTeff(cls, sub) {
    var ci = ORDER.indexOf(cls);
    if (ci < 0 || sub == null || isNaN(sub)) return null;
    var x = ci * 10 + sub;
    if (x < MS_TEFF[0][0] || x > MS_TEFF[MS_TEFF.length - 1][0]) return null;
    for (var i = 0; i < MS_TEFF.length - 1; i++) {
      var p = MS_TEFF[i], q = MS_TEFF[i + 1];
      if (x >= p[0] && x <= q[0]) return Math.round((p[1] + (q[1] - p[1]) * (x - p[0]) / (q[0] - p[0])) / 100) * 100;
    }
    return null;
  }

  var LUM = {
    "0": ["hypergiant", "one of the most luminous and rarest stars known, shedding mass rapidly"],
    "Ia+": ["hypergiant", "one of the most luminous and rarest stars known, shedding mass rapidly"],
    "Ia": ["luminous supergiant", "an enormous, extremely bright star late in a massive star's life"],
    "Iab": ["supergiant of intermediate luminosity", "an enormous, very bright star late in a massive star's life"],
    "Ib": ["less luminous supergiant", "a large, very bright star late in a massive star's life (fainter than class Ia)"],
    "I": ["supergiant", "an enormous, extremely bright star late in a massive star's life"],
    "II": ["bright giant", "between a giant and a supergiant in size and brightness"],
    "III": ["giant", "an older star that has used up the hydrogen in its core and swollen to roughly 10–100 times the Sun's size"],
    "IV": ["subgiant", "a star that has just finished burning hydrogen in its core and is starting to swell into a giant"],
    "V": ["main-sequence star (dwarf)", "a star in the long, stable middle of its life, fusing hydrogen in its core, like the Sun"],
    "VI": ["subdwarf", "slightly fainter than main-sequence stars of the same colour, usually old and poor in heavy elements"],
    "VII": ["white dwarf", "the small, dense remnant of a dead Sun-like star"]
  };
  var LUM_RE = /^[\s\-]*(0|Ia\+|Iab|Ia|Ib|VII|VI|IV|V|III|II|I)(ab|a|b)?(?:\s*([\-\/])\s*(Iab|Ia|Ib|VII|VI|IV|V|III|II|I|ab|a|b)(ab|a|b)?)?/;

  function lumText(m) {
    var c1 = m[1], s1 = m[2], sep = m[3], c2 = m[4], s2 = m[5];
    var L1 = LUM[c1];
    if (!L1) return null;
    var label = c1 + (s1 || "") + (sep ? sep + c2 + (s2 || "") : "");
    var txt;
    if (sep && c2) {
      var second = /^(ab|a|b)$/.test(c2) ? c1.replace(/(ab|a|b)$/, "") + c2 : c2;
      var L2 = LUM[second] || LUM[second.replace(/(ab|a|b)$/, "")];
      txt = label + ": between " + L1[0] + " and " + (L2 ? L2[0] : second) + (sep === "/" ? "; the classifier could not decide between the two" : "");
      if (L1[0] === (L2 && L2[0])) txt = label + ": " + L1[0] + " — " + L1[1];
    } else {
      txt = label + ": " + L1[0] + " — " + L1[1];
    }
    if (s1 && !/^I[ab]/.test(c1 + s1)) {
      txt += "; '" + s1 + "' marks the " + (s1 === "a" ? "brighter" : s1 === "b" ? "fainter" : "middle") + " part of the class";
    }
    return txt + ".";
  }

  var ELEMENT_NAMES = { Fe: "iron", CN: "cyanogen (CN) molecule", Ba: "barium", CH: "CH molecule", C2: "carbon (C₂)", Sr: "strontium",
    Ca: "calcium", Mg: "magnesium", Si: "silicon", Cr: "chromium", Eu: "europium", He: "helium", Hg: "mercury", Mn: "manganese", N: "nitrogen", C: "carbon" };

  function suffixNotes(rest) {
    var notes = [], other = "", s = rest, m, guard = 0;
    var add = function (t) { if (notes.indexOf(t) < 0) notes.push(t); };
    while (s.length && guard++ < 60) {
      if ((m = s.match(/^[\s,;.]+/))) { s = s.slice(m[0].length); continue; }
      if ((m = s.match(/^\(\s*(e|n|f|nn|N)\s*\)/i))) {
        var inner = m[1].toLowerCase();
        add(inner === "e" ? "(e): weak or variable emission lines" : inner === "f" ? "(f): weak emission lines of ionised helium and nitrogen (an O-star feature)" : "(" + inner + "): slightly broadened lines from fairly fast rotation");
        s = s.slice(m[0].length); continue;
      }
      if ((m = s.match(/^\(([^)]{2,})\)/))) { add("remark: " + m[1].trim()); s = s.slice(m[0].length); continue; }
      if ((m = s.match(/^Hg\s*Mn/i))) { add("HgMn: a mercury-manganese star, a chemically peculiar hot star with strong mercury and manganese lines"); s = s.slice(m[0].length); continue; }
      if ((m = s.match(/^COMP/i))) { add("COMP: composite spectrum, the mixed light of two or more stars"); s = s.slice(m[0].length); continue; }
      if ((m = s.match(/^SB\d?/))) { add("SB: spectroscopic binary — the spectrum shows it is a close pair of stars"); s = s.slice(m[0].length); continue; }
      if ((m = s.match(/^VB/))) { add("VB: visual binary — a pair that can be seen as two stars in a telescope"); s = s.slice(m[0].length); continue; }
      if ((m = s.match(/^var/i))) { add("var: the spectrum or brightness varies"); s = s.slice(m[0].length); continue; }
      if ((m = s.match(/^(Fe|CN|Ba|CH|C2|Sr|Ca|Mg|Si|Cr|Eu|He|N|C)\s?([\-+]?\d+(?:\.\d+)?)(\+|:)?/))) {
        var el = m[1], v = parseFloat(m[2]);
        var nm = ELEMENT_NAMES[el] || el;
        if (el === "Ba") add(m[1] + m[2] + ": barium lines enhanced (strength " + m[2] + " on a 0–5 scale), usually material passed on by a companion star");
        else add(m[1] + m[2] + ": " + nm + " lines " + (v < 0 ? "weaker" : v > 0 ? "stronger" : "normal") + " than usual for the type" +
          (v !== 0 ? " (by " + Math.abs(v) + " step" + (Math.abs(v) === 1 ? "" : "s") + " on the classifier's scale)" : "") +
          (el === "Fe" && v < 0 ? ", i.e. somewhat poor in heavy elements" : ""));
        s = s.slice(m[0].length); continue;
      }
      if ((m = s.match(/^N\s?wk/i))) { add("Nwk: weak nitrogen lines"); s = s.slice(m[0].length); continue; }
      if ((m = s.match(/^(Si|Sr|Cr|Eu|Hg|Mn|He)(?![a-z])/))) { add(m[1] + ": unusually strong " + ELEMENT_NAMES[m[1]] + " lines (a chemically peculiar star)"); s = s.slice(m[0].length); continue; }
      if ((m = s.match(/^wk|^w(?=[a-z\s]|$)/))) { add("w/wk: weak lines"); s = s.slice(m[0].length); continue; }
      if ((m = s.match(/^nn/))) { add("nn: very broad, shallow lines — the star spins extremely fast"); s = s.slice(2); continue; }
      if ((m = s.match(/^n/i))) { add("n: broad ('nebulous') lines caused by fast rotation"); s = s.slice(1); continue; }
      if ((m = s.match(/^e/i))) { add("e: emission lines — bright lines from hot gas around the star, for example a disc"); s = s.slice(1); continue; }
      if ((m = s.match(/^p/i))) { add("p: peculiar spectrum, with unusual features (often odd surface chemistry)"); s = s.slice(1); continue; }
      if ((m = s.match(/^m/))) { add("m: enhanced metal lines (a metallic-line or 'Am' star)"); s = s.slice(1); continue; }
      if ((m = s.match(/^f/i))) { add("f: emission lines of ionised helium and nitrogen, seen in the most luminous O stars"); s = s.slice(1); continue; }
      if ((m = s.match(/^s(?![a-z])/))) { add("s: sharp, narrow lines"); s = s.slice(1); continue; }
      if ((m = s.match(/^v/i))) { add("v: variable"); s = s.slice(1); continue; }
      if ((m = s.match(/^\+\s*\?/))) { add("+?: a companion star may be present"); s = s.slice(m[0].length); continue; }
      if ((m = s.match(/^:/))) { add("':' means the classification is uncertain"); s = s.slice(1); continue; }
      if ((m = s.match(/^\?/))) { add("'?' means the classification is uncertain"); s = s.slice(1); continue; }
      if ((m = s.match(/^\+/))) { add("'+' means slightly beyond the value just before it"); s = s.slice(1); continue; }
      other += s[0]; s = s.slice(1);
    }
    other = other.replace(/[\s\/\-]+/g, " ").trim();
    if (other) notes.push("other notes in the code: " + other);
    return notes;
  }

  var MW_PREFIX = { sd: "sd: subdwarf (fainter than a normal main-sequence star of this colour)", esd: "esd: extreme subdwarf",
    usd: "usd: ultra subdwarf", sg: "sg: subgiant", d: "d: dwarf (main-sequence star)", g: "g: giant", c: "c: supergiant" };
  var WD_LETTERS = { A: "hydrogen lines", B: "neutral helium lines", O: "ionised helium lines", Q: "carbon features",
    Z: "metal lines", C: "no clear lines (a featureless spectrum)", X: "an unclassifiable spectrum", P: "polarised light (a magnetic white dwarf)", H: "a magnetic field without polarisation" };

  function decodeOne(comp) {
    var s = String(comp).trim(), out = [], m;
    if (!s) return null;
    if (/^\?$/.test(s)) return "a companion star of unknown type.";
    if (/^O-rich$/i.test(s)) return "O-rich: oxygen-rich — a cool giant whose atmosphere has more oxygen than carbon (the normal case for M-type giants).";
    s = s.replace(/\bIAB\b/g, "Iab").replace(/\bIA\b/g, "Ia").replace(/\bIB\b/g, "Ib");
    if ((m = s.match(/^(esd|usd|sd|sg|d|g|c)(?=[OBAFGKM])/))) { out.push(MW_PREFIX[m[1]] + "."); s = s.slice(m[1].length); }
    if ((m = s.match(/^D([ABOQZCXPH]+)\s?([0-9]+(?:\.[0-9]+)?)?/))) {
      var letters = m[1].split("").map(function (L) { return WD_LETTERS[L]; }).filter(Boolean);
      var txt = "D" + m[1] + ": white dwarf — the small, dense remnant of a dead Sun-like star" + (letters.length ? ", whose spectrum shows " + letters.join(" and ") : "") + ".";
      if (m[2]) {
        var t = 50400 / parseFloat(m[2]);
        txt += " " + m[2] + ": temperature index (50,400 ÷ index), so about " + (Math.round(t / 1000) * 1000).toLocaleString("en-US") + " K.";
      }
      out.push(txt);
      var restWD = s.slice(m[0].length);
      var nWD = suffixNotes(restWD);
      if (nWD.length) out.push("Extra codes: " + nWD.join("; ") + ".");
      return out.join(" ");
    }
    var cls = null, sub = null;
    if (/^OB/.test(s)) {
      out.push("OB: a hot, massive young star of type O or early B (not classified more precisely); blue, above about 20,000 K.");
      s = s.slice(2);
    } else if ((m = s.match(/^([OBAFGKMLTYWCS])(e(?=\s?\d))?\s?([0-9](?:\.[0-9]+)?)?/))) {
      cls = m[1];
      sub = m[3] != null ? parseFloat(m[3]) : null;
      var info = SPEC[cls];
      out.push(cls + ": " + (info[0] ? info[0] + " star, " : "") + "surface " + info[1] + " (" + info[2] + ").");
      if (m[2]) out.push("e: emission lines from hot gas around the star.");
      s = s.slice(m[0].length);
      var rng = s.match(/^([\-\/])([OBAFGKM])?([0-9](?:\.[0-9]+)?)/);
      if (sub != null) {
        var sentence;
        if (rng) {
          var a1 = cls + m[3], a2 = (rng[2] || cls) + rng[3];
          sentence = m[3] + rng[1] + (rng[2] || "") + rng[3] + ": subclass " + (rng[1] === "/" ? a1 + " or " + a2 + " (the classifier could not decide)" : "between " + a1 + " and " + a2) +
            ", on a 0–9 scale within each class (0 hottest, 9 coolest)";
        } else {
          sentence = m[3] + ": subclass on a 0–9 scale within " + cls + " (0 hottest, 9 coolest)";
        }
        var te = (ORDER.indexOf(cls) >= 0) ? msTeff(cls, sub) : null;
        out.push(sentence + "." + (te ? " A main-sequence star of this subclass is about " + te.toLocaleString("en-US") + " K; giants of the same type are somewhat cooler." : ""));
      }
      if (rng) s = s.slice(rng[0].length);
      if ((m = s.match(/^m\s?([OBAFGKM][0-9.]*)/))) {
        out.push("m" + m[1] + ": its metal lines look like those of " + (/^[AFOMLS]/.test(m[1]) ? "an " : "a ") + m[1] + " star — a metallic-line ('Am') star with unusual surface chemistry.");
        s = s.slice(m[0].length);
      }
      if ((m = s.match(/^\s?:/))) { out.push("':' means the subclass is uncertain."); s = s.slice(m[0].length); }
    } else {
      return null;
    }
    var lm = s.match(LUM_RE);
    if (lm && LUM[lm[1]]) {
      var lt = lumText(lm);
      if (lt) out.push(lt);
      s = s.slice(lm[0].length);
    } else if (cls && ORDER.indexOf(cls) >= 0 && !/^\s*[a-z]/.test(s)) {
      // nothing
    }
    var notes = suffixNotes(s);
    if (notes.length) out.push("Extra codes: " + notes.join("; ") + ".");
    return out.join(" ");
  }

  function explainSpectral(v) {
    var s = String(v == null ? "" : v).replace(/\s+/g, " ").trim();
    if (!s) return null;
    var parts = s.split(/\+(?=\s*(?:[OBAFGKMDW]|\?))/).map(function (p) { return p.trim(); }).filter(Boolean);
    var decoded = parts.map(decodeOne);
    if (!decoded[0]) return null;
    if (parts.length === 1) return s + " — " + decoded[0];
    return s + " — a combined spectrum of " + parts.length + " stars. " + decoded.map(function (d, i) {
      return "(" + (i + 1) + ") " + parts[i] + ": " + (d || "unrecognised type.");
    }).join(" ");
  }

  function explainLumClass(v) {
    var s = String(v == null ? "" : v).trim().replace(/\bIAB\b/g, "Iab").replace(/\bIA\b/g, "Ia").replace(/\bIB\b/g, "Ib");
    if (!s) return null;
    if (/^D$/i.test(s) || s === "VII") return s + ": white dwarf — the small, dense remnant of a dead Sun-like star.";
    var m = s.match(LUM_RE);
    if (!m || !LUM[m[1]] || m.index !== 0) return null;
    if (s.slice(m[0].length).trim()) return null;
    return lumText(m);
  }

  // ---------------------------------------------------------------- object types
  var OT_PREFIX = [
    [/^1?RX(?:S)?\s?J/i, "X-ray source", "the name comes from the ROSAT X-ray satellite's all-sky survey (RX = ROSAT X-ray), so it was detected as a source of X-rays, a sign of very hot gas."],
    [/^(?:2MASS|2MASX)/i, "infrared source", "the name comes from 2MASS, a near-infrared survey of the whole sky."],
    [/^IRAS/i, "infrared source", "the name comes from IRAS, an infrared satellite that surveyed the sky in 1983."],
    [/^WISE/i, "infrared source", "the name comes from WISE, NASA's mid-infrared survey satellite."],
    [/^(?:[1-4]XMM|XMM)/i, "X-ray source", "the name comes from the XMM-Newton X-ray telescope's catalogue."],
    [/^CXOU?/i, "X-ray source", "the name comes from the Chandra X-ray Observatory's catalogue."],
    [/^(?:NVSS|FIRST|VLSS)/i, "radio source", "the name comes from a radio survey made with the Very Large Array."]
  ];

  function explainOtype(v) {
    var s = String(v == null ? "" : v).trim().replace(/\s+/g, " ");
    if (!s) return null;
    var o = OT_BY_CODE[s];
    var cand = false;
    if (!o && /\?$/.test(s) && s.length > 1) {
      var base = s.slice(0, -1);
      o = OT_BY_CODE[base + "*"] || OT_BY_CODE[base] || OT_BY_CODE[base + "O"];
      cand = !!o;
    }
    if (!o) {
      var low = s.toLowerCase();
      if (/ candidate$/.test(low)) { o = OT_BY_NAME[low.replace(/ candidate$/, "")]; cand = !!o; }
      else o = OT_BY_NAME[low];
    }
    if (o) {
      if (!cand) return o.name + " (" + o.code + "): " + o.expl;
      var nm = o.name.toLowerCase().replace(/\bx-ray\b/, "X-ray").replace(/\b(cvn|cep|sct|dra|dor|phe)\b/g, function (w) { return w.charAt(0).toUpperCase() + w.slice(1); });
      return s + ": probably " + (/^[aeiou]/.test(nm) ? "an " : "a ") + nm + ", but not yet confirmed. " + o.expl;
    }
    for (var i = 0; i < OT_PREFIX.length; i++) {
      if (OT_PREFIX[i][0].test(s)) return s + ": " + OT_PREFIX[i][1] + " — " + OT_PREFIX[i][2];
    }
    return null;
  }

  // ---------------------------------------------------------------- observing conditions
  var BORTLE = {
    1: ["Excellent dark-sky site", "the Milky Way casts faint shadows and the zodiacal light is obvious; stars to about magnitude 7.6–8.0 are visible by eye. Found only in remote places."],
    2: ["Typical truly dark site", "the Milky Way shows detailed structure and clouds look like black holes in the starry sky; stars to about magnitude 7.1–7.5."],
    3: ["Rural sky", "some light pollution on the horizon, but the Milky Way still looks complex; stars to about magnitude 6.6–7.0."],
    4: ["Rural/suburban transition", "light domes over towns are visible in several directions; the Milky Way is still impressive overhead but lacks detail; stars to about 6.1–6.5."],
    5: ["Suburban sky", "the Milky Way is weak or invisible near the horizon and washed out overhead; stars to about magnitude 5.6–6.0."],
    6: ["Bright suburban sky", "the sky glows grey-white near the horizon and the Milky Way is visible only near the zenith, if at all; stars to about magnitude 5.1–5.5. Typical of the outer suburbs of a large city, such as the edge of the Dallas–Fort Worth area."],
    7: ["Suburban/urban transition", "the whole sky has a greyish-white hue, the Milky Way is invisible and strong light sources are seen in all directions; stars to about magnitude 4.6–5.0."],
    8: ["City sky", "the sky glows white, grey or orange and you can read by it; only well-known constellations are recognisable; stars to about 4.1–4.5."],
    9: ["Inner-city sky", "the whole sky is brightly lit; only the Moon, planets and a few of the brightest stars show; stars to about magnitude 4.0 at best."]
  };

  var SEEING = {
    1: "very poor: the air is very turbulent; stars boil and planets show almost no detail.",
    2: "poor: strong shimmer; only the largest planetary features (Jupiter's main cloud belts, Saturn's rings) hold steady for moments.",
    3: "average: some shimmer; moderate magnification works and planets show their main features, with moments of finer detail.",
    4: "good: steady air; fine detail on planets is visible and close double stars split cleanly.",
    5: "excellent: very steady air; high magnification gives sharp views. Rare at most sites."
  };
  var TRANSPARENCY = {
    1: "very poor: thick haze or thin cloud; only the brightest stars and planets show.",
    2: "poor: hazy; faint stars and the Milky Way are washed out.",
    3: "average: some haze or humidity; bright objects are fine, faint galaxies and nebulae are subdued.",
    4: "good: clear air; faint stars down to your site's limit are visible.",
    5: "excellent: very clear, dry air; the faintest stars your sky's darkness allows are visible."
  };

  function firstInt(v, lo, hi) {
    var m = String(v == null ? "" : v).match(/\d+/);
    if (!m) return null;
    var n = parseInt(m[0], 10);
    return n >= lo && n <= hi ? n : null;
  }

  // ---------------------------------------------------------------- magnitudes and bands
  function explainMag(v) {
    var mval = parseFloat(String(v == null ? "" : v).replace(/[−–]/g, "-").replace(/[^\d.+\-eE]/g, ""));
    if (!isFinite(mval)) return null;
    var what;
    if (mval < -15) what = "Sun-like brightness (the Sun is −26.7).";
    else if (mval < -6) what = "about as bright as the Moon (the full Moon is −12.7).";
    else if (mval < -3) what = "brighter than any star; only the Sun, the Moon, Venus and at times Jupiter or Mars get this bright.";
    else if (mval < -1) what = "in the range of Sirius (−1.46), the brightest star, and of Jupiter and Mars at their best. Easily seen even from a city.";
    else if (mval < 1.5) what = "one of the brightest objects in the night sky, like Vega (0.0) or Betelgeuse (about 0.5). Easily seen even from a city.";
    else if (mval < 3) what = "a bright star, like Polaris (2.0) or the stars of the Big Dipper. Visible from most towns and cities.";
    else if (mval < 4.5) what = "a moderately faint naked-eye star, visible from a suburb on a clear night.";
    else if (mval < 6.5) what = "near the limit of the naked eye: visible from dark rural sites, difficult or impossible from a bright suburban (Bortle 6) sky, where the limit is about 5–5.5.";
    else if (mval < 9) what = "too faint for the naked eye; easy in binoculars.";
    else if (mval < 13) what = "needs a small telescope.";
    else if (mval < 18) what = "needs a large amateur telescope or long-exposure photography.";
    else what = "only reachable with professional telescopes.";
    var ratio = Math.pow(10, 0.4 * mval);
    var cmp;
    if (Math.abs(mval) < 0.25) cmp = "About as bright as Vega (magnitude 0).";
    else if (mval > 0) cmp = "About " + fmtNum(ratio) + " times fainter than a magnitude-0 star such as Vega.";
    else cmp = "About " + fmtNum(1 / ratio) + " times brighter than a magnitude-0 star such as Vega.";
    var shown = String(Math.round(mval * 100) / 100).replace("-", "−");
    return "Magnitude " + shown + ": " + what + " " + cmp + " Smaller numbers are brighter; each step of 1 is about 2.5 times in brightness.";
  }

  var BANDS = {
    U: "U (ultraviolet): near-ultraviolet light around 365 nm, just beyond violet; barely visible to the eye.",
    B: "B (blue): blue light around 445 nm.",
    V: "V (visual): green-yellow light around 551 nm, close to the eye's peak sensitivity; the standard 'magnitude'.",
    R: "R (red): red light around 658 nm.",
    I: "I (near-infrared): around 806 nm, just beyond what the eye can see.",
    J: "J: near-infrared around 1.25 micrometres (µm), about twice the wavelength of red light; used by the 2MASS survey.",
    H: "H: near-infrared around 1.65 µm.",
    K: "K: near-infrared around 2.2 µm; cool stars are especially bright here and dust dims it least.",
    Ks: "Ks ('K short'): near-infrared around 2.15 µm, the version of K used by the 2MASS survey.",
    L: "L: infrared around 3.5 µm.",
    M: "M: infrared around 4.8 µm.",
    N: "N: mid-infrared around 10 µm.",
    G: "G: the Gaia satellite's broad band, covering about 330–1050 nm (violet to near-infrared). For most stars G is close to V; red stars are brighter in G (smaller number).",
    BP: "BP (Gaia blue photometer): about 330–680 nm, the blue part of Gaia's light.",
    RP: "RP (Gaia red photometer): about 630–1050 nm, the red part of Gaia's light.",
    u: "u (SDSS): ultraviolet around 355 nm, in the Sloan Digital Sky Survey filter system.",
    g: "g (SDSS): blue-green around 470 nm.",
    r: "r (SDSS): red around 620 nm.",
    i: "i (SDSS): deep red / near-infrared around 750 nm.",
    z: "z (SDSS): near-infrared around 890 nm.",
    W1: "W1 (WISE): infrared around 3.4 µm.",
    W2: "W2 (WISE): infrared around 4.6 µm.",
    W3: "W3 (WISE): mid-infrared around 12 µm.",
    W4: "W4 (WISE): mid-infrared around 22 µm."
  };

  function explainBand(v) {
    var s = String(v == null ? "" : v).trim();
    if (!s) return null;
    if (BANDS[s]) return BANDS[s];
    var t = s.replace(/^gaia\s*/i, "").replace(/\s*\(gaia\)$/i, "").replace(/^G[_\s]?(BP|RP)$/i, "$1").replace(/\s*(mag|band|filter)$/i, "").trim();
    if (BANDS[t]) return BANDS[t];
    var up = t.toUpperCase();
    if (up === "BP" || up === "RP" || /^W[1-4]$/.test(up)) return BANDS[up];
    if (up === "KS") return BANDS.Ks;
    return null;
  }

  function explainValue(kind, value) {
    if (value == null || value === "") return null;
    var k = String(kind || "").toLowerCase().replace(/[\s\-]+/g, "_");
    try {
      switch (k) {
        case "spectral_type": case "sptype": case "sp_type": case "spectral": return explainSpectral(value);
        case "otype": case "object_type": case "otype_desc": return explainOtype(value);
        case "luminosity_class": case "lum_class": return explainLumClass(value);
        case "bortle": {
          var b = firstInt(value, 1, 9);
          if (b == null) return null;
          return "Bortle " + b + " — " + BORTLE[b][0] + ": " + BORTLE[b][1] + " (1 = darkest, 9 = inner city.)";
        }
        case "seeing": {
          var se = firstInt(value, 1, 5);
          if (se == null) return null;
          return "Seeing " + se + "/5 — " + SEEING[se] + " (MO Pro scale: 1 worst, 5 best.)";
        }
        case "transparency": {
          var tr = firstInt(value, 1, 5);
          if (tr == null) return null;
          return "Transparency " + tr + "/5 — " + TRANSPARENCY[tr] + " (MO Pro scale: 1 worst, 5 best.)";
        }
        case "mag": case "magnitude": case "apparent_magnitude": return explainMag(value);
        case "band": case "filter": return explainBand(value);
        default: return null;
      }
    } catch (err) {
      return null;
    }
  }

  var api = { terms: TERMS, lookup: lookup, explainValue: explainValue };
  if (ROOT.MO_GLOSSARY_DEBUG) ROOT.MO_GLOSSARY_DEBUG = { collisions: COLLISIONS, aliases: ALIAS, codes: CODES };
  ROOT.MO_GLOSSARY = api;
})();
