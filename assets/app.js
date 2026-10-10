// My Observatory viewer: reads data/index.json, then data/<category>/<id>/object.json on demand.
(() => {
  const CATEGORIES = {
    stars: "Stars", planets: "Planets", moons: "Moons", constellations: "Constellations",
    satellites: "Satellites", clusters: "Clusters", nebulae: "Nebulae", galaxies: "Galaxies",
    comets: "Comets", "minor-bodies": "Minor bodies", other: "Other",
  };
  const $ = (s) => document.querySelector(s);
  const state = { objects: [], category: "all", query: "", sort: "last", cache: {} };

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

  // ---------- detail ----------
  async function loadObject(path) {
    if (window.MO_DATA && window.MO_DATA.objects[path]) return window.MO_DATA.objects[path];
    if (!state.cache[path]) {
      const r = await fetch(`data/${path}/object.json`);
      if (!r.ok) throw new Error(`${r.status} loading ${path}`);
      state.cache[path] = await r.json();
    }
    return state.cache[path];
  }

  function factCard(k, v, extra = "") {
    if (v == null || v === "—" || v === "") return "";
    return `<div class="fact"><div class="k">${esc(k)}</div><div class="v">${v}</div>${extra ? `<div class="x">${extra}</div>` : ""}</div>`;
  }

  function keyFacts(o) {
    const s = o.summary || {}, f = (o.wikidata || {}).facts || {}, sb = o.simbad || {};
    const color = teffColor(s.teff_k);
    const cards = [
      factCard("Apparent magnitude", s.v_mag != null ? num(s.v_mag, 2) : null,
        s.b_minus_v != null ? `B−V ${num(s.b_minus_v, 2)}` : ""),
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
      factCard("Research papers", sb.nbref ? num(sb.nbref, 0) : null, sb.nbref ? "references in SIMBAD" : ""),
    ].join("");
    return cards ? `<h2>Key facts</h2><div class="facts">${cards}</div>` : "";
  }

  const median = (xs) => { xs = xs.filter((x) => x != null).sort((a, b) => a - b); return xs.length ? xs[Math.floor(xs.length / 2)] : null; };

  function observationsTable(o) {
    const obs = o.observations || [];
    if (!obs.length) return "";
    const hasEph = obs.some((x) => x.ephemeris);
    const rows = obs.map((x) => {
      const alt = x.altitude_deg != null && !Number.isNaN(x.altitude_deg)
        ? `${num(x.altitude_deg, 1)}° <span class="muted">${compass(x.azimuth_deg)} ${num(x.azimuth_deg, 0)}°</span>` : '<span class="muted">—</span>';
      const loc = x.location || (x.location_assumed ? `<span class="muted" title="Location not visible in screenshot; assumed">${esc(x.location_assumed)}*</span>` : "—");
      const eph = hasEph ? `<td>${x.ephemeris ? `mag ${esc(x.ephemeris.mag)} · ${num(x.ephemeris.angular_diameter_arcsec, 1)}″ · ${num(x.ephemeris.illuminated_pct, 0)}% lit · ${num(x.ephemeris.distance_au, 3)} AU` : "—"}</td>` : "";
      return `<tr><td>${esc(x.datetime)}${x.incomplete ? ' <span class="pill warn" title="Card was cut off in the screenshot">partial</span>' : ""}</td><td>${stars(x.rating)}</td><td>${scorePill(x.seeing)}</td><td>${scorePill(x.transparency)}</td><td>${scorePill(x.bortle)}</td><td>${alt}</td>${eph}<td>${loc}</td></tr>`;
    }).join("");
    return `<h2>My observations · ${obs.length}</h2><div class="tablewrap"><table><thead><tr><th>Local time</th><th>Rating</th><th>Seeing</th><th>Transp.</th><th>Bortle</th><th>Altitude / direction</th>${hasEph ? "<th>At that moment</th>" : ""}<th>Location</th></tr></thead><tbody>${rows}</tbody></table></div><div class="note">Altitude and direction are computed for the observation time and place.${obs.some((x) => x.location_assumed) ? " * location not visible in the screenshot; assumed." : ""}</div>`;
  }

  function about(o) {
    const wp = o.wikipedia;
    if (!wp) return "";
    const text = wp.intro || wp.summary || "";
    const paras = text.split(/\n+/).filter((p) => p.trim()).map((p) => `<p>${esc(p)}</p>`).join("");
    return `<h2>About</h2><div class="prose">${paras}<p><a href="${esc(wp.url)}" target="_blank" rel="noopener">Read more on Wikipedia →</a></p></div>`;
  }

  function wikidataTable(o) {
    const f = (o.wikidata || {}).facts;
    if (!f || !Object.keys(f).length) return "";
    const rows = Object.entries(f).map(([k, vals]) => {
      const shown = vals.slice(0, 4).map((v) => "unit" in v ? qty(v) : esc(v.value)).join("<br>");
      const more = vals.length > 4 ? `<br><span class="muted">+${vals.length - 4} more</span>` : "";
      return `<tr><td class="muted">${esc(k)}</td><td>${shown}${more}</td></tr>`;
    }).join("");
    return `<details><summary>All catalogued properties (Wikidata)</summary><div><table>${rows}</table></div></details>`;
  }

  function simbadDetails(o) {
    const sb = o.simbad;
    if (!sb) return "";
    let html = "";
    const fl = Object.entries(sb.fluxes || {});
    if (fl.length) {
      const order = "UBVRIGJHK";
      fl.sort((a, b) => (order.indexOf(a[0]) + 1 || 99) - (order.indexOf(b[0]) + 1 || 99));
      html += `<details><summary>Brightness in each colour band · ${fl.length}</summary><div><table><thead><tr><th>Band</th><th>Magnitude</th><th>Error</th></tr></thead>${fl.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${num(v.mag, 3)}</td><td class="muted">${num(v.err, 3)}</td></tr>`).join("")}</table></div></details>`;
    }
    if ((sb.identifiers || []).length) {
      html += `<details><summary>Other names and catalogue numbers · ${sb.identifiers.length}</summary><div class="ids">${sb.identifiers.map((i) => `<span class="tag mono">${esc(i.replace(/\s+/g, " "))}</span>`).join("")}</div></details>`;
    }
    const atm = sb.atmosphere_measurements || [];
    if (atm.length) {
      html += `<details><summary>Temperature, gravity and metallicity measurements · ${atm.length}</summary><div><table><thead><tr><th>Teff (K)</th><th>log g</th><th>[Fe/H]</th><th>Paper</th></tr></thead>${atm.map((m) => `<tr><td>${num(m.teff, 0)}</td><td>${num(m.log_g, 2)}</td><td>${num(m.fe_h, 2)}</td><td>${bib(m.bibcode)}</td></tr>`).join("")}</table></div></details>`;
    }
    const dist = sb.distance_measurements || [];
    if (dist.length) {
      html += `<details><summary>Distance measurements · ${dist.length}</summary><div><table><thead><tr><th>Distance</th><th>Method</th><th>Paper</th></tr></thead>${dist.map((m) => `<tr><td>${num(m.dist, 2)} ${esc(m.unit)}${m.plus_err ? ` <span class="muted">+${num(m.plus_err, 2)}/−${num(m.minus_err, 2)}</span>` : ""}</td><td>${esc(m.method)}</td><td>${bib(m.bibcode)}</td></tr>`).join("")}</table></div></details>`;
    }
    const rot = sb.vsini_measurements || [];
    if (rot.length) {
      html += `<details><summary>Rotation speed measurements · ${rot.length}</summary><div><table><thead><tr><th>v sin i (km/s)</th><th>Paper</th></tr></thead>${rot.map((m) => `<tr><td>${num(m.vsini, 1)}${m.vsini_err ? ` <span class="muted">± ${num(m.vsini_err, 1)}</span>` : ""}</td><td>${bib(m.bibcode)}</td></tr>`).join("")}</table></div></details>`;
    }
    if ((sb.types || []).length) {
      html += `<details><summary>SIMBAD object classifications</summary><div class="ids">${sb.types.map((t) => `<span class="tag mono">${esc(t)}</span>`).join("")}</div></details>`;
    }
    return html;
  }
  const bib = (b) => b ? `<a href="https://ui.adsabs.harvard.edu/abs/${encodeURIComponent(b)}" target="_blank" rel="noopener">${esc(b)}</a>` : "—";

  function satelliteDetails(o) {
    const c = o.celestrak;
    if (!c) return "";
    const tbl = (obj) => `<table>${Object.entries(obj || {}).map(([k, v]) => `<tr><td class="muted">${esc(k)}</td><td>${esc(v)}</td></tr>`).join("")}</table>`;
    return `${c.catalog ? `<details open><summary>Satellite catalogue record (CelesTrak)</summary><div>${tbl(c.catalog)}</div></details>` : ""}${c.orbit ? `<details><summary>Current orbital elements (CelesTrak; not at the time you saw it)</summary><div>${tbl(c.orbit)}</div></details>` : ""}`;
  }

  function planetDetails(o) {
    const hz = o.horizons;
    if (!hz || !hz.physical_data) return "";
    return `<details><summary>Physical data (JPL Horizons)</summary><div><pre>${esc(hz.physical_data)}</pre></div></details>`;
  }

  function links(o) {
    const s = o.summary || {}, out = [];
    if (o.simbad) out.push(["SIMBAD", o.simbad.url]);
    if (o.wikipedia) out.push(["Wikipedia", o.wikipedia.url]);
    if (o.wikidata) out.push(["Wikidata", o.wikidata.url]);
    if (s.ra_deg != null) {
      const fov = o.category === "constellations" ? 40 : 0.5;
      out.push(["Aladin sky atlas", `https://aladin.cds.unistra.fr/AladinLite/?target=${s.ra_deg}%20${s.dec_deg}&fov=${fov}&survey=CDS%2FP%2FDSS2%2Fcolor`]);
    }
    if (o.horizons) out.push(["JPL Horizons", o.horizons.url]);
    if (o.celestrak && o.celestrak.url) out.push(["CelesTrak", o.celestrak.url]);
    if (s.norad_id) out.push(["Heavens-Above", `https://www.heavens-above.com/SatInfo.aspx?satid=${s.norad_id}`]);
    return out.length ? `<h2>Explore</h2><div class="links">${out.map(([n, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(n)} ↗</a>`).join("")}</div>` : "";
  }

  function sources(o) {
    const list = o.sources || [];
    return `<h2>Sources</h2><ul class="sources">${list.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a> · retrieved ${esc((s.retrieved || "").slice(0, 10))}</li>`).join("")}${o.resolved ? `<li>Resolved via ${esc(o.resolved.method)}${o.resolved.simbad_id ? ` as <span class="mono">${esc(o.resolved.simbad_id)}</span>` : ""}</li>` : ""}</ul>
      <details><summary>Raw data (object.json)</summary><div><pre>${esc(JSON.stringify(o, null, 2))}</pre></div></details>`;
  }

  function images(o) {
    const im = o.images || {};
    const figs = [];
    if (im.photo) figs.push(`<figure class="photo"><img src="${esc(fileUrl(o, im.photo.file))}" alt="${esc(o.name)}"><figcaption>${esc(im.photo.credit)}</figcaption></figure>`);
    if (im.sky) figs.push(`<figure><img src="${esc(fileUrl(o, im.sky.file))}" alt="Sky around ${esc(o.name)}"><figcaption>${esc(im.sky.credit)} · ${num(im.sky.fov_deg, 1)}° field</figcaption></figure>`);
    return figs.length ? `<div class="images">${figs.join("")}</div>` : "";
  }

  async function renderDetail() {
    const path = decodeURIComponent(location.hash.slice(1));
    const layout = $(".layout");
    if (!path) {
      layout.classList.remove("showing");
      $("#detail").innerHTML = `<div class="empty">Pick an object on the left. ${state.objects.length} objects, ${state.objects.reduce((n, o) => n + o.observations, 0)} observations.</div>`;
      return;
    }
    layout.classList.add("showing");
    $("#detail").innerHTML = '<div class="empty">Loading…</div>';
    let o;
    try { o = await loadObject(path); }
    catch (e) { $("#detail").innerHTML = `<div class="empty">Could not load ${esc(path)}: ${esc(e.message)}</div>`; return; }
    const s = o.summary || {};
    const des = cleanId(s.designation);
    const tags = [CATEGORIES[o.category] || o.category, o.app_type, des && des !== o.name ? des : null]
      .filter(Boolean).map((t) => `<span class="tag">${esc(t)}</span>`).join("");
    $("#detail").innerHTML = `
      <a class="back" href="#">← All objects</a>
      <div class="hero"><div><h1>${esc(o.name)}</h1>${s.description ? `<div class="desc">${esc(s.description)}</div>` : ""}<div class="tags">${tags}</div></div>${images(o)}</div>
      ${keyFacts(o)}
      ${observationsTable(o)}
      ${about(o)}
      ${(o.simbad || o.wikidata || o.celestrak || o.horizons) ? `<h2>Details</h2>${satelliteDetails(o)}${planetDetails(o)}${simbadDetails(o)}${wikidataTable(o)}` : ""}
      ${links(o)}
      ${sources(o)}`;
    window.scrollTo({ top: 0 });
  }

  // ---------- events ----------
  $("#chips").addEventListener("click", (e) => {
    const b = e.target.closest(".chip"); if (!b) return;
    state.category = b.dataset.cat; renderChips(); renderList();
  });
  $("#search").addEventListener("input", (e) => { state.query = e.target.value.trim(); renderList(); });
  $("#sort").addEventListener("change", (e) => { state.sort = e.target.value; save("sort", state.sort); renderList(); });
  $("#night").addEventListener("click", () => {
    const on = document.documentElement.dataset.theme !== "night";
    setNight(on); save("night", on ? "1" : "");
  });
  $("#detail").addEventListener("click", (e) => {
    const img = e.target.closest(".images img"); if (!img) return;
    const lb = document.createElement("div"); lb.className = "lightbox";
    lb.innerHTML = `<img src="${img.src}" alt="">`; lb.onclick = () => lb.remove();
    document.body.appendChild(lb);
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
