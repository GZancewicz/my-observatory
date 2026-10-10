// My Observatory viewer. Data arrives as globals so the page works from file://:
// window.MO_DATA (data/bundle.js), window.MO_EXTRA[path] (data/<path>/extra.js, loaded on demand),
// window.MO_SKY (data/sky/boundaries.js) and window.MO_CHARTS (assets/charts.js, the overview).
(() => {
  const CATEGORIES = {
    stars: "Stars", planets: "Planets", moons: "Moons", constellations: "Constellations",
    satellites: "Satellites", clusters: "Clusters", nebulae: "Nebulae", galaxies: "Galaxies",
    comets: "Comets", "minor-bodies": "Minor bodies", other: "Other",
  };
  // Objects that move across the sky: no fixed position for the sky viewer.
  const MOVING = new Set(["planets", "moons", "satellites", "comets", "minor-bodies"]);
  const $ = (s) => document.querySelector(s);
  const state = {
    objects: [], category: "all", query: "", sort: "last", cache: {},
    seq: 0, overview: false, extraLoads: {}, aladin: null, skyObserver: null,
  };

  // ---------- formatting ----------
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (v, d = 2) => {
    if (v === null || v === undefined || v === "" || Number.isNaN(+v)) return "—";
    const n = +v;
    if (Math.abs(n) >= 1e6 || (Math.abs(n) < 1e-3 && n !== 0)) return n.toExponential(2);
    return n.toLocaleString(undefined, { maximumFractionDigits: d });
  };
  const ra = (deg) => {
    if (deg == null) return "—";
    let h = deg / 15, m = (h % 1) * 60, s = (m % 1) * 60;
    return `${Math.floor(h)}h ${String(Math.floor(m)).padStart(2, "0")}m ${s.toFixed(1).padStart(4, "0")}s`;
  };
  const dec = (deg) => {
    if (deg == null) return "—";
    const sign = deg < 0 ? "−" : "+", a = Math.abs(deg);
    const d = Math.floor(a), m = Math.floor((a - d) * 60), s = ((a - d) * 60 - m) * 60;
    return `${sign}${d}° ${String(m).padStart(2, "0")}′ ${s.toFixed(0).padStart(2, "0")}″`;
  };
  const compass = (az) => az == null || Number.isNaN(az) ? "" :
    ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"][Math.round(az / 22.5) % 16];
  const qty = (q) => {
    if (q == null) return "—";
    if (typeof q !== "object") return esc(q);
    let s = `${num(q.value, 3)}<span class="u">${esc(q.unit || "")}</span>`;
    if (q.plus != null && (q.plus || q.minus)) {
      s += q.plus === q.minus ? `<span class="u">± ${num(q.plus, 3)}</span>`
        : `<span class="u">+${num(q.plus, 3)} / −${num(q.minus, 3)}</span>`;
    }
    return s;
  };
  const stars = (r) => r == null ? '<span class="muted">—</span>' :
    `<span class="stars" title="${r} of 5">${"★".repeat(Math.floor(r))}${r % 1 ? "½" : ""}<span class="off">${"★".repeat(5 - Math.ceil(r))}</span></span>`;
  const scorePill = (v) => {
    if (!v) return '<span class="muted">—</span>';
    const n = parseInt(v, 10);
    const cls = v.includes("/") ? (n >= 4 ? "good" : n >= 3 ? "warn" : "bad") : (n <= 4 ? "good" : n <= 6 ? "warn" : "bad");
    return `<span class="pill ${cls}">${esc(v)}</span>`;
  };
  // Approximate star colour from effective temperature (Tanner Helland's blackbody fit).
  const teffColor = (t) => {
    if (!t) return null;
    t = Math.min(Math.max(t, 1000), 40000) / 100;
    const c = (v) => Math.round(Math.min(255, Math.max(0, v)));
    const r = t <= 66 ? 255 : c(329.698727446 * Math.pow(t - 60, -0.1332047592));
    const g = t <= 66 ? c(99.4708025861 * Math.log(t) - 161.1195681661) : c(288.1221695283 * Math.pow(t - 60, -0.0755148492));
    const b = t >= 66 ? 255 : t <= 19 ? 0 : c(138.5177312231 * Math.log(t - 10) - 305.0447927307);
    return `rgb(${r},${g},${b})`;
  };
  const fileUrl = (o, f) => `data/${o.path}/${f}`;
  // SIMBAD prefixes ids with "* ", "NAME " etc. and pads with double spaces.
  const cleanId = (id) => id ? String(id).replace(/^(NAME|\*\*|\*|V\*|PM\*|Em\*)\s+/, "").replace(/\s+/g, " ").trim() : id;
  const blank = (v) => v == null || v === "" || (typeof v === "string" && !v.trim()) || (typeof v === "number" && Number.isNaN(v));
  // Only http(s) links from harvested data become hrefs.
  const safeUrl = (u) => /^https?:\/\//i.test(String(u || "").trim()) ? String(u).trim() : "";
  const extLink = (u, label) => safeUrl(u) ? `<a href="${esc(safeUrl(u))}" target="_blank" rel="noopener">${label}</a>` : label;
  // Plain numbers for data tables: no thousands separators (years, epochs), limited precision.
  const rawNum = (n) => {
    if (Number.isInteger(n)) return String(n);
    if (Math.abs(n) >= 1e7 || (Math.abs(n) < 1e-3 && n !== 0)) return n.toExponential(3);
    return String(+n.toPrecision(7));
  };
  const pick = (obj, keys) => {
    if (!obj) return null;
    for (const k of keys) if (!blank(obj[k])) return obj[k];
    return null;
  };
  const asList = (v) => v == null ? [] : Array.isArray(v) ? v : [v];
  // ICRS (J2000) to galactic l/b, degrees.
  const galactic = (raDeg, decDeg) => {
    const r = Math.PI / 180, aG = 192.85948 * r, dG = 27.12825 * r;
    const a = raDeg * r, d = decDeg * r;
    const sb = Math.sin(d) * Math.sin(dG) + Math.cos(d) * Math.cos(dG) * Math.cos(a - aG);
    const y = Math.cos(d) * Math.sin(a - aG);
    const x = Math.sin(d) * Math.cos(dG) - Math.cos(d) * Math.sin(dG) * Math.cos(a - aG);
    const l = ((122.93192 - Math.atan2(y, x) / r) % 360 + 360) % 360;
    return { l, b: Math.asin(sb) / r };
  };
  const bib = (b) => b ? `<a href="https://ui.adsabs.harvard.edu/abs/${encodeURIComponent(String(b).trim())}" target="_blank" rel="noopener">${esc(String(b).trim())}</a>` : "—";
  const paras = (text) => String(text || "").split(/\n+/).filter((p) => p.trim()).map((p) => `<p>${esc(p.trim())}</p>`).join("");

  // ---------- list ----------
  const sorters = {
    last: (a, b) => (b.last_observed || "").localeCompare(a.last_observed || ""),
    name: (a, b) => a.name.localeCompare(b.name),
    mag: (a, b) => (a.v_mag ?? 99) - (b.v_mag ?? 99),
    dist: (a, b) => (a.distance_ly ?? 1e12) - (b.distance_ly ?? 1e12),
    rating: (a, b) => (b.best_rating ?? -1) - (a.best_rating ?? -1),
    count: (a, b) => b.observations - a.observations,
  };

  function matches(o) {
    if (state.category !== "all" && o.category !== state.category) return false;
    if (!state.query) return true;
    const hay = [o.name, o.designation, o.constellation, o.description, o.app_type, o.spectral_type]
      .filter(Boolean).join(" ").toLowerCase();
    return state.query.toLowerCase().split(/\s+/).every((w) => hay.includes(w));
  }

  function renderChips() {
    const counts = {};
    state.objects.forEach((o) => (counts[o.category] = (counts[o.category] || 0) + 1));
    const cats = ["all", ...Object.keys(CATEGORIES).filter((c) => counts[c])];
    $("#chips").innerHTML = cats.map((c) =>
      `<button class="chip" data-cat="${c}" aria-pressed="${state.category === c}">${c === "all" ? "All" : CATEGORIES[c]}<span class="n">${c === "all" ? state.objects.length : counts[c]}</span></button>`).join("");
  }

  function renderList() {
    const current = location.hash.slice(1);
    const shown = state.objects.filter(matches).sort(sorters[state.sort]);
    const groups = {};
    shown.forEach((o) => (groups[o.category] ||= []).push(o));
    let html = "";
    for (const cat of Object.keys(CATEGORIES)) {
      if (!groups[cat]) continue;
      html += `<div class="group-title">${CATEGORIES[cat]} · ${groups[cat].length}</div>`;
      html += groups[cat].map((o) => {
        const des = cleanId(o.designation);
        const sub = [des && des !== o.name ? des : null, o.app_type, o.constellation]
          .filter(Boolean).join(" · ");
        const right = [o.v_mag != null ? `mag ${num(o.v_mag, 1)}` : "", `${o.observations}× seen`].filter(Boolean).join("<br>");
        const img = o.thumb ? `<img loading="lazy" src="${esc(fileUrl(o, o.thumb))}" alt="">` : '<div class="noimg"></div>';
        return `<a class="item" href="#${esc(o.path)}" aria-current="${current === o.path}">${img}<div><div class="t">${esc(o.name)}</div><div class="s">${esc(sub)}</div></div><div class="r">${right}</div></a>`;
      }).join("");
    }
    $("#list").innerHTML = html || '<div class="empty">No objects match.</div>';
  }

  // ---------- data loading ----------
  async function loadObject(path) {
    if (window.MO_DATA && window.MO_DATA.objects[path]) return window.MO_DATA.objects[path];
    if (!state.cache[path]) {
      const r = await fetch(`data/${path}/object.json`);
      if (!r.ok) throw new Error(`${r.status} loading ${path}`);
      state.cache[path] = await r.json();
    }
    return state.cache[path];
  }

  // Papers and the full article live in data/<path>/extra.js; inject it once per object.
  function loadExtra(path) {
    const have = () => window.MO_EXTRA && window.MO_EXTRA[path];
    if (have()) return Promise.resolve(have());
    if (state.extraLoads[path]) return state.extraLoads[path];
    const p = new Promise((resolve, reject) => {
      const tag = document.createElement("script");
      tag.src = `data/${path}/extra.js`;
      tag.async = true;
      tag.onload = () => have() ? resolve(have()) : reject(new Error("not harvested yet"));
      tag.onerror = () => { tag.remove(); reject(new Error("not harvested yet")); };
      document.head.appendChild(tag);
    });
    state.extraLoads[path] = p;
    p.catch(() => { delete state.extraLoads[path]; });   // allow a retry on the next visit
    return p;
  }

  // ---------- generic tables ----------
  const COL_NAMES = {
    bibcode: "Paper", mespm: "", pmra: "pm RA", pmde: "pm Dec", pmdec: "pm Dec", plx: "Parallax",
    sptype: "Spectral type", teff: "Teff", log_g: "log g", fe_h: "[Fe/H]", vsini: "v sin i",
  };
  const colName = (k) => COL_NAMES[k] || String(k).replace(/__+/g, " ").replace(/_/g, " ").trim();
  function cell(k, v) {
    if (blank(v)) return '<span class="muted">—</span>';
    if (typeof v === "number") return rawNum(v);
    if (typeof v === "boolean") return v ? "yes" : "no";
    if (typeof v === "object") return "unit" in v || "value" in v ? qty(v) : `<span class="mono">${esc(JSON.stringify(v))}</span>`;
    const s = String(v).trim();
    if (/bibcode|^ref(erence)?$/i.test(k) && /^\d{4}\S{10,}$/.test(s)) return bib(s);
    if (safeUrl(s)) return extLink(s, esc(s));
    return esc(s.replace(/\s+/g, " "));
  }
  // Rows of objects as a table; long tables show the first `limit` rows and a "show all" button.
  function dataTable(rows, { limit = 10, skip = ["oidref", "oid"], unit = "rows" } = {}) {
    rows = asList(rows).filter((r) => r && typeof r === "object");
    if (!rows.length) return "";
    const cols = [];
    rows.forEach((r) => Object.keys(r).forEach((k) => { if (k && !skip.includes(k) && !cols.includes(k)) cols.push(k); }));
    const used = cols.filter((k) => rows.some((r) => !blank(r[k])));
    if (!used.length) return "";
    const body = rows.map((r, i) =>
      `<tr${i >= limit ? ' class="extra"' : ""}>${used.map((k) => `<td>${cell(k, r[k])}</td>`).join("")}</tr>`).join("");
    return `<div class="clip"><div class="tablewrap"><table><thead><tr>${used.map((k) => `<th>${esc(colName(k))}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table></div>${moreButton(rows.length, limit, unit)}</div>`;
  }
  const moreButton = (n, limit, unit) => n > limit
    ? `<button type="button" class="more-btn" data-action="more" data-label="Show all ${n} ${unit}" aria-expanded="false">Show all ${n} ${unit}</button>` : "";
  // Two-column label/value table from [label, html] pairs; null values are skipped.
  function kvTable(pairs, cls = "") {
    const rows = pairs.filter(([, v]) => v != null && v !== "").map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${v}</td></tr>`).join("");
    return rows ? `<div class="tablewrap"><table class="kv ${cls}">${rows}</table></div>` : "";
  }
  const section = (id, title, body, extra = "") => body
    ? `<section class="sec" id="sec-${id}"><h2>${title}</h2>${extra}${body}</section>` : "";

  // ---------- detail: hero and key facts ----------
  function factCard(k, v, extra = "") {
    if (v == null || v === "—" || v === "") return "";
    return `<div class="fact"><div class="k">${esc(k)}</div><div class="v">${v}</div>${extra ? `<div class="x">${extra}</div>` : ""}</div>`;
  }

  const paperCount = (o) => o.papers_count ?? (o.simbad || {}).papers_count ?? (o.simbad || {}).nbref ?? null;

  function keyFacts(o) {
    const s = o.summary || {}, sb = o.simbad || {};
    const color = teffColor(s.teff_k);
    const np = paperCount(o);
    const cards = [
      factCard("Apparent magnitude", s.v_mag != null ? num(s.v_mag, 2) : null,
        s.b_minus_v != null ? `B−V ${num(s.b_minus_v, 2)}` : ""),
      factCard("Absolute magnitude", s.abs_mag != null ? num(s.abs_mag, 2) : null),
      factCard("Distance", s.distance_ly != null ? `${num(s.distance_ly, 1)}<span class="u">ly</span>` : null,
        s.distance_pc != null ? `${num(s.distance_pc, 1)} pc · parallax ${num(sb.plx_value, 2)} mas` : ""),
      factCard("Spectral type", s.spectral_type ? esc(s.spectral_type) : null),
      factCard("Temperature", s.teff_k ? `${color ? `<span class="swatch" style="background:${color};color:${color}"></span>` : ""}${num(s.teff_k, 0)}<span class="u">K</span>` : null),
      factCard("Mass", s.mass ? qty(s.mass) : null),
      factCard("Radius", s.radius ? qty(s.radius) : null),
      factCard("Luminosity", s.luminosity ? qty(s.luminosity) : null),
      factCard("Age", s.age ? qty(s.age) : null),
      factCard("Constellation", s.constellation ? esc(s.constellation) : null),
      factCard("Right ascension", s.ra_deg != null ? ra(s.ra_deg) : null, s.ra_deg != null ? `${num(s.ra_deg, 4)}°` : ""),
      factCard("Declination", s.dec_deg != null ? dec(s.dec_deg) : null, s.dec_deg != null ? `${num(s.dec_deg, 4)}°` : ""),
      factCard("Object type", s.object_type ? esc(s.object_type) : null),
      factCard("Area", s.area ? qty(s.area) : null),
      factCard("Abbreviation", s.abbreviation ? esc(s.abbreviation) : null),
      factCard("Orbital period", s.orbital_period ? qty(s.orbital_period) : null),
      factCard("Rotation period", s.rotation_period ? qty(s.rotation_period) : null),
      factCard("NORAD ID", s.norad_id ?? null),
      factCard("Launched", s.launch_date ? esc(s.launch_date) : null, s.owner ? `Owner: ${esc(s.owner)}` : ""),
      factCard("Orbit", s.apogee_km != null ? `${num(s.perigee_km, 0)}–${num(s.apogee_km, 0)}<span class="u">km</span>` : null,
        s.inclination_deg != null ? `${num(s.inclination_deg, 2)}° inclination · ${num(s.period_min, 1)} min period` : ""),
      factCard("Rotation (v sin i)", (sb.vsini_measurements || []).length ? `${num(median(sb.vsini_measurements.map((x) => x.vsini)), 0)}<span class="u">km/s</span>` : null,
        (sb.vsini_measurements || []).length ? `median of ${sb.vsini_measurements.length} measurements` : ""),
      factCard("Radial velocity", sb.rvz_radvel != null ? `${num(sb.rvz_radvel, 1)}<span class="u">km/s</span>` : null),
      np ? `<button type="button" class="fact fact-link" data-action="papers" aria-haspopup="dialog"><div class="k">Research papers</div><div class="v">${num(np, 0)}</div><div class="x">references in SIMBAD · <span class="go">browse →</span></div></button>` : "",
    ].join("");
    return cards ? `<section class="sec" id="sec-facts"><h2>Key facts</h2><div class="facts">${cards}</div></section>` : "";
  }

  const median = (xs) => { xs = xs.filter((x) => x != null).sort((a, b) => a - b); return xs.length ? xs[Math.floor(xs.length / 2)] : null; };

  function observationsTable(o) {
    const obs = o.observations || [];
    if (!obs.length) return "";
    const hasEph = obs.some((x) => x.ephemeris);
    const rows = obs.map((x) => {
      const alt = x.altitude_deg != null && !Number.isNaN(x.altitude_deg)
        ? `${num(x.altitude_deg, 1)}° <span class="muted">${compass(x.azimuth_deg)} ${num(x.azimuth_deg, 0)}°</span>` : '<span class="muted">—</span>';
      const loc = x.location ? esc(x.location) : x.location_assumed ? `<span class="muted" title="Location not visible in screenshot; assumed">${esc(x.location_assumed)}*</span>` : "—";
      const eph = hasEph ? `<td>${x.ephemeris ? `mag ${esc(x.ephemeris.mag)} · ${num(x.ephemeris.angular_diameter_arcsec, 1)}″ · ${num(x.ephemeris.illuminated_pct, 0)}% lit · ${num(x.ephemeris.distance_au, 3)} AU` : "—"}</td>` : "";
      return `<tr><td>${esc(x.datetime)}${x.incomplete ? ' <span class="pill warn" title="Card was cut off in the screenshot">partial</span>' : ""}</td><td>${stars(x.rating)}</td><td>${scorePill(x.seeing)}</td><td>${scorePill(x.transparency)}</td><td>${scorePill(x.bortle)}</td><td>${alt}</td>${eph}<td>${loc}</td></tr>`;
    }).join("");
    return `<section class="sec" id="sec-obs"><h2>My observations · ${obs.length}</h2><div class="tablewrap"><table><thead><tr><th>Local time</th><th>Rating</th><th>Seeing</th><th>Transp.</th><th>Bortle</th><th>Altitude / direction</th>${hasEph ? "<th>At that moment</th>" : ""}<th>Location</th></tr></thead><tbody>${rows}</tbody></table></div><div class="note">Altitude and direction are computed for the observation time and place.${obs.some((x) => x.location_assumed) ? " * location not visible in the screenshot; assumed." : ""}</div></section>`;
  }

  function images(o) {
    const im = o.images || {};
    const figs = [];
    if (im.photo) figs.push(`<figure class="photo"><img src="${esc(fileUrl(o, im.photo.file))}" alt="${esc(o.name)}"><figcaption>${esc(im.photo.credit)}</figcaption></figure>`);
    if (im.sky) figs.push(`<figure><img src="${esc(fileUrl(o, im.sky.file))}" alt="Sky around ${esc(o.name)}"><figcaption>${esc(im.sky.credit)} · ${num(im.sky.fov_deg, 1)}° field</figcaption></figure>`);
    return figs.length ? `<div class="images">${figs.join("")}</div>` : "";
  }

  // ---------- detail: sky viewer (Aladin Lite v3) ----------
  function skyTarget(o) {
    if (MOVING.has(o.category)) return null;
    const s = o.summary || {}, g = o.geometry || {}, sb = o.simbad || {};
    const r = s.ra_deg ?? g.ra_deg ?? sb.ra, d = s.dec_deg ?? g.dec_deg ?? sb.dec;
    if (r == null || d == null || Number.isNaN(+r) || Number.isNaN(+d)) return null;
    let fov = 0.5;
    if (o.category === "constellations") {
      const area = s.area && +s.area.value;
      fov = g.radius_deg ? g.radius_deg * 2.4 : area ? Math.sqrt(area) * 1.8 : 40;
      fov = Math.min(Math.max(fov, 15), 100);
    } else if (sb.galdim_majaxis) {
      fov = Math.min(Math.max((sb.galdim_majaxis / 60) * 3, 0.3), 10);   // major axis is in arcmin
    }
    return { ra: +r, dec: +d, fov };
  }

  function skySection(o) {
    const t = skyTarget(o);
    if (!t) return "";
    return section("sky", "Sky viewer", `<div class="skyview" id="skyview"><div class="sky-msg">Loading the sky viewer…</div></div>
      <div class="note">DSS2 colour survey through Aladin Lite (CDS), centred on ${esc(o.name)} with a ${num(t.fov, 1)}° field. Drag to pan, scroll or pinch to zoom.</div>`);
  }

  function destroyAladin() {
    if (state.skyObserver) { state.skyObserver.disconnect(); state.skyObserver = null; }
    if (state.aladin) {
      try { if (typeof state.aladin.destroy === "function") state.aladin.destroy(); } catch {}
      state.aladin = null;
    }
  }

  function mountAladin(o, seq) {
    const host = $("#skyview"), t = skyTarget(o);
    if (!host || !t) return;
    const fail = (msg) => { if (host.isConnected) host.innerHTML = `<div class="sky-msg">${esc(msg)}</div>`; };
    const start = () => {
      const A = window.A;
      if (!A || !A.init || typeof A.aladin !== "function") return fail("The sky viewer needs an internet connection (Aladin Lite did not load).");
      const ready = typeof A.init === "function" ? A.init() : A.init;
      Promise.resolve(ready).then(() => {
        if (seq !== state.seq || !host.isConnected) return;
        host.innerHTML = "";
        const el = document.createElement("div");
        el.className = "aladin-el";
        host.appendChild(el);
        const inst = A.aladin(el, {
          survey: "P/DSS2/color", fov: t.fov, target: `${t.ra} ${t.dec}`, cooFrame: "ICRS",
          showReticle: o.category !== "constellations", showLayersControl: false, showGotoControl: false,
          showFullscreenControl: true, showFrame: false, showCooGridControl: false,
          showProjectionControl: false, showZoomControl: true,
        });
        state.aladin = inst;
        drawBoundary(A, inst, o);
      }).catch(() => fail("The sky viewer could not start."));
    };
    if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) { io.disconnect(); state.skyObserver = null; start(); }
      }, { rootMargin: "300px" });
      io.observe(host);
      state.skyObserver = io;
    } else start();
  }

  // Constellations: outline the IAU boundary when data/sky/boundaries.js is present.
  function drawBoundary(A, inst, o) {
    try {
      const abbr = (o.summary || {}).abbreviation;
      const b = abbr && window.MO_SKY && window.MO_SKY.boundaries && window.MO_SKY.boundaries[abbr];
      if (!b || !b.length || typeof A.graphicOverlay !== "function") return;
      const polys = Array.isArray(b[0][0]) ? b : [b];
      const color = getComputedStyle(document.documentElement).getPropertyValue("--gold").trim() || "#f5c542";
      const overlay = A.graphicOverlay({ color, lineWidth: 2 });
      inst.addOverlay(overlay);
      polys.forEach((p) => overlay.add(A.polygon(p.map(([r, d]) => [+r, +d]))));
    } catch {}
  }

  // ---------- detail: Wikipedia article ----------
  function articleSection(o) {
    const wp = o.wikipedia;
    if (!wp) return "";
    const intro = paras(wp.intro || wp.summary || "");
    return section("article", "Wikipedia", `<div id="article" class="article" data-path="${esc(o.path)}">
      <div class="prose">${intro}</div>
      <div class="note article-status">Loading the full article…</div></div>`);
  }

  function fillArticle(o, extra) {
    const host = $("#article");
    if (!host || host.dataset.path !== o.path) return;
    const wp = o.wikipedia || {};
    const art = (extra && extra.article) || {};
    const secs = asList(art.sections).filter((s) => s && typeof s === "object");
    const link = safeUrl(wp.url) ? `<a href="${esc(safeUrl(wp.url))}" target="_blank" rel="noopener">Wikipedia</a>` : "Wikipedia";
    if (!secs.length) {
      const status = host.querySelector(".article-status");
      if (status) status.innerHTML = `Full article not harvested yet. The introduction above is from ${link}.`;
      return;
    }
    // Lead text = sections before the first heading (level 0/1 or untitled). The rest is grouped
    // under the shallowest heading level; deeper headings become sub-headings inside a group.
    const lead = [], rest = [];
    secs.forEach((s) => ((!rest.length && (!s.title || (s.level ?? 2) <= 1)) ? lead : rest).push(s));
    const top = rest.length ? Math.min(...rest.map((s) => s.level ?? 2)) : 2;
    const groups = [];
    rest.forEach((s) => {
      if ((s.level ?? 2) <= top || !groups.length) groups.push({ title: s.title, first: s, parts: [], id: `wp-${groups.length}` });
      else groups[groups.length - 1].parts.push(s);
    });
    const hasText = (g) => (g.first.text && String(g.first.text).trim()) || g.parts.some((p) => p.text && p.text.trim());
    const shown = groups.filter(hasText);
    const leadText = lead.map((s) => s.text || "").join("\n") || wp.intro || wp.summary || "";
    const body = (g) => paras(g.first.text) + g.parts.map((p) => {
      const h = Math.min(4 + Math.max((p.level ?? top + 1) - top - 1, 0), 6);
      return `${p.title ? `<h${h} class="wp-h">${esc(p.title)}</h${h}>` : ""}${paras(p.text)}`;
    }).join("");
    const toc = shown.length > 1 ? `<nav class="toc" aria-label="Article contents"><div class="toc-t">Contents</div><ol>${shown.map((g) =>
      `<li><button type="button" class="linklike" data-action="jump" data-target="${g.id}">${esc(g.title)}</button>${g.parts.filter((p) => p.title).length ? `<span class="muted"> · ${g.parts.filter((p) => p.title).length}</span>` : ""}</li>`).join("")}</ol></nav>` : "";
    const imgs = asList(art.images).filter((im) => im && safeUrl(im.thumbnail)).slice(0, 12);
    const strip = imgs.length ? `<div class="strip">${imgs.map((im) => {
      const cap = im.caption || String(im.title || "").replace(/^File:/i, "").replace(/\.[a-z0-9]+$/i, "").replace(/_/g, " ");
      return `<figure><img loading="lazy" src="${esc(safeUrl(im.thumbnail))}" alt="${esc(cap)}"><figcaption>${esc(cap)}</figcaption></figure>`;
    }).join("")}</div>` : "";
    host.innerHTML = `${strip}<div class="article-grid">${toc}<div class="article-main">
      <details class="wp-sec" open><summary>Introduction</summary><div class="prose">${paras(leadText)}</div></details>
      ${shown.map((g) => `<details class="wp-sec" id="${g.id}"><summary>${esc(g.title)}</summary><div class="prose">${body(g)}</div></details>`).join("")}
      </div></div><div class="note">Full text of the ${link} article, as plain text.</div>`;
  }

  // ---------- detail: SIMBAD ----------
  const MEASUREMENT_NAMES = {
    mesPM: "Proper motion", mesPLX: "Parallax", mesRV: "Radial velocity", mesVelocities: "Velocities",
    mesSpT: "Spectral type", mesDiameter: "Diameter", mesRot: "Rotation (v sin i)",
    mesFe_h: "Temperature, gravity and metallicity", mesDistance: "Distance", mesVar: "Variability",
    mesIUE: "IUE ultraviolet spectra", mesXmm: "XMM-Newton X-ray observations", mesHerschel: "Herschel observations",
    mesISO: "ISO observations", mesPos: "Position", mesUncertainty: "Position uncertainty",
  };

  function simbadSection(o) {
    const sb = o.simbad;
    if (!sb) return "";
    const co = sb.coordinates || {}, s = o.summary || {};
    const raDeg = pick(co, ["ra", "ra_deg", "ra_icrs"]) ?? sb.ra, decDeg = pick(co, ["dec", "dec_deg", "dec_icrs"]) ?? sb.dec;
    const galObj = co.galactic && typeof co.galactic === "object" ? co.galactic : {};
    let gl = pick(co, ["gal_l", "l", "glon", "galactic_l", "lon_gal"]) ?? pick(galObj, ["l", "lon"]) ?? s.gal_l;
    let gb = pick(co, ["gal_b", "b", "glat", "galactic_b", "lat_gal"]) ?? pick(galObj, ["b", "lat"]) ?? s.gal_b;
    let galNote = "";
    if ((gl == null || gb == null) && raDeg != null && decDeg != null) {
      const g = galactic(+raDeg, +decDeg); gl = g.l; gb = g.b; galNote = ' <span class="muted">(computed here)</span>';
    }
    const ref = (v, e, u) => v == null ? null : `${rawNum(+v)}${e != null ? ` <span class="muted">± ${rawNum(+e)}</span>` : ""}${u ? ` <span class="muted">${u}</span>` : ""}`;
    const np = paperCount(o);
    const consumed = new Set(["ra", "ra_deg", "ra_icrs", "dec", "dec_deg", "dec_icrs", "gal_l", "l", "glon", "galactic_l", "lon_gal", "gal_b", "b", "glat", "galactic_b", "lat_gal", "galactic"]);
    const otherCoords = Object.entries(co).filter(([k, v]) => !consumed.has(k) && !blank(v))
      .map(([k, v]) => [colName(k), typeof v === "object" ? esc(JSON.stringify(v)) : typeof v === "number" ? rawNum(v) : esc(v)]);
    const basic = kvTable([
      ["Identifier", sb.main_id ? `<span class="mono">${esc(String(sb.main_id).replace(/\s+/g, " "))}</span>` : null],
      ["Object type", sb.otype || sb.otype_desc ? `${esc(sb.otype_desc || "")}${sb.otype ? ` <span class="muted mono">${esc(sb.otype)}</span>` : ""}` : null],
      ["RA (ICRS, J2000)", raDeg != null ? `${ra(+raDeg)} <span class="muted">${rawNum(+raDeg)}°</span>` : null],
      ["Dec (ICRS, J2000)", decDeg != null ? `${dec(+decDeg)} <span class="muted">${rawNum(+decDeg)}°</span>` : null],
      ["Galactic longitude l", gl != null ? `${(+gl).toFixed(4)}°${galNote}` : null],
      ["Galactic latitude b", gb != null ? `${(+gb).toFixed(4)}°${galNote}` : null],
      ...otherCoords,
      ["Proper motion", sb.pmra != null || sb.pmdec != null ? `RA ${sb.pmra != null ? rawNum(+sb.pmra) : "—"} · Dec ${sb.pmdec != null ? rawNum(+sb.pmdec) : "—"} <span class="muted">mas/yr</span>` : null],
      ["Parallax", ref(sb.plx_value, sb.plx_err, "mas")],
      ["Radial velocity", ref(sb.rvz_radvel, sb.rvz_err, "km/s")],
      ["Redshift z", sb.rvz_redshift != null ? rawNum(+sb.rvz_redshift) : null],
      ["Spectral type", sb.sp_type ? esc(sb.sp_type) : null],
      ["Morphology", sb.morph_type ? esc(sb.morph_type) : null],
      ["Dimensions", sb.galdim_majaxis != null ? `${rawNum(+sb.galdim_majaxis)}′ × ${sb.galdim_minaxis != null ? rawNum(+sb.galdim_minaxis) : "—"}′${sb.galdim_angle != null ? ` <span class="muted">PA ${rawNum(+sb.galdim_angle)}°</span>` : ""}` : null],
      ["References", np ? `${num(np, 0)} <button type="button" class="linklike" data-action="papers" aria-haspopup="dialog">browse papers →</button>` : null],
    ]);
    let html = `<h3>Basic data</h3>${basic}`;

    const fl = Object.entries(sb.fluxes || {});
    if (fl.length) {
      const order = "UBVRIGJHK";
      fl.sort((a, b) => (order.indexOf(a[0]) + 1 || 99) - (order.indexOf(b[0]) + 1 || 99));
      const rows = fl.map(([band, v]) => Object.assign({ band }, v && typeof v === "object" ? v : { mag: v }));
      html += `<h3>Photometry · ${fl.length} bands</h3>${dataTable(rows, { limit: 20, unit: "bands" })}`;
    }

    const hier = hierarchyRows(sb.hierarchy);
    if (hier.length) html += `<h3>Hierarchy · ${hier.length}</h3>${dataTable(hier, { limit: 10 })}`;

    // Every measurement table; fall back to the older curated lists.
    let tables = Object.entries(sb.measurements || {}).filter(([, rows]) => asList(rows).length);
    if (!tables.length) {
      tables = [["mesFe_h", sb.atmosphere_measurements], ["mesRot", sb.vsini_measurements], ["mesDistance", sb.distance_measurements]]
        .filter(([, rows]) => asList(rows).length);
    }
    if (tables.length) {
      html += `<h3>Measurements · ${tables.length} ${tables.length === 1 ? "table" : "tables"}</h3>`;
      html += tables.map(([name, rows]) => {
        rows = asList(rows);
        const title = MEASUREMENT_NAMES[name] || String(name).replace(/^mes/, "");
        return `<div class="mtable"><div class="mtitle">${esc(title)} <span class="muted">· ${rows.length} ${rows.length === 1 ? "row" : "rows"} · <span class="mono">${esc(name)}</span></span></div>${dataTable(rows)}</div>`;
      }).join("");
    }

    if ((sb.identifiers || []).length) {
      html += `<h3>Identifiers · ${sb.identifiers.length}</h3><div class="ids">${sb.identifiers.map((i) => `<span class="tag mono">${esc(String(i).replace(/\s+/g, " "))}</span>`).join("")}</div>`;
    }
    if ((sb.types || []).length) {
      html += `<h3>Classifications</h3><div class="ids">${sb.types.map((t) => `<span class="tag mono">${esc(t)}</span>`).join("")}</div>`;
    }
    const notes = asList(sb.notes).filter((n) => !blank(n));
    if (notes.length) {
      html += `<h3>Notes</h3><div class="prose notes">${notes.map((n) => typeof n === "object"
        ? `${paras(n.text || n.note || n.annotation || JSON.stringify(n))}${n.bibcode ? `<p class="muted">${bib(n.bibcode)}</p>` : ""}`
        : paras(n)).join("")}</div>`;
    }
    const link = safeUrl(sb.url) ? ` <a class="sec-src" href="${esc(safeUrl(sb.url))}" target="_blank" rel="noopener">SIMBAD page ↗</a>` : "";
    return section("simbad", `SIMBAD${link}`, html);
  }

  // Accepts [{main_id, otype, membership, relation}] or {parents: [...], children: [...]}.
  function hierarchyRows(h) {
    if (!h) return [];
    const out = [];
    const add = (rel, x) => {
      if (!x) return;
      if (typeof x !== "object") { out.push({ relation: rel, object: String(x) }); return; }
      out.push({
        relation: x.relation || x.role || x.link || x.direction || rel || "",
        object: cleanId(x.main_id || x.id || x.name || ""), type: x.otype_desc || x.otype || "",
        membership: x.membership != null ? `${x.membership}${typeof x.membership === "number" && x.membership <= 100 ? "%" : ""}` : "",
      });
    };
    if (Array.isArray(h)) h.forEach((x) => add("", x));
    else Object.entries(h).forEach(([k, xs]) => asList(xs).forEach((x) => add(k.replace(/s$/, ""), x)));
    return out;
  }

  // ---------- detail: Wikidata ----------
  function wdValue(v) {
    if (blank(v)) return '<span class="muted">—</span>';
    if (typeof v !== "object") return safeUrl(v) ? extLink(v, esc(v)) : esc(v);
    if ("unit" in v) return qty(v);
    const val = v.value ?? v.label ?? v.text ?? v.id;
    const url = safeUrl(v.url);
    const body = val == null ? esc(JSON.stringify(v)) : safeUrl(val) ? extLink(val, esc(val)) : esc(val);
    return url && val != null && !safeUrl(val) ? extLink(url, body) : body;
  }

  function wikidataSection(o) {
    const wd = o.wikidata;
    if (!wd) return "";
    const all = wd.all_claims && Object.keys(wd.all_claims).length ? wd.all_claims : null;
    const claims = all || wd.facts;
    if (!claims || !Object.keys(claims).length) return "";
    const entries = Object.entries(claims);
    const rows = entries.map(([k, vals]) => {
      vals = asList(vals);
      const cells = vals.map((v, i) => `<span class="wdv${i >= 6 ? " extra" : ""}">${wdValue(v)}</span>`).join("");
      return `<tr><th scope="row">${esc(k)}</th><td><div class="clip">${cells}${moreButton(vals.length, 6, "values")}</div></td></tr>`;
    }).join("");
    const filter = entries.length > 12 ? `<input type="search" class="tfilter" data-filter="wd" placeholder="Filter ${entries.length} properties…" aria-label="Filter Wikidata properties">` : "";
    const link = safeUrl(wd.url) ? ` <a class="sec-src" href="${esc(safeUrl(wd.url))}" target="_blank" rel="noopener">${esc(wd.id || "Wikidata")} ↗</a>` : "";
    const note = all ? "" : '<div class="note">Curated properties only; the full claim list has not been harvested yet.</div>';
    return section("wikidata", `Wikidata · ${entries.length} properties${link}`,
      `${filter}<div class="tablewrap"><table class="kv wd" data-filtered="wd">${rows}</table></div>${note}`);
  }

  // ---------- detail: Horizons and CelesTrak ----------
  function horizonsSection(o) {
    const hz = o.horizons;
    if (!hz) return "";
    let html = "";
    if (hz.physical_data) html += `<h3>Physical data</h3><pre>${esc(hz.physical_data)}</pre>`;
    const eph = asList(hz.ephemeris).filter((r) => r && typeof r === "object");
    if (eph.length) {
      const rows = eph.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => k && k.replace(/[\s/]/g, ""))));
      html += `<h3>Ephemeris · ${eph.length} ${eph.length === 1 ? "row" : "rows"}</h3>${dataTable(rows)}<div class="note">Positions computed by JPL Horizons for the observation times.</div>`;
    }
    const link = safeUrl(hz.url) ? ` <a class="sec-src" href="${esc(safeUrl(hz.url))}" target="_blank" rel="noopener">Horizons ↗</a>` : "";
    return section("horizons", `JPL Horizons${link}`, html);
  }

  function celestrakSection(o) {
    const c = o.celestrak;
    if (!c) return "";
    const tbl = (obj) => kvTable(Object.entries(obj || {}).map(([k, v]) => [colName(k), blank(v) ? '<span class="muted">—</span>' : typeof v === "number" ? rawNum(v) : esc(v)]));
    const parts = [];
    if (c.catalog) parts.push(`<div><h3>Satellite catalogue record</h3>${tbl(c.catalog)}</div>`);
    if (c.orbit) parts.push(`<div><h3>Current orbital elements</h3>${tbl(c.orbit)}<div class="note">Latest elements, not those at the time of the observation.</div></div>`);
    const link = safeUrl(c.url) ? ` <a class="sec-src" href="${esc(safeUrl(c.url))}" target="_blank" rel="noopener">CelesTrak ↗</a>` : "";
    return section("celestrak", `CelesTrak${link}`, parts.length ? `<div class="two-col">${parts.join("")}</div>` : "");
  }

  // ---------- detail: sources ----------
  function sourcesRow(o) {
    const s = o.summary || {}, seen = new Set(), out = [];
    const add = (name, url, title = "") => {
      url = safeUrl(url);
      if (!url || seen.has(url)) return;
      seen.add(url); out.push([name, url, title]);
    };
    (o.sources || []).forEach((x) => add(x.name, x.url, x.retrieved ? `retrieved ${String(x.retrieved).slice(0, 10)}` : ""));
    if (o.simbad) add("SIMBAD", o.simbad.url);
    if (o.wikipedia) add("Wikipedia", o.wikipedia.url);
    if (o.wikidata) add("Wikidata", o.wikidata.url);
    const t = skyTarget(o);
    if (t) add("Aladin", `https://aladin.cds.unistra.fr/AladinLite/?target=${t.ra}%20${t.dec}&fov=${t.fov}&survey=CDS%2FP%2FDSS2%2Fcolor`);
    if (o.horizons) add("JPL Horizons", o.horizons.url);
    if (o.celestrak) add("CelesTrak", o.celestrak.url);
    if (s.norad_id) add("Heavens-Above", `https://www.heavens-above.com/SatInfo.aspx?satid=${encodeURIComponent(s.norad_id)}`);
    const resolved = o.resolved ? `<span class="muted">Resolved via ${esc(o.resolved.method)}${o.resolved.simbad_id ? ` as <span class="mono">${esc(String(o.resolved.simbad_id).replace(/\s+/g, " "))}</span>` : ""}${o.harvested ? ` · harvested ${esc(String(o.harvested).slice(0, 10))}` : ""}</span>` : "";
    return `<section class="sec" id="sec-sources"><h2>Sources</h2><div class="srcrow">${out.map(([n, u, ti]) =>
      `<a href="${esc(u)}" target="_blank" rel="noopener"${ti ? ` title="${esc(ti)}"` : ""}>${esc(n)} ↗</a>`).join("")}</div>${resolved ? `<div class="note">${resolved}</div>` : ""}
      <details><summary>Raw data (object.json)</summary><div><pre>${esc(JSON.stringify(o, null, 2))}</pre></div></details></section>`;
  }

  function pageNav(html) {
    const names = [["facts", "Facts"], ["sky", "Sky"], ["obs", "Observations"], ["horizons", "Horizons"], ["celestrak", "CelesTrak"],
      ["article", "Wikipedia"], ["simbad", "SIMBAD"], ["wikidata", "Wikidata"], ["sources", "Sources"]];
    const have = names.filter(([id]) => html.includes(`id="sec-${id}"`));
    return have.length > 2 ? `<nav class="pagenav" aria-label="On this page">${have.map(([id, n]) =>
      `<button type="button" data-action="jump" data-target="sec-${id}">${n}</button>`).join("")}</nav>` : "";
  }

  // ---------- research papers modal ----------
  const modal = { el: null, opener: null, papers: [], shown: 100, obj: null };

  function openPapers(o, opener) {
    closeModal();
    modal.obj = o; modal.opener = opener || document.activeElement; modal.papers = []; modal.shown = 100;
    const el = document.createElement("div");
    el.className = "modal-backdrop";
    el.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div class="modal-head"><h3 id="modal-title">Research papers · ${esc(o.name)}</h3><button type="button" class="ghost modal-close" data-action="close" aria-label="Close">✕</button></div>
      <div class="modal-tools"><input type="search" class="modal-search" placeholder="Search title, author, journal, year…" aria-label="Search papers" autocomplete="off">
        <select class="modal-sort" aria-label="Sort papers"><option value="new">Newest first</option><option value="old">Oldest first</option><option value="title">Title A–Z</option></select></div>
      <div class="modal-count muted" aria-live="polite"></div>
      <div class="modal-body"><div class="empty">Loading papers…</div></div></div>`;
    document.body.appendChild(el);
    document.body.classList.add("modal-open");
    modal.el = el;
    el.addEventListener("click", (e) => {
      if (e.target === el || e.target.closest('[data-action="close"]')) return closeModal();
      if (e.target.closest('[data-action="more-papers"]')) { modal.shown += 100; renderPapers(); }
    });
    el.querySelector(".modal-search").addEventListener("input", () => { modal.shown = 100; renderPapers(); });
    el.querySelector(".modal-sort").addEventListener("change", () => { modal.shown = 100; renderPapers(); });
    el.querySelector(".modal-search").focus();
    loadExtra(o.path).then((x) => {
      if (modal.el !== el) return;
      modal.papers = asList(x.papers).filter((p) => p && typeof p === "object").map((p) => {
        const authors = Array.isArray(p.authors) ? p.authors.join("; ") : p.authors || "";
        const year = +(p.year || String(p.bibcode || "").slice(0, 4)) || null;
        return { p, year, authors, hay: [p.title, authors, p.journal, p.bibcode, year, p.doi].filter(Boolean).join(" ").toLowerCase() };
      });
      renderPapers();
    }, () => {
      if (modal.el !== el) return;
      const sb = o.simbad || {};
      el.querySelector(".modal-count").textContent = "";
      el.querySelector(".modal-body").innerHTML = `<div class="empty">The paper list for this object has not been harvested yet.${safeUrl(sb.url) ? `<br><a href="${esc(safeUrl(sb.url))}" target="_blank" rel="noopener">See the references on SIMBAD ↗</a>` : ""}</div>`;
    });
  }

  function authorLine(p) {
    if (Array.isArray(p.authors)) {
      const a = p.authors.filter(Boolean);
      return a.length > 6 ? `${a.slice(0, 3).map(esc).join(", ")} et al. <span class="muted">(${a.length} authors)</span>` : a.map(esc).join(", ");
    }
    return esc(p.authors || "");
  }

  function renderPapers() {
    const el = modal.el;
    if (!el) return;
    const q = el.querySelector(".modal-search").value.trim().toLowerCase();
    const sort = el.querySelector(".modal-sort").value;
    let list = modal.papers.filter((x) => !q || q.split(/\s+/).every((w) => x.hay.includes(w)));
    const byTitle = (a, b) => String(a.p.title || a.p.bibcode || "").localeCompare(String(b.p.title || b.p.bibcode || ""));
    list.sort(sort === "title" ? byTitle : sort === "old"
      ? (a, b) => (a.year ?? 9999) - (b.year ?? 9999) || byTitle(a, b)
      : (a, b) => (b.year ?? 0) - (a.year ?? 0) || byTitle(a, b));
    const total = modal.papers.length;
    el.querySelector(".modal-count").textContent = q ? `${list.length} of ${total} papers` : `${total} papers`;
    if (!total) { el.querySelector(".modal-body").innerHTML = '<div class="empty">No papers listed for this object.</div>'; return; }
    if (!list.length) { el.querySelector(".modal-body").innerHTML = '<div class="empty">No papers match.</div>'; return; }
    const items = list.slice(0, modal.shown).map(({ p, year }) => {
      const where = [p.journal, p.volume, p.page].filter((v) => !blank(v)).map((v) => esc(String(v).trim())).join(" ");
      const doi = p.doi ? String(p.doi).trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, "") : "";
      const linksHtml = [
        p.bibcode ? `<a href="https://ui.adsabs.harvard.edu/abs/${encodeURIComponent(String(p.bibcode).trim())}" target="_blank" rel="noopener">ADS ↗</a>` : "",
        doi ? `<a href="https://doi.org/${encodeURI(doi)}" target="_blank" rel="noopener">DOI ↗</a>` : "",
      ].filter(Boolean).join("");
      return `<li class="paper"><div class="pt">${esc(p.title || p.bibcode || "Untitled")}</div>${p.authors ? `<div class="pa">${authorLine(p)}</div>` : ""}<div class="pm"><span>${where || '<span class="muted">—</span>'}</span>${year ? `<span class="py">${year}</span>` : ""}${p.bibcode ? `<span class="mono muted">${esc(String(p.bibcode).trim())}</span>` : ""}</div>${linksHtml ? `<div class="pl">${linksHtml}</div>` : ""}</li>`;
    }).join("");
    const more = list.length > modal.shown ? `<button type="button" class="more-btn" data-action="more-papers">Show ${Math.min(100, list.length - modal.shown)} more of ${list.length - modal.shown}</button>` : "";
    el.querySelector(".modal-body").innerHTML = `<ol class="papers">${items}</ol>${more}`;
  }

  function closeModal() {
    if (!modal.el) return;
    modal.el.remove();
    modal.el = null;
    document.body.classList.remove("modal-open");
    const back = modal.opener;
    modal.opener = null;
    if (back && back.isConnected && typeof back.focus === "function") back.focus();
  }

  // Esc closes; Tab stays inside the dialog.
  document.addEventListener("keydown", (e) => {
    if (!modal.el) return;
    if (e.key === "Escape") { e.preventDefault(); closeModal(); return; }
    if (e.key !== "Tab") return;
    const f = [...modal.el.querySelectorAll('a[href], button:not([disabled]), input, select, [tabindex]:not([tabindex="-1"])')]
      .filter((x) => x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && (document.activeElement === first || !modal.el.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (document.activeElement === last || !modal.el.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
  });

  // ---------- routing ----------
  function renderOverview() {
    document.body.classList.add("is-overview");
    $(".layout").classList.add("showing");
    $("#overview-link").setAttribute("aria-current", "page");
    if (state.overview) return;
    const detail = $("#detail");
    if (!window.MO_CHARTS || typeof window.MO_CHARTS.render !== "function") {
      detail.innerHTML = '<div class="empty">Overview not available. The charts script (assets/charts.js) has not been built yet.</div>';
      return;
    }
    state.overview = true;
    detail.innerHTML = "";
    try {
      window.MO_CHARTS.render(detail, { data: window.MO_DATA, sky: window.MO_SKY, navigate: (path) => { location.hash = path; } });
    } catch (e) {
      detail.innerHTML = `<div class="empty">The overview could not be drawn: ${esc(e.message)}</div>`;
    }
    window.scrollTo({ top: 0 });
  }

  function leaveOverview() {
    if (state.overview) {
      try { window.MO_CHARTS && window.MO_CHARTS.destroy && window.MO_CHARTS.destroy(); } catch {}
      state.overview = false;
    }
    document.body.classList.remove("is-overview");
    $("#overview-link").removeAttribute("aria-current");
  }

  async function renderDetail() {
    const path = decodeURIComponent(location.hash.slice(1));
    const seq = ++state.seq;
    closeModal();
    destroyAladin();
    if (path === "overview") return renderOverview();
    leaveOverview();
    const layout = $(".layout");
    if (!path) {
      layout.classList.remove("showing");
      $("#detail").innerHTML = `<div class="empty">Pick an object on the left, or open the <a href="#overview">overview</a>. ${state.objects.length} objects, ${state.objects.reduce((n, o) => n + o.observations, 0)} observations.</div>`;
      return;
    }
    layout.classList.add("showing");
    $("#detail").innerHTML = '<div class="empty">Loading…</div>';
    let o;
    try { o = await loadObject(path); }
    catch (e) { if (seq === state.seq) $("#detail").innerHTML = `<div class="empty">Could not load ${esc(path)}: ${esc(e.message)}</div>`; return; }
    if (seq !== state.seq) return;
    const s = o.summary || {};
    const des = cleanId(s.designation);
    const tags = [CATEGORIES[o.category] || o.category, o.app_type, des && des !== o.name ? des : null]
      .filter(Boolean).map((t) => `<span class="tag">${esc(t)}</span>`).join("");
    const body = [keyFacts(o), skySection(o), observationsTable(o), horizonsSection(o), celestrakSection(o),
      articleSection(o), simbadSection(o), wikidataSection(o), sourcesRow(o)].join("");
    $("#detail").innerHTML = `
      <a class="back" href="#">← All objects</a>
      <div class="hero"><div><h1>${esc(o.name)}</h1>${s.description ? `<div class="desc">${esc(s.description)}</div>` : ""}<div class="tags">${tags}</div></div>${images(o)}</div>
      ${pageNav(body)}
      ${body}`;
    window.scrollTo({ top: 0 });
    mountAladin(o, seq);
    if (o.wikipedia) {
      loadExtra(o.path).then((x) => { if (seq === state.seq) fillArticle(o, x); }, () => { if (seq === state.seq) fillArticle(o, null); });
    }
  }

  // ---------- events ----------
  $("#chips").addEventListener("click", (e) => {
    const b = e.target.closest(".chip"); if (!b) return;
    state.category = b.dataset.cat; renderChips(); renderList();
  });
  $("#search").addEventListener("input", (e) => {
    state.query = e.target.value.trim(); renderList();
    if (state.overview || document.body.classList.contains("is-overview")) location.hash = "";   // searching leaves the overview
  });
  $("#sort").addEventListener("change", (e) => { state.sort = e.target.value; save("sort", state.sort); renderList(); });
  $("#night").addEventListener("click", () => {
    const on = document.documentElement.dataset.theme !== "night";
    setNight(on); save("night", on ? "1" : "");
  });
  $("#detail").addEventListener("click", (e) => {
    if (state.overview) return;   // the charts own their clicks
    const act = e.target.closest("[data-action]");
    if (act) {
      const a = act.dataset.action;
      if (a === "papers") {
        const path = decodeURIComponent(location.hash.slice(1));
        loadObject(path).then((o) => openPapers(o, act.closest("button") || act)).catch(() => {});
      } else if (a === "more") {
        const clip = act.closest(".clip");
        const open = clip.classList.toggle("open");
        act.textContent = open ? "Show fewer" : act.dataset.label;
        act.setAttribute("aria-expanded", open);
      } else if (a === "jump") {
        const t = document.getElementById(act.dataset.target);
        if (t) { if (t.tagName === "DETAILS") t.open = true; t.scrollIntoView({ behavior: "smooth", block: "start" }); }
      }
      return;
    }
    const img = e.target.closest(".images img, .strip img"); if (!img) return;
    const lb = document.createElement("div"); lb.className = "lightbox";
    lb.innerHTML = `<img src="${esc(img.src)}" alt="">`; lb.onclick = () => lb.remove();
    document.body.appendChild(lb);
  });
  $("#detail").addEventListener("input", (e) => {
    const f = e.target.closest(".tfilter"); if (!f) return;
    const q = f.value.trim().toLowerCase();
    const table = $(`#detail table[data-filtered="${f.dataset.filter}"]`); if (!table) return;
    table.querySelectorAll("tr").forEach((tr) => { tr.hidden = !!q && !tr.textContent.toLowerCase().includes(q); });
  });
  window.addEventListener("hashchange", () => { renderList(); renderDetail(); });

  function setNight(on) {
    if (on) document.documentElement.dataset.theme = "night"; else delete document.documentElement.dataset.theme;
    $("#night").setAttribute("aria-pressed", on);
  }
  function save(k, v) { try { localStorage.setItem("mo." + k, v); } catch {} }
  function load(k) { try { return localStorage.getItem("mo." + k); } catch { return null; } }

  // ---------- boot ----------
  (async () => {
    state.sort = load("sort") || "last"; $("#sort").value = state.sort;
    setNight(!!load("night"));
    try {
      if (window.MO_DATA) state.objects = window.MO_DATA.index.objects;   // works from file://
      else state.objects = (await (await fetch("data/index.json")).json()).objects;
    } catch (e) {
      $("#detail").innerHTML = `<div class="empty">Could not read the data. Run the object-research script to build data/bundle.js.</div>`;
      return;
    }
    renderChips(); renderList(); renderDetail();
  })();
})();
