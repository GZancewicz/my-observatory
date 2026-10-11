// Overview charts (PLAN.md workstream C).
// window.MO_CHARTS = { render(container, {data, sky, navigate}), destroy() }
// Plain JS + D3 v7 (window.d3). All chart chrome is styled in charts.css through the
// site's CSS tokens; data colours are read from CSS custom properties at render time,
// so night mode re-renders with its own steps.
(function () {
  "use strict";

  const RAD = Math.PI / 180;
  const CLASSES = ["O", "B", "A", "F", "G", "K", "M"];
  const CLASS_TEFF = { O: 35000, B: 15000, A: 9000, F: 6800, G: 5600, K: 4400, M: 3300 };
  const CAT_LABEL = { stars: "Stars", planets: "Planets", constellations: "Constellations", satellites: "Satellites" };
  // Fallback observing sites (data/locations.json is not in the bundle).
  const LOCATIONS = { "Royse City, Texas": { lat: 32.9751, lon: -96.3325 } };
  // Approximate main sequence (B-V, M_V) for H-R context.
  const MAIN_SEQ = [[-0.33, -5.7], [-0.30, -4.0], [-0.17, -1.2], [0.0, 0.6], [0.15, 1.9], [0.30, 2.7],
    [0.44, 3.5], [0.58, 4.4], [0.68, 5.1], [0.81, 5.9], [1.15, 7.4], [1.40, 8.8], [1.64, 12.3]];

  let S = null;          // live render state
  let saved = null;      // filters + selection kept between visits to #overview

  // ---------------------------------------------------------------- helpers
  function num(x) {
    if (x === null || x === undefined || x === "") return null;
    const n = typeof x === "number" ? x : parseFloat(x);
    return Number.isFinite(n) ? n : null;
  }
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
  // Glossary tooltips live in app.js (window.MO_TIP). data-gl="a|b" gives lookup candidates for an element.
  function gl(node, hints) { if (node && hints) node.setAttribute("data-gl", hints); return node; }
  function annotateRoot() { try { if (S && window.MO_TIP && window.MO_TIP.annotate) window.MO_TIP.annotate(S.root); } catch (e) { /* tooltips are optional */ } }
  function fmt(v, d) { return v === null || v === undefined ? "—" : (+v).toFixed(d === undefined ? 1 : d).replace("-", "−"); }
  function fmtInt(v) { return v === null || v === undefined ? "—" : d3.format(",")(Math.round(v)); }
  function norm360(a) { return ((a % 360) + 360) % 360; }
  function scale5(s) { // "3/5" -> 3 ; tolerant of junk after the digit
    if (s === null || s === undefined) return null;
    const m = String(s).match(/^\s*([0-5])/);
    return m ? +m[1] : null;
  }
  function bvToTeff(bv) { // Ballesteros (2012)
    if (bv === null) return null;
    return 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));
  }
  function teffToBv(t) { // numeric inverse of Ballesteros on [-0.4, 2.0]
    if (!t) return null;
    let lo = -0.4, hi = 2.0;
    for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (bvToTeff(mid) > t) lo = mid; else hi = mid; }
    return (lo + hi) / 2;
  }
  function specClassOf(sp) {
    if (!sp) return null;
    const m = String(sp).match(/[OBAFGKM]/);
    return m ? m[0] : null;
  }
  function lumClassOf(sp) {
    if (!sp) return null;
    const s = String(sp).replace(/^[a-z]+/, "");
    const m = s.match(/^[OBAFGKM][0-9.]*(?:[-\/][OBAFGKM]?[0-9.]*)?\s*(0|Ia\+|Iab|Ia|Ib|III|II|IV|VI|V|I)(?![a-z])/);
    return m ? m[1] : null;
  }
  // Local "YYYY-MM-DD HH:MM" -> night key (a night runs noon to noon, keyed by the evening date).
  function nightOf(dt) {
    const m = String(dt || "").match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}))?/);
    if (!m) return null;
    const t = Date.UTC(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 12) - 12 * 3600e3;
    return new Date(t).toISOString().slice(0, 10);
  }
  function nightLabel(key, short) {
    const d = new Date(key + "T12:00:00Z");
    const opts = short ? { day: "numeric", month: "short", timeZone: "UTC" } : { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" };
    return d.toLocaleDateString("en-GB", opts);
  }
  // Local sidereal time in degrees, which is the RA of the zenith, for a UTC Date and east longitude.
  function lstDeg(date, lon) {
    const jd = date.getTime() / 86400000 + 2440587.5;
    return norm360(280.46061837 + 360.98564736629 * (jd - 2451545) + lon);
  }
  // Alt/az at a UTC time and site -> RA/Dec (degrees). Az from north through east.
  function altAzToRaDec(alt, az, utc, site) {
    const m = String(utc || "").match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
    if (!m || !site) return null;
    const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
    const jd = ms / 86400000 + 2440587.5;
    const gmst = norm360(280.46061837 + 360.98564736629 * (jd - 2451545));
    const lst = norm360(gmst + site.lon);
    const a = alt * RAD, A = az * RAD, phi = site.lat * RAD;
    const sinDec = Math.sin(a) * Math.sin(phi) + Math.cos(a) * Math.cos(phi) * Math.cos(A);
    const dec = Math.asin(sinDec);
    const H = Math.atan2(-Math.sin(A) * Math.cos(a), Math.sin(a) * Math.cos(phi) - Math.cos(a) * Math.sin(phi) * Math.cos(A));
    return { ra: norm360(lst - H / RAD), dec: dec / RAD };
  }

  // ---------------------------------------------------------------- data prep
  function prep(data) {
    const objs = Object.values((data && data.objects) || {});
    const locs = Object.assign({}, LOCATIONS, (data && data.locations) || {});
    const objects = [], obs = [];
    objs.forEach((raw) => {
      const s = raw.summary || {}, sb = raw.simbad || {}, fl = sb.fluxes || {};
      const cat = raw.category || (raw.path || "").split("/")[0];
      const o = {
        raw, path: raw.path || (cat + "/" + raw.id), name: raw.name || raw.id, category: cat,
        type: s.object_type || raw.app_type || "", spType: s.spectral_type || sb.sp_type || null,
      };
      const obsRaw = (raw.observations || []).slice();
      // magnitude: catalogue V, else latest ephemeris magnitude (planets)
      o.v = num(s.v_mag);
      if (o.v === null && fl.V) o.v = num(fl.V.mag);
      if (o.v === null) {
        const eph = obsRaw.map((b) => b.ephemeris).filter((e) => e && num(e.mag) !== null);
        if (eph.length) o.v = num(eph[0].mag);
      }
      o.bv = num(s.b_minus_v);
      if (o.bv === null && fl.B && fl.V && num(fl.B.mag) !== null && num(fl.V.mag) !== null) o.bv = num(fl.B.mag) - num(fl.V.mag);
      o.teff = num(s.teff_k);
      if (o.teff === null) o.teff = num(sb.teff_median);
      if (o.bv === null && o.teff !== null && cat === "stars") o.bv = teffToBv(o.teff);
      if (o.teff === null && o.bv !== null) o.teff = bvToTeff(o.bv);
      o.distLy = num(s.distance_ly);
      o.distPc = num(s.distance_pc);
      if (o.distLy === null && o.distPc !== null) o.distLy = o.distPc * 3.26156;
      if (o.distPc === null && o.distLy !== null) o.distPc = o.distLy / 3.26156;
      const plx = num(sb.plx_value);
      o.absMag = num(s.abs_mag);
      if (o.absMag === null && cat === "stars" && o.v !== null) {
        if (plx && plx > 0) o.absMag = o.v + 5 * Math.log10(plx) - 10;
        else if (o.distPc && o.distPc > 0) o.absMag = o.v - 5 * Math.log10(o.distPc) + 5;
      }
      o.specClass = s.spectral_class || specClassOf(o.spType);
      if (o.specClass && CLASSES.indexOf(o.specClass) < 0) o.specClass = specClassOf(o.specClass);
      o.lumClass = s.luminosity_class || lumClassOf(o.spType);
      o.constellation = s.constellation || (cat === "constellations" ? o.name : null);
      o.abbr = s.abbreviation || null;
      o.ra = num(s.ra_deg); o.dec = num(s.dec_deg);
      if (o.ra === null && num(sb.ra) !== null) { o.ra = num(sb.ra); o.dec = num(sb.dec); }
      o.posComputed = false;
      if (o.ra === null) { // planets: position from the latest observation's alt/az
        const b = obsRaw.filter((x) => num(x.altitude_deg) !== null && num(x.azimuth_deg) !== null)
          .sort((p, q) => String(q.utc || q.datetime).localeCompare(String(p.utc || p.datetime)))[0];
        if (b) {
          const rd = altAzToRaDec(num(b.altitude_deg), num(b.azimuth_deg), b.utc, locs[b.location]);
          if (rd) { o.ra = rd.ra; o.dec = rd.dec; o.posComputed = true; }
        }
      }
      o.obs = [];
      const sorted = obsRaw.slice().sort((p, q) => String(p.utc || p.datetime).localeCompare(String(q.utc || q.datetime)));
      sorted.forEach((b, i) => {
        const r = {
          o, path: o.path, name: o.name, datetime: b.datetime, night: nightOf(b.datetime),
          rating: num(b.rating), seeing: scale5(b.seeing), transparency: scale5(b.transparency),
          alt: num(b.altitude_deg), az: num(b.azimuth_deg), incomplete: !!b.incomplete,
          location: b.location || "", utc: b.utc || null, isNew: i === 0, track: b.track || null,
        };
        const seen = r.track && (r.track.passes || []).find((q) => q.sighting);
        if (seen) {   // the logged time is often just after the pass; use the pass's highest point
          const top = seen.points.reduce((m, q) => (q[3] > m[3] ? q : m), seen.points[0]);
          r.alt = top[3]; r.az = top[4];
          if (o.ra === null) { o.ra = top[1]; o.dec = top[2]; o.posComputed = true; }
        }
        o.obs.push(r); obs.push(r);
      });
      const ratings = o.obs.map((b) => b.rating).filter((x) => x !== null);
      o.bestRating = ratings.length ? Math.max.apply(null, ratings) : null;
      objects.push(o);
    });
    const nightKeys = obs.map((b) => b.night).filter(Boolean).sort();
    const nights = [];
    if (nightKeys.length) {
      let t = Date.parse(nightKeys[0] + "T12:00:00Z");
      const end = Date.parse(nightKeys[nightKeys.length - 1] + "T12:00:00Z");
      for (; t <= end; t += 86400e3) nights.push(new Date(t).toISOString().slice(0, 10));
    }
    const vmax = d3.max(objects, (o) => o.v);
    return { objects, obs, nights, observedNights: Array.from(new Set(nightKeys)), magCeil: Math.ceil((vmax === undefined ? 8 : vmax) + 0.5) };
  }

  // ---------------------------------------------------------------- sky data
  function prepSky(sky) {
    if (!sky || !sky.boundaries) return null;
    const out = {};
    const rings = {};
    let maxRa = 0;
    const toRings = (v) => {
      if (!Array.isArray(v) || !v.length) return [];
      if (typeof v[0][0] === "number") return [v];
      if (Array.isArray(v[0][0]) && typeof v[0][0][0] === "number") return v;
      return v.flatMap(toRings);
    };
    Object.keys(sky.boundaries).forEach((k) => {
      const rs = toRings(sky.boundaries[k]).filter((r) => r.length > 2);
      rings[k] = rs;
      rs.forEach((r) => r.forEach((p) => { if (p[0] > maxRa) maxRa = p[0]; }));
    });
    const raMul = maxRa <= 24.0001 ? 15 : 1; // tolerate RA in hours
    Object.keys(rings).forEach((k) => {
      const lines = rings[k].map((r) => densify(r.map((p) => [p[0] * raMul, p[1]])));
      // centroid as mean unit vector of vertices
      let x = 0, y = 0, z = 0;
      rings[k].forEach((r) => r.forEach((p) => {
        const ra = p[0] * raMul * RAD, de = p[1] * RAD;
        x += Math.cos(de) * Math.cos(ra); y += Math.cos(de) * Math.sin(ra); z += Math.sin(de);
      }));
      const c = [norm360(Math.atan2(y, x) / RAD), Math.atan2(z, Math.hypot(x, y)) / RAD];
      out[k] = { lines, centroid: c, name: (sky.names && sky.names[k]) || k };
    });
    const byName = {};
    Object.keys(out).forEach((k) => { byName[String(out[k].name).toLowerCase()] = k; });
    return { byAbbr: out, byName };
  }
  function densify(ring) {
    const pts = [];
    const r = ring.slice();
    const f = r[0], l = r[r.length - 1];
    if (f[0] !== l[0] || f[1] !== l[1]) r.push(f);
    for (let i = 0; i < r.length - 1; i++) {
      const a = r[i], b = r[i + 1];
      let dra = b[0] - a[0];
      if (dra > 180) dra -= 360; if (dra < -180) dra += 360;
      const ddec = b[1] - a[1];
      const n = Math.max(1, Math.ceil(Math.max(Math.abs(dra), Math.abs(ddec)) / 2));
      for (let j = 0; j < n; j++) pts.push(lonlat(a[0] + dra * j / n, a[1] + ddec * j / n));
    }
    pts.push(lonlat(r[r.length - 1][0], r[r.length - 1][1]));
    return pts;
  }
  // RA increases to the left on the map: longitude = -RA.
  function lonlat(ra, dec) { return [((-ra + 540) % 360) - 180, dec]; }
  function hammerRaw(l, p) {
    const cp = Math.cos(p), d = Math.sqrt(1 + cp * Math.cos(l / 2));
    return [2 * Math.SQRT2 * cp * Math.sin(l / 2) / d, Math.SQRT2 * Math.sin(p) / d];
  }

  // ---------------------------------------------------------------- theme
  function readTheme() {
    const cs = getComputedStyle(S.root);
    const g = (n, fb) => (cs.getPropertyValue(n) || "").trim() || fb;
    const stops = [1, 2, 3, 4, 5].map((i) => g("--mo-temp-" + i, "#888"));
    const T = {
      surface: g("--mo-surface", "#131a2e"), text: g("--text", "#e6e9f2"), muted: g("--muted", "#8f9ab8"),
      line: g("--line", "#26304f"), accent: g("--accent", "#7aa2ff"), gold: g("--mo-planet", g("--gold", "#f5c542")),
      sNew: g("--mo-new", "#3987e5"), sRepeat: g("--mo-repeat", "#d95926"), point: g("--mo-point", "#3987e5"),
      unknown: g("--mo-unknown", "#8f9ab8"), stops,
    };
    const lt = [3000, 4200, 5800, 9000, 30000].map(Math.log);
    const sc = d3.scaleLinear().domain(lt).range(stops).interpolate(d3.interpolateRgb).clamp(true);
    T.temp = (t) => (t ? sc(Math.log(t)) : T.unknown);
    T.tempGradient = stops;
    return T;
  }
  function colorOf(o) {
    const T = S.theme;
    if (o.category === "planets") return T.gold;
    if (o.category !== "stars") return T.unknown;
    return T.temp(o.teff);
  }

  // ---------------------------------------------------------------- filters
  function defaultFilters(P) {
    return {
      nightFrom: P.nights[0] || null, nightTo: P.nights[P.nights.length - 1] || null,
      cats: [], classes: [], constellation: "", magMax: null, distMin: null, distMax: null,
      minRating: 0, minSeeing: 0, minTransp: 0,
    };
  }
  function obsFiltersActive(F, P) {
    return F.minRating > 0 || F.minSeeing > 0 || F.minTransp > 0 ||
      F.nightFrom !== P.nights[0] || F.nightTo !== P.nights[P.nights.length - 1];
  }
  function obsPass(b, F) {
    if (F.nightFrom && b.night && b.night < F.nightFrom) return false;
    if (F.nightTo && b.night && b.night > F.nightTo) return false;
    if (F.minRating > 0 && !(b.rating !== null && b.rating >= F.minRating)) return false;
    if (F.minSeeing > 0 && !(b.seeing !== null && b.seeing >= F.minSeeing)) return false;
    if (F.minTransp > 0 && !(b.transparency !== null && b.transparency >= F.minTransp)) return false;
    return true;
  }
  function objPass(o, F) {
    if (F.cats.length && F.cats.indexOf(o.category) < 0) return false;
    if (F.classes.length && F.classes.indexOf(o.specClass || "?") < 0) return false;
    if (F.constellation && o.constellation !== F.constellation) return false;
    if (F.magMax !== null && !(o.v !== null && o.v <= F.magMax)) return false;
    if (F.distMin !== null && !(o.distLy !== null && o.distLy >= F.distMin)) return false;
    if (F.distMax !== null && !(o.distLy !== null && o.distLy <= F.distMax)) return false;
    return true;
  }
  function applyFilters() {
    const F = S.filters, P = S.P;
    const active = obsFiltersActive(F, P);
    const objects = [], obs = [];
    P.objects.forEach((o) => {
      if (!objPass(o, F)) return;
      const ob = o.obs.filter((b) => obsPass(b, F));
      if (ob.length || (!o.obs.length && !active)) { objects.push(o); obs.push.apply(obs, ob); }
    });
    S.view = { objects, obs, paths: new Set(objects.map((o) => o.path)) };
  }

  // ---------------------------------------------------------------- selection (linked brushing)
  function setSelection(set, source) {
    S.selection = set || null; // an empty set (brush over nothing) dims everything
    S.selSource = S.selection ? source : null;
    S.charts.forEach((c) => { if (c.id !== source && c.clearBrush) c.clearBrush(); });
    updateSelection();
  }
  function updateSelection() {
    const sel = S.selection;
    S.charts.forEach((c) => c.applySelection && c.applySelection(sel));
    const n = sel ? S.view.objects.filter((o) => sel.has(o.path)).length : 0;
    S.selbar.hidden = !sel;
    S.selCount.textContent = sel ? (n === 1 ? "1 object highlighted" : n + " objects highlighted") : "";
    S.root.classList.toggle("has-selection", !!sel);
    if (S.table) S.table.querySelectorAll("tbody tr").forEach((tr) => tr.classList.toggle("is-sel", !!sel && sel.has(tr.dataset.path)));
  }
  function styleMarks(sel, selection, keyFn) {
    selection.classed("is-dim", (d) => !!sel && !sel.has(keyFn(d))).classed("is-sel", (d) => !!sel && sel.has(keyFn(d)));
  }

  // ---------------------------------------------------------------- tooltip
  function tipRows(rows) {
    const frag = document.createDocumentFragment();
    rows.forEach((r) => {
      if (r[1] === null || r[1] === undefined || r[1] === "—") return;
      const row = el("div", "mo-tip__row");
      row.appendChild(el("strong", null, r[1]));
      row.appendChild(el("span", null, r[0]));
      frag.appendChild(row);
    });
    return frag;
  }
  function objTip(o) {
    const head = el("div");
    head.appendChild(el("div", "mo-tip__title", o.name));
    const sub = [CAT_LABEL[o.category] ? CAT_LABEL[o.category].replace(/s$/, "") : o.category, o.spType, o.constellation && o.category !== "constellations" ? "in " + o.constellation : null].filter(Boolean).join(" · ");
    head.appendChild(el("div", "mo-tip__sub", sub));
    head.appendChild(tipRows([
      ["apparent mag V", o.v !== null ? fmt(o.v, 2) : null],
      ["absolute mag", o.absMag !== null ? fmt(o.absMag, 2) : null],
      ["B−V", o.bv !== null ? fmt(o.bv, 2) : null],
      ["temperature", o.teff ? fmtInt(o.teff) + " K" : null],
      ["distance", o.distLy !== null ? fmtInt(o.distLy) + " ly" : null],
      ["observations", String(o.obs.length)],
      ["best rating", o.bestRating !== null ? o.bestRating + " / 5" : null],
    ]));
    if (o.posComputed) head.appendChild(el("div", "mo-tip__note", "Position from the latest observation's altitude and azimuth"));
    head.appendChild(el("div", "mo-tip__hint", "Click to open"));
    return head;
  }
  function obsTip(b) {
    const head = el("div");
    head.appendChild(el("div", "mo-tip__title", b.name));
    head.appendChild(el("div", "mo-tip__sub", b.datetime + (b.incomplete ? " · incomplete log" : "")));
    head.appendChild(tipRows([
      ["rating", b.rating !== null ? b.rating + " / 5" : null],
      ["altitude", b.alt !== null ? fmt(b.alt, 1) + "°" : null],
      ["azimuth", b.az !== null ? fmt(b.az, 1) + "°" : null],
      ["seeing", b.seeing !== null ? b.seeing + " / 5" : null],
      ["transparency", b.transparency !== null ? b.transparency + " / 5" : null],
    ]));
    head.appendChild(el("div", "mo-tip__hint", "Click to open"));
    return head;
  }
  function showTip(ev, content) {
    const tip = S.tip;
    tip.replaceChildren(content);
    tip.hidden = false;
    const rr = S.root.getBoundingClientRect();
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let x = ev.clientX - rr.left + 14, y = ev.clientY - rr.top + 14;
    if (x + tw > rr.width - 4) x = ev.clientX - rr.left - tw - 14;
    if (x < 4) x = 4;
    if (ev.clientY + 14 + th > window.innerHeight - 4) y = ev.clientY - rr.top - th - 14;
    tip.style.transform = "translate(" + Math.round(x) + "px," + Math.round(y) + "px)";
  }
  function hideTip() { if (S && S.tip) S.tip.hidden = true; }

  // ---------------------------------------------------------------- shared chart pieces
  function makeSvg(plot, w, h, label) {
    return d3.select(plot).append("svg").attr("class", "mo-svg").attr("viewBox", [0, 0, w, h])
      .attr("width", w).attr("height", h).attr("role", "img").attr("aria-label", label);
  }
  function axisStyle(g) { g.attr("class", "mo-axis"); }
  function gridY(g, y, w) {
    g.attr("class", "mo-gridlines").selectAll("line").data(y.ticks(5)).join("line")
      .attr("x1", 0).attr("x2", w).attr("y1", (d) => y(d)).attr("y2", (d) => y(d));
  }
  function gridX(g, x, h, ticks) {
    g.attr("class", "mo-gridlines").selectAll("line").data(ticks || x.ticks(5)).join("line")
      .attr("y1", 0).attr("y2", h).attr("x1", (d) => x(d)).attr("x2", (d) => x(d));
  }
  function axisLabel(g, text, x, y, anchor, rotate, hints) {
    const t = g.append("text").attr("class", "mo-axis-label").attr("x", x).attr("y", y).attr("text-anchor", anchor || "middle").text(text);
    if (rotate) t.attr("transform", "rotate(-90," + x + "," + y + ")");
    if (hints) t.attr("data-gl", hints);
    return t;
  }
  function topRect(x, y, w, h, r) { // rounded data-end at the top, square at the baseline
    if (h <= 0) return "";
    r = Math.min(r, w / 2, h);
    return "M" + x + "," + (y + h) + "V" + (y + r) + "Q" + x + "," + y + " " + (x + r) + "," + y +
      "H" + (x + w - r) + "Q" + (x + w) + "," + y + " " + (x + w) + "," + (y + r) + "V" + (y + h) + "Z";
  }
  // Greedy label placement: skip labels that would collide.
  function placeLabels(g, cands, w, h, max) {
    const boxes = [];
    let n = 0;
    cands.forEach((c) => {
      if (n >= max) return;
      const tw = c.text.length * 6.3 + 2, th = 12;
      const opts = [[c.x + c.r + 4, c.y + 4, "start"], [c.x - c.r - 4, c.y + 4, "end"], [c.x, c.y - c.r - 5, "middle"], [c.x, c.y + c.r + 13, "middle"]];
      for (const [lx, ly, anchor] of opts) {
        const x0 = anchor === "start" ? lx : anchor === "end" ? lx - tw : lx - tw / 2;
        const b = [x0, ly - th + 2, x0 + tw, ly + 2];
        if (b[0] < 0 || b[2] > w || b[1] < 0 || b[3] > h) continue;
        if (boxes.some((q) => !(b[2] < q[0] || b[0] > q[2] || b[3] < q[1] || b[1] > q[3]))) continue;
        boxes.push(b);
        g.append("text").attr("class", "mo-label").attr("x", lx).attr("y", ly).attr("text-anchor", anchor).text(c.text);
        n++;
        break;
      }
    });
  }
  // Nearest-point hover, click-to-open and optional rectangular brush over a plot group.
  function interact(chart, svg, g, pts, opts) {
    const R = opts.radius || 16;
    const valid = pts.filter((p) => Number.isFinite(p.px) && Number.isFinite(p.py));
    const delaunay = valid.length ? d3.Delaunay.from(valid, (p) => p.px, (p) => p.py) : null;
    const ring = g.append("circle").attr("class", "mo-hover").attr("r", 0).style("display", "none");
    const nearest = (ev) => {
      if (!delaunay) return null;
      const [mx, my] = d3.pointer(ev, g.node());
      const i = delaunay.find(mx, my);
      const p = valid[i];
      return p && Math.hypot(p.px - mx, p.py - my) <= R ? p : null;
    };
    svg.on("pointermove.mo", (ev) => {
      if (S.brushing) return;
      const p = nearest(ev);
      if (!p) { ring.style("display", "none"); hideTip(); svg.classed("is-pointing", false); return; }
      ring.style("display", null).attr("cx", p.px).attr("cy", p.py).attr("r", (p.r || 4) + 3);
      svg.classed("is-pointing", true);
      showTip(ev, opts.tip(p));
    }).on("pointerleave.mo", () => { ring.style("display", "none"); hideTip(); });
    const open = (p) => { if (p && S.navigate) S.navigate(p.key); };
    const brushable = opts.brush && !S.coarse;
    if (!brushable) {
      svg.on("click.mo", (ev) => { const p = nearest(ev); if (p) open(p); });
      return;
    }
    const ext = opts.brush;
    const brush = d3.brush().extent(ext)
      .on("start", (ev) => { if (ev.sourceEvent) { S.brushing = true; hideTip(); ring.style("display", "none"); } })
      .on("brush end", (ev) => {
        if (!ev.sourceEvent) return;
        if (ev.type === "end") S.brushing = false;
        if (ev.selection) {
          const [[x0, y0], [x1, y1]] = ev.selection;
          // A real click usually moves a pixel or two; treat a tiny "brush" as a click.
          if (x1 - x0 < 6 && y1 - y0 < 6) {
            if (ev.type === "end") {
              bg.call(brush.move, null);
              const p = nearest(ev.sourceEvent);
              if (p) open(p);
              else if (S.selection) setSelection(null, chart.id);
            }
            return;
          }
          const set = new Set(valid.filter((p) => p.px >= x0 && p.px <= x1 && p.py >= y0 && p.py <= y1).map((p) => p.key));
          setSelection(set, chart.id);
        } else if (ev.type === "end") {
          const p = nearest(ev.sourceEvent);
          if (p) open(p);
          else if (S.selection) setSelection(null, chart.id);
        }
      });
    const bg = g.insert("g", ":first-child").attr("class", "mo-brush").call(brush);
    chart.clearBrush = () => { bg.call(brush.move, null); };
  }

  // ---------------------------------------------------------------- charts
  const CHARTS = [
    { id: "sky", wide: true, title: "All-sky map", gl: "All-sky map|celestial sphere|Hammer projection", sub: "Hammer projection of right ascension and declination, centred on 6h. Point size shows apparent brightness; colour shows temperature. Drag to highlight a region.", draw: drawSky },
    { id: "hr", title: "Hertzsprung–Russell diagram", gl: "Hertzsprung–Russell diagram|Hertzsprung-Russell diagram|H-R diagram|HR diagram", sub: "Colour index against absolute magnitude. Hot stars to the left, luminous stars at the top. Drag to highlight.", draw: drawHR },
    { id: "dist", title: "Distance and apparent magnitude", gl: "apparent magnitude|Distance and apparent magnitude", sub: "Diagonal lines join points of equal absolute magnitude M. Drag to highlight.", draw: drawDist },
    { id: "polar", title: "Where they were in my sky", gl: "altitude-azimuth|alt-az|horizontal coordinate system|altitude", sub: "Altitude and azimuth at each observation. Zenith at the centre, horizon at the rim, north up, east right.", draw: drawPolar },
    { id: "cond", title: "Conditions and rating", gl: "observing conditions|seeing", sub: "Rating of each observation against altitude, seeing and transparency. Ticks mark the mean rating.", draw: drawConditions },
    { id: "timeline", title: "Sessions", gl: "observing session|session", sub: "Observations per night (noon to noon local). Click a night to filter to it.", draw: drawTimeline },
    { id: "spec", title: "Spectral classes", gl: "spectral class|Spectral classes", sub: "Stars in view by spectral class, hottest to coolest. Click a bar to filter by class.", draw: drawSpectral },
  ];

  function legendTemp(leg, withShapes, withSize) {
    leg.replaceChildren();
    const T = S.theme;
    const item = gl(el("span", "mo-legend__item"), "effective temperature|temperature|kelvin");
    const bar = el("span", "mo-legend__ramp");
    bar.style.background = "linear-gradient(90deg," + T.tempGradient.slice().reverse().join(",") + ")";
    item.appendChild(el("span", "mo-legend__end", "30,000 K"));
    item.appendChild(bar);
    item.appendChild(el("span", "mo-legend__end", "3,000 K"));
    leg.appendChild(item);
    if (withSize) {
      const si = gl(el("span", "mo-legend__item"), "apparent magnitude|magnitude");
      [[0, 6.6], [3, 4.6], [6, 2.6]].forEach(([m, r]) => {
        const dot = el("span", "mo-legend__dot");
        dot.style.width = dot.style.height = (2 * r) + "px";
        si.appendChild(dot);
        si.appendChild(el("span", null, "V " + m));
      });
      leg.appendChild(si);
    }
    if (withShapes) {
      const a = gl(el("span", "mo-legend__item"), "planet");
      a.appendChild(el("span", "mo-legend__diamond")); a.appendChild(el("span", null, "Planet"));
      leg.appendChild(a);
      const b = gl(el("span", "mo-legend__item"), "constellation");
      b.appendChild(el("span", "mo-legend__cross", "+")); b.appendChild(el("span", null, "Constellation"));
      leg.appendChild(b);
    }
  }
  function emptyNote(plot, text) { plot.appendChild(el("p", "mo-empty", text)); }

  // ---- 1. H-R diagram
  function drawHR(chart, plot, W) {
    legendTemp(chart.legend, false, false);
    const data = S.view.objects.filter((o) => o.category === "stars" && o.bv !== null && o.absMag !== null);
    const missing = S.view.objects.filter((o) => o.category === "stars").length - data.length;
    chart.foot.textContent = missing > 0 ? missing + " star" + (missing > 1 ? "s" : "") + " in view lack colour or parallax and are not plotted." : "";
    if (!data.length) return emptyNote(plot, "No stars with colour index and absolute magnitude in view.");
    const m = { t: 10, r: 14, b: 42, l: 46 };
    const H = Math.round(Math.min(Math.max(W * 0.78, 300), 480));
    const w = W - m.l - m.r, h = H - m.t - m.b;
    const xe = d3.extent(data, (o) => o.bv), ye = d3.extent(data, (o) => o.absMag);
    const x = d3.scaleLinear().domain([Math.min(-0.4, xe[0] - 0.05), Math.max(1.9, xe[1] + 0.05)]).range([0, w]).nice();
    const y = d3.scaleLinear().domain([Math.floor(ye[0] - 0.6), Math.ceil(ye[1] + 0.6)]).range([0, h]);
    const svg = makeSvg(plot, W, H, "H-R diagram of " + data.length + " stars");
    const g = svg.append("g").attr("transform", "translate(" + m.l + "," + m.t + ")");
    g.append("g").call(gridY, y, w); g.append("g").call(gridX, x, h);
    const clipId = "mo-clip-hr";
    g.append("clipPath").attr("id", clipId).append("rect").attr("width", w).attr("height", h);
    g.append("path").attr("class", "mo-ref").attr("clip-path", "url(#" + clipId + ")")
      .attr("d", d3.line().curve(d3.curveMonotoneX).x((d) => x(d[0])).y((d) => y(d[1]))(MAIN_SEQ));
    const msLab = MAIN_SEQ.find((d) => x(d[0]) > w * 0.62 && y(d[1]) < h - 8);
    if (msLab) g.append("text").attr("class", "mo-ref-label").attr("x", x(msLab[0]) + 8).attr("y", y(msLab[1]) - 6).attr("data-gl", "main sequence").text("main sequence");
    g.append("g").attr("transform", "translate(0," + h + ")").call(d3.axisBottom(x).ticks(Math.max(3, Math.floor(w / 70))).tickSizeOuter(0)).call(axisStyle);
    g.append("g").call(d3.axisLeft(y).ticks(6).tickSizeOuter(0)).call(axisStyle);
    axisLabel(g, "B−V colour index  (hotter ←  → cooler)", w / 2, h + 34, null, false, "B−V colour index|B−V|colour index|color index");
    axisLabel(g, "Absolute magnitude  (brighter ↑)", -34, h / 2, "middle", true, "absolute magnitude");
    const pts = data.map((o) => ({ o, key: o.path, px: x(o.bv), py: y(o.absMag), r: 4.5 }));
    const marks = g.append("g").attr("class", "mo-marks").selectAll("circle").data(pts).join("circle")
      .attr("class", "mo-dot").attr("cx", (p) => p.px).attr("cy", (p) => p.py).attr("r", (p) => p.r)
      .attr("fill", (p) => colorOf(p.o));
    const lab = g.append("g");
    const cands = pts.slice().sort((a, b) => a.o.absMag - b.o.absMag).slice(0, 5)
      .concat(pts.slice().sort((a, b) => a.o.v - b.o.v).slice(0, 4))
      .map((p) => ({ x: p.px, y: p.py, r: p.r, text: p.o.name }));
    placeLabels(lab, uniqBy(cands, (c) => c.text), w, h, W < 500 ? 4 : 8);
    interact(chart, svg, g, pts, { tip: (p) => objTip(p.o), brush: [[0, 0], [w, h]] });
    chart.applySelection = (sel) => styleMarks(sel, marks, (p) => p.key);
  }
  function uniqBy(a, f) { const s = new Set(); return a.filter((x) => { const k = f(x); if (s.has(k)) return false; s.add(k); return true; }); }

  // Zenith path: the point overhead sits at Dec = site latitude and RA = local sidereal time,
  // so over a night it slides east along that declination. Dashed: the whole path; solid: the
  // stretch it covered during each observing session in view; dot: where it is right now.
  function drawZenith(g, proj, path, w) {
    const site = Object.values(LOCATIONS)[0];
    if (!site) return;
    const lat = site.lat;
    const arc = (ra0, ra1) => {
      const span = norm360(ra1 - ra0), n = Math.max(2, Math.ceil(span / 2));
      return d3.range(n + 1).map((i) => lonlat(norm360(ra0 + (span * i) / n), lat));
    };
    const zg = g.append("g").attr("class", "mo-zenith");
    zg.append("path").attr("class", "mo-zenith-path").attr("d", path({ type: "LineString", coordinates: arc(0, 359.9) }));
    const lp = proj(lonlat(250, lat));
    if (lp && w > 420) zg.append("text").attr("class", "mo-ref-label mo-zenith-label").attr("x", lp[0]).attr("y", lp[1] - 5)
      .attr("text-anchor", "middle").attr("data-gl", "zenith").text("zenith path (Dec +" + Math.round(lat) + "°)");
    // one segment per observing session: consecutive observations less than 90 minutes apart
    const times = S.view.obs.map((b) => (b.utc ? Date.parse(b.utc.replace(" ", "T") + ":00Z") : NaN))
      .filter(Number.isFinite).sort((p, q) => p - q);
    const sessions = [];
    times.forEach((t) => {
      const last = sessions[sessions.length - 1];
      if (last && t - last.t1 <= 90 * 60000) last.t1 = t; else sessions.push({ t0: t, t1: t });
    });
    const fmt = (t) => new Date(t).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    sessions.forEach((r) => {
      const ra0 = lstDeg(new Date(r.t0), site.lon), ra1 = lstDeg(new Date(r.t1 + 60000), site.lon);
      zg.append("path").attr("class", "mo-zenith-session").attr("d", path({ type: "LineString", coordinates: arc(ra0, ra1) }))
        .append("title").text("Overhead during your session " + fmt(r.t0) + " – " + fmt(r.t1).split(", ").pop() + " (RA " + (ra0 / 15).toFixed(1) + "h to " + (ra1 / 15).toFixed(1) + "h)");
    });
    // right now
    const now = proj(lonlat(lstDeg(new Date(), site.lon), lat));
    if (now) {
      zg.append("circle").attr("class", "mo-zenith-now").attr("cx", now[0]).attr("cy", now[1]).attr("r", 4.5);
      zg.append("text").attr("class", "mo-ref-label").attr("x", now[0] + 7).attr("y", now[1] - 6).attr("data-gl", "zenith").text("zenith now");
    }
  }

  // Satellite passes (±12 h around each sighting, computed at harvest time with SGP4).
  // project(point) -> [x, y] or a d3 line generator input; seen pass solid, others dashed.
  function satPasses() {
    const out = [];
    S.view.objects.filter((o) => o.category === "satellites").forEach((o) => o.obs.forEach((b) => {
      ((b.track && b.track.passes) || []).forEach((q) => out.push({ o, b, q }));
    }));
    return out;
  }
  function passTitle(x) {
    const fmt = (u) => new Date(u.replace(" ", "T") + ":00Z").toLocaleTimeString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    return x.o.name + ": pass " + fmt(x.q.start_utc) + " – " + fmt(x.q.end_utc).split(", ").pop() + ", up to " + Math.round(x.q.max_alt) + "° high" +
      (x.q.sighting ? " (the pass you saw)" : x.q.visible ? " (sunlit in a dark sky: visible)" : " (not visible: in shadow or daylight)");
  }
  function passLegend(leg) {
    if (!satPasses().length) return;
    const a = gl(el("span", "mo-legend__item"), "satellite pass|artificial satellite");
    a.appendChild(el("span", "mo-legend__pass is-seen")); a.appendChild(el("span", null, "Satellite pass you saw"));
    leg.appendChild(a);
    const b = gl(el("span", "mo-legend__item"), "satellite pass|artificial satellite");
    b.appendChild(el("span", "mo-legend__pass")); b.appendChild(el("span", null, "Other passes ±12 h"));
    leg.appendChild(b);
  }
  function passClass(q) { return "mo-sat-pass" + (q.sighting ? " is-seen" : q.visible ? " is-visible" : ""); }

  // ---- 2. All-sky map
  function drawSky(chart, plot, W) {
    legendTemp(chart.legend, true, true);
    const zl = gl(el("span", "mo-legend__item"), "zenith");
    zl.appendChild(el("span", "mo-legend__zenith"));
    zl.appendChild(el("span", null, "Overhead during my sessions"));
    chart.legend.appendChild(zl);
    passLegend(chart.legend);
    const SK = S.skyPrep;
    const m = { t: 8, r: 8, b: 8, l: 8 };
    const w = W - m.l - m.r, h = Math.round(w / 2);
    const H = h + m.t + m.b;
    const proj = d3.geoProjection(hammerRaw).rotate([90, 0]).precision(0.3)
      .fitExtent([[0, 0], [w, h]], { type: "Sphere" });
    const path = d3.geoPath(proj);
    const svg = makeSvg(plot, W, H, "All-sky map");
    // sphere fill sits in its own layer so the brush (first child of g) stays visible above it
    svg.append("path").attr("class", "mo-sphere").attr("transform", "translate(" + m.l + "," + m.t + ")").attr("d", path({ type: "Sphere" }));
    const g = svg.append("g").attr("transform", "translate(" + m.l + "," + m.t + ")");
    g.append("path").attr("class", "mo-graticule").attr("d", path(d3.geoGraticule().step([30, 30])()));
    // constellation boundaries
    const visibleCons = new Set(S.view.objects.map((o) => o.constellation).filter(Boolean).map((n) => n.toLowerCase()));
    const consObjAbbr = new Set();
    if (SK) {
      S.view.objects.filter((o) => o.category === "constellations").forEach((o) => {
        const k = (o.abbr && SK.byAbbr[o.abbr]) ? o.abbr : SK.byName[o.name.toLowerCase()];
        if (k) consObjAbbr.add(k);
      });
      const all = [], strong = [];
      Object.keys(SK.byAbbr).forEach((k) => (consObjAbbr.has(k) ? strong : all).push.apply(consObjAbbr.has(k) ? strong : all, SK.byAbbr[k].lines));
      g.append("path").attr("class", "mo-bound").attr("d", path({ type: "MultiLineString", coordinates: all }));
      if (strong.length) g.append("path").attr("class", "mo-bound is-strong").attr("d", path({ type: "MultiLineString", coordinates: strong }));
      chart.foot.textContent = "";
    } else {
      chart.foot.textContent = "Constellation boundaries are not loaded (data/sky/boundaries.js).";
    }
    // celestial equator and ecliptic
    const eq = d3.range(0, 361, 2).map((ra) => lonlat(ra, 0));
    const eps = 23.4393 * RAD;
    const ecl = d3.range(0, 361, 2).map((l) => {
      const L = l * RAD;
      return lonlat(norm360(Math.atan2(Math.sin(L) * Math.cos(eps), Math.cos(L)) / RAD), Math.asin(Math.sin(eps) * Math.sin(L)) / RAD);
    });
    g.append("path").attr("class", "mo-equator").attr("d", path({ type: "LineString", coordinates: eq }));
    g.append("path").attr("class", "mo-ecliptic").attr("d", path({ type: "LineString", coordinates: ecl }));
    drawZenith(g, proj, path, w);
    const pEq = proj(lonlat(232, 0)), pEc = proj(ecl[121]);
    if (pEq) g.append("text").attr("class", "mo-ref-label").attr("x", pEq[0]).attr("y", pEq[1] - 4).attr("text-anchor", "middle").attr("data-gl", "celestial equator|equator").text("equator");
    if (pEc && w > 420) g.append("text").attr("class", "mo-ref-label").attr("x", pEc[0]).attr("y", pEc[1] - 5).attr("text-anchor", "middle").attr("data-gl", "ecliptic").text("ecliptic");
    // RA hour labels along the equator, Dec labels along the central meridian
    const hourStep = w < 520 ? 4 : 2;
    const ticks = g.append("g").attr("class", "mo-sky-ticks");
    d3.range(0, 24, hourStep).forEach((hh) => {
      if (hh === 6) return;
      const p = proj(lonlat(hh * 15, 0));
      if (p) ticks.append("text").attr("x", p[0]).attr("y", p[1] + 12).attr("text-anchor", "middle").attr("data-gl", "right ascension").text(hh + "h");
    });
    [-60, -30, 30, 60].forEach((dd) => {
      const p = proj(lonlat(90, dd));
      if (p) ticks.append("text").attr("x", p[0] + 4).attr("y", p[1] - 3).attr("data-gl", "declination").text((dd > 0 ? "+" : "−") + Math.abs(dd) + "°");
    });
    // constellation names for constellations with objects in view
    if (SK && w >= 520) {
      const cl = g.append("g").attr("class", "mo-cons-names");
      Object.keys(SK.byAbbr).forEach((k) => {
        const c = SK.byAbbr[k];
        if (!visibleCons.has(String(c.name).toLowerCase()) || consObjAbbr.has(k)) return;
        const p = proj(lonlat(c.centroid[0], c.centroid[1]));
        if (p) cl.append("text").attr("x", p[0]).attr("y", p[1]).attr("text-anchor", "middle").text(w < 520 ? k : c.name);
      });
    }
    // points
    const rScale = d3.scaleLinear().domain([-1.5, 7.5]).range([7, 2.4]).clamp(true);
    const placed = S.view.objects.filter((o) => o.ra !== null && o.dec !== null);
    const pts = placed.map((o) => {
      const p = proj(lonlat(o.ra, o.dec));
      return { o, key: o.path, px: p ? p[0] : NaN, py: p ? p[1] : NaN, r: o.category === "constellations" ? 7 : o.v !== null ? rScale(o.v) : 3 };
    }).sort((a, b) => b.r - a.r);
    const unplaced = S.view.objects.length - placed.length;
    if (unplaced > 0) chart.foot.textContent = (chart.foot.textContent ? chart.foot.textContent + " " : "") + unplaced + " object" + (unplaced > 1 ? "s" : "") + " without a position (satellites) not shown.";
    const sp = g.append("g").attr("class", "mo-passes");
    satPasses().sort((x, y) => x.q.sighting - y.q.sighting).forEach((x) => {
      sp.append("path").attr("class", passClass(x.q))
        .attr("d", path({ type: "LineString", coordinates: x.q.points.map((q) => lonlat(q[1], q[2])) }))
        .append("title").text(passTitle(x));
    });
    const mk = g.append("g").attr("class", "mo-marks");
    const stars = mk.selectAll("circle").data(pts.filter((p) => p.o.category !== "planets" && p.o.category !== "constellations")).join("circle")
      .attr("class", "mo-dot").attr("cx", (p) => p.px).attr("cy", (p) => p.py).attr("r", (p) => p.r).attr("fill", (p) => colorOf(p.o));
    const planets = mk.selectAll("path.mo-planet").data(pts.filter((p) => p.o.category === "planets")).join("path")
      .attr("class", "mo-dot mo-planet").attr("transform", (p) => "translate(" + p.px + "," + p.py + ")")
      .attr("d", d3.symbol(d3.symbolDiamond, 110)).attr("fill", S.theme.gold);
    const cons = mk.selectAll("path.mo-cons").data(pts.filter((p) => p.o.category === "constellations")).join("path")
      .attr("class", "mo-cons").attr("transform", (p) => "translate(" + p.px + "," + p.py + ")")
      .attr("d", d3.symbol(d3.symbolCross, 70));
    const lab = g.append("g");
    const cands = pts.filter((p) => p.o.category === "planets" || p.o.category === "constellations")
      .concat(pts.filter((p) => p.o.category === "stars" && p.o.v !== null).sort((a, b) => a.o.v - b.o.v))
      .map((p) => ({ x: p.px, y: p.py, r: p.r, text: p.o.name }));
    placeLabels(lab, cands.filter((c) => Number.isFinite(c.x)), w, h, w < 400 ? 4 : w < 620 ? 6 : 12);
    interact(chart, svg, g, pts, { tip: (p) => objTip(p.o), brush: [[0, 0], [w, h]], radius: 14 });
    chart.applySelection = (sel) => { [stars, planets, cons].forEach((s) => styleMarks(sel, s, (p) => p.key)); };
  }

  // ---- 3. Distance vs apparent magnitude
  function drawDist(chart, plot, W) {
    legendTemp(chart.legend, false, false);
    const data = S.view.objects.filter((o) => o.distLy !== null && o.distLy > 0 && o.v !== null);
    chart.foot.textContent = "";
    if (!data.length) return emptyNote(plot, "No objects with distance and magnitude in view.");
    const m = { t: 10, r: 40, b: 42, l: 46 };
    const H = Math.round(Math.min(Math.max(W * 0.78, 300), 480));
    const w = W - m.l - m.r, h = H - m.t - m.b;
    const xe = d3.extent(data, (o) => o.distLy), ye = d3.extent(data, (o) => o.v);
    const x = d3.scaleLog().domain([xe[0] / 1.6, xe[1] * 1.6]).range([0, w]);
    const y = d3.scaleLinear().domain([Math.floor(ye[0] - 0.5), Math.ceil(ye[1] + 0.5)]).range([0, h]);
    const svg = makeSvg(plot, W, H, "Distance against apparent magnitude");
    const g = svg.append("g").attr("transform", "translate(" + m.l + "," + m.t + ")");
    const xt = x.ticks().filter((t) => /^(1|3)/.test(String(t)) && String(t).replace(/^[13]/, "").replace(/0/g, "") === "");
    g.append("g").call(gridY, y, w); g.append("g").call(gridX, x, h, xt);
    const clipId = "mo-clip-dist";
    g.append("clipPath").attr("id", clipId).append("rect").attr("width", w).attr("height", h);
    const lines = g.append("g").attr("clip-path", "url(#" + clipId + ")");
    const labs = g.append("g");
    const mAt = (M, ly) => M + 5 * Math.log10(ly / 3.26156) - 5;
    const [d0, d1] = x.domain(), [y0, y1] = y.domain();
    let lastBottom = -Infinity;
    for (let M = -10; M <= 14; M += 2) {
      const a = mAt(M, d0), b = mAt(M, d1);
      if (b < y0 || a > y1) continue;
      lines.append("line").attr("class", "mo-ref").attr("x1", x(d0)).attr("y1", y(a)).attr("x2", x(d1)).attr("y2", y(b));
      const label = "M " + (M > 0 ? "+" : M < 0 ? "−" : "") + Math.abs(M);
      if (b >= y0 && b <= y1) labs.append("text").attr("class", "mo-ref-label").attr("x", w + 4).attr("y", y(b) + 3).attr("data-gl", "absolute magnitude").text(label);
      else { // exits through the bottom edge (faint): label where it crosses y1
        const ly = 3.26156 * Math.pow(10, (y1 - M + 5) / 5);
        if (ly > d0 && ly < d1 && x(ly) < w - 30 && x(ly) - lastBottom > 40 && (lastBottom = x(ly))) labs.append("text").attr("class", "mo-ref-label").attr("x", x(ly) + 3).attr("y", h - 4).attr("data-gl", "absolute magnitude").text(label);
      }
    }
    const fmtLy = (d) => (d >= 1000 ? d3.format(",")(d) : String(d));
    g.append("g").attr("transform", "translate(0," + h + ")").call(d3.axisBottom(x).tickValues(xt).tickFormat(fmtLy).tickSizeOuter(0)).call(axisStyle);
    g.append("g").call(d3.axisLeft(y).ticks(6).tickSizeOuter(0)).call(axisStyle);
    axisLabel(g, "Distance (light-years, log scale)", w / 2, h + 34, null, false, "light-year|logarithmic scale|distance");
    axisLabel(g, "Apparent magnitude V  (brighter ↑)", -34, h / 2, "middle", true, "apparent magnitude|V magnitude");
    const pts = data.map((o) => ({ o, key: o.path, px: x(o.distLy), py: y(o.v), r: 4.5 }));
    const marks = g.append("g").attr("class", "mo-marks").selectAll("circle").data(pts).join("circle")
      .attr("class", "mo-dot").attr("cx", (p) => p.px).attr("cy", (p) => p.py).attr("r", (p) => p.r).attr("fill", (p) => colorOf(p.o));
    const cands = pts.slice().sort((a, b) => a.o.v - b.o.v).slice(0, 3)
      .concat(pts.slice().sort((a, b) => b.o.distLy - a.o.distLy).slice(0, 2))
      .concat(pts.slice().sort((a, b) => a.o.distLy - b.o.distLy).slice(0, 2))
      .map((p) => ({ x: p.px, y: p.py, r: p.r, text: p.o.name }));
    placeLabels(g.append("g"), uniqBy(cands, (c) => c.text), w, h, W < 500 ? 4 : 7);
    interact(chart, svg, g, pts, { tip: (p) => objTip(p.o), brush: [[0, 0], [w, h]] });
    chart.applySelection = (sel) => styleMarks(sel, marks, (p) => p.key);
  }

  // ---- 4. Polar alt/az
  function drawPolar(chart, plot, W) {
    chart.legend.replaceChildren();
    legendTemp(chart.legend, false, false);
    const shape = gl(el("span", "mo-legend__item"), "planet");
    shape.appendChild(el("span", "mo-legend__diamond")); shape.appendChild(el("span", null, "Planet"));
    chart.legend.appendChild(shape);
    const all = S.view.obs.filter((b) => b.alt !== null && b.az !== null);
    const data = all.filter((b) => b.alt >= 0);
    const below = all.length - data.length, nopos = S.view.obs.length - all.length;
    const notes = [];
    if (below) notes.push(below + " observation" + (below > 1 ? "s" : "") + " logged below the horizon not shown.");
    if (nopos) notes.push(nopos + " without altitude and azimuth not shown.");
    chart.foot.textContent = notes.join(" ");
    const size = Math.min(W, 440);
    const R = size / 2 - 22;
    const svg = makeSvg(plot, W, size, "Altitude-azimuth plot of " + data.length + " observations");
    const g = svg.append("g").attr("transform", "translate(" + W / 2 + "," + size / 2 + ")");
    const r = d3.scaleLinear().domain([90, 0]).range([0, R]);
    const grid = g.append("g").attr("class", "mo-gridlines");
    [0, 30, 60].forEach((a) => grid.append("circle").attr("r", r(a)).attr("class", a === 0 ? "is-horizon" : null));
    d3.range(0, 360, 45).forEach((az) => grid.append("line").attr("x1", 0).attr("y1", 0)
      .attr("x2", R * Math.sin(az * RAD)).attr("y2", -R * Math.cos(az * RAD)));
    const t = g.append("g").attr("class", "mo-sky-ticks");
    [30, 60].forEach((a) => t.append("text").attr("x", 3).attr("y", -r(a) - 3).attr("data-gl", "altitude").text(a + "°"));
    [["N", 0], ["E", 90], ["S", 180], ["W", 270]].forEach(([n, az]) => t.append("text").attr("class", "mo-compass")
      .attr("x", (R + 12) * Math.sin(az * RAD)).attr("y", -(R + 12) * Math.cos(az * RAD) + 4).attr("text-anchor", "middle").attr("data-gl", "azimuth|cardinal direction").text(n));
    const pts = data.map((b) => ({ b, o: b.o, key: b.path, px: r(b.alt) * Math.sin(b.az * RAD), py: -r(b.alt) * Math.cos(b.az * RAD), r: 4.5 }));
    passLegend(chart.legend);
    const line = d3.line().x((q) => r(q[3]) * Math.sin(q[4] * RAD)).y((q) => -r(q[3]) * Math.cos(q[4] * RAD)).curve(d3.curveCatmullRom);
    const sp = g.append("g").attr("class", "mo-passes");
    satPasses().sort((x, y) => x.q.sighting - y.q.sighting).forEach((x) => {
      sp.append("path").attr("class", passClass(x.q)).attr("d", line(x.q.points)).append("title").text(passTitle(x));
      if (x.q.sighting) {   // arrowhead at the end shows the direction of travel
        const [a, b2] = x.q.points.slice(-2);
        const [x1, y1, x2, y2] = [r(a[3]) * Math.sin(a[4] * RAD), -r(a[3]) * Math.cos(a[4] * RAD), r(b2[3]) * Math.sin(b2[4] * RAD), -r(b2[3]) * Math.cos(b2[4] * RAD)];
        sp.append("path").attr("class", "mo-sat-arrow").attr("d", d3.symbol(d3.symbolTriangle, 60)())
          .attr("transform", "translate(" + x2 + "," + y2 + ") rotate(" + (Math.atan2(y2 - y1, x2 - x1) / RAD + 90) + ")");
      }
    });
    const mk = g.append("g").attr("class", "mo-marks");
    const dots = mk.selectAll("circle").data(pts.filter((p) => p.o.category !== "planets")).join("circle")
      .attr("class", "mo-dot").attr("cx", (p) => p.px).attr("cy", (p) => p.py).attr("r", (p) => p.r).attr("fill", (p) => colorOf(p.o));
    const planets = mk.selectAll("path").data(pts.filter((p) => p.o.category === "planets")).join("path")
      .attr("class", "mo-dot mo-planet").attr("transform", (p) => "translate(" + p.px + "," + p.py + ")")
      .attr("d", d3.symbol(d3.symbolDiamond, 110)).attr("fill", S.theme.gold);
    if (!pts.length) g.append("text").attr("class", "mo-axis-label").attr("text-anchor", "middle").attr("y", 4).text("No observations in view");
    interact(chart, svg, g, pts, { tip: (p) => obsTip(p.b), brush: [[-R, -R], [R, R]] });
    chart.applySelection = (sel) => { styleMarks(sel, dots, (p) => p.key); styleMarks(sel, planets, (p) => p.key); };
  }

  // ---- 5. Conditions vs rating (small multiples, shared y)
  function drawConditions(chart, plot, W) {
    chart.legend.replaceChildren();
    const data = S.view.obs.filter((b) => b.rating !== null);
    const unrated = S.view.obs.length - data.length;
    chart.foot.textContent = unrated ? unrated + " observation" + (unrated > 1 ? "s" : "") + " without a rating not shown." : "";
    const cols = W >= 520 ? 3 : 1;
    const gap = 18, m = { t: 8, r: 8, b: 40, l: 40 };
    const pw = cols === 3 ? (W - m.l - m.r - gap * 2) / 3 : W - m.l - m.r;
    const ph = cols === 3 ? Math.min(220, Math.max(160, pw * 0.9)) : 170;
    const H = cols === 3 ? m.t + ph + m.b : 3 * (ph + m.b) + m.t;
    const svg = makeSvg(plot, W, H, "Rating against altitude, seeing and transparency");
    const y = d3.scaleLinear().domain([0.5, 5.5]).range([ph, 0]);
    const jit = (b, k) => { // deterministic jitter
      let hsh = 0; const s = b.path + b.datetime + k;
      for (let i = 0; i < s.length; i++) hsh = (hsh * 31 + s.charCodeAt(i)) | 0;
      return ((hsh & 0xffff) / 0xffff - 0.5);
    };
    const panels = [
      { key: "alt", label: "Altitude (°)", gl: "altitude", x: d3.scaleLinear().domain([0, 90]).range([0, pw]), get: (b) => b.alt, cont: true },
      { key: "seeing", label: "Seeing (1–5)", gl: "seeing", x: d3.scaleLinear().domain([0.5, 5.5]).range([0, pw]), get: (b) => b.seeing },
      { key: "transparency", label: "Transparency (1–5)", gl: "transparency", x: d3.scaleLinear().domain([0.5, 5.5]).range([0, pw]), get: (b) => b.transparency },
    ];
    const allMarks = [];
    panels.forEach((p, i) => {
      const ox = cols === 3 ? m.l + i * (pw + gap) : m.l;
      const oy = cols === 3 ? m.t : m.t + i * (ph + m.b);
      const g = svg.append("g").attr("transform", "translate(" + ox + "," + oy + ")");
      g.append("g").call(gridY, y, pw);
      g.append("g").attr("transform", "translate(0," + ph + ")")
        .call(d3.axisBottom(p.x).ticks(p.cont ? 4 : 5).tickFormat(d3.format("d")).tickSizeOuter(0)).call(axisStyle);
      const ya = g.append("g").call(d3.axisLeft(y).ticks(5).tickFormat(d3.format("d")).tickSizeOuter(0)).call(axisStyle);
      if (i > 0 && cols === 3) ya.selectAll("text").remove();
      axisLabel(g, p.label, pw / 2, ph + 32, null, false, p.gl);
      if (i === 0 || cols === 1) axisLabel(g, "Rating", -28, ph / 2, "middle", true, "rating");
      const sub = data.filter((b) => p.get(b) !== null);
      const pts = sub.map((b) => ({
        b, o: b.o, key: b.path, r: 3.5,
        px: p.x(p.get(b) + (p.cont ? 0 : jit(b, p.key) * 0.5)),
        py: y(b.rating + jit(b, "r" + p.key) * 0.45),
      }));
      const marks = g.append("g").attr("class", "mo-marks").selectAll("circle").data(pts).join("circle")
        .attr("class", "mo-dot mo-dot--plain").attr("cx", (d) => d.px).attr("cy", (d) => d.py).attr("r", (d) => d.r)
        .attr("fill", S.theme.point);
      allMarks.push(marks);
      if (!p.cont) { // mean rating per level, drawn above the dots
        const means = d3.rollups(sub, (v) => d3.mean(v, (b) => b.rating), (b) => p.get(b));
        g.append("g").selectAll("line").data(means).join("line").attr("class", "mo-mean")
          .attr("x1", (d) => p.x(d[0]) - pw / 14).attr("x2", (d) => p.x(d[0]) + pw / 14)
          .attr("y1", (d) => y(d[1])).attr("y2", (d) => y(d[1]));
      }
      interact(chart, svg, g, pts, { tip: (d) => obsTip(d.b), radius: 12 });
    });
    chart.applySelection = (sel) => allMarks.forEach((mk) => styleMarks(sel, mk, (d) => d.key));
  }

  // ---- 6. Sessions timeline
  function drawTimeline(chart, plot, W) {
    const leg = chart.legend; leg.replaceChildren();
    [["New object", "--mo-new"], ["Repeat", "--mo-repeat"]].forEach(([t, v]) => {
      const it = gl(el("span", "mo-legend__item"), t === "New object" ? "new object|first observation" : "repeat observation|repeat"); const sw = el("span", "mo-legend__rect");
      sw.style.background = "var(" + v + ")"; it.appendChild(sw); it.appendChild(el("span", null, t)); leg.appendChild(it);
    });
    const sl = el("span", "mo-legend__item mo-legend__selkey"); sl.appendChild(el("span", "mo-legend__rect mo-legend__rect--sel")); sl.appendChild(el("span", null, "Highlighted")); gl(sl, "linked brushing|highlight"); leg.appendChild(sl);
    chart.foot.textContent = "";
    const nights = S.P.nights;
    const by = d3.group(S.view.obs, (b) => b.night);
    const rows = nights.map((n) => {
      const v = by.get(n) || [];
      return { night: n, obs: v, nNew: v.filter((b) => b.isNew).length, nRep: v.filter((b) => !b.isNew).length };
    });
    const m = { t: 18, r: 8, b: 36, l: 36 };
    const H = 240, w = W - m.l - m.r, h = H - m.t - m.b;
    const x = d3.scaleBand().domain(nights).range([0, w]).paddingInner(0.2);
    const ymax = d3.max(rows, (d) => d.obs.length) || 1;
    const y = d3.scaleLinear().domain([0, ymax]).nice().range([h, 0]);
    const bw = Math.min(24, x.bandwidth());
    const svg = makeSvg(plot, W, H, "Observations per night");
    const g = svg.append("g").attr("transform", "translate(" + m.l + "," + m.t + ")");
    g.append("g").call(gridY, y, w);
    const every = Math.ceil(nights.length / Math.max(1, Math.floor(w / 58)));
    g.append("g").attr("transform", "translate(0," + h + ")")
      .call(d3.axisBottom(x).tickValues(nights.filter((n, i) => i % every === 0)).tickFormat((n) => nightLabel(n, true)).tickSizeOuter(0)).call(axisStyle);
    g.append("g").call(d3.axisLeft(y).ticks(4).tickFormat(d3.format("d")).tickSizeOuter(0)).call(axisStyle);
    const col = g.selectAll("g.mo-col").data(rows).join("g").attr("class", "mo-col")
      .attr("transform", (d) => "translate(" + (x(d.night) + (x.bandwidth() - bw) / 2) + ",0)");
    col.append("path").attr("class", "mo-bar").attr("fill", "var(--mo-new)")
      .attr("d", (d) => { const top = y(d.nNew); return d.nRep ? (d.nNew ? "M0," + top + "H" + bw + "V" + h + "H0Z" : "") : topRect(0, top, bw, h - top, 4); });
    col.append("path").attr("class", "mo-bar").attr("fill", "var(--mo-repeat)")
      .attr("d", (d) => { if (!d.nRep) return ""; const base = y(d.nNew) - (d.nNew ? 2 : 0); const top = y(d.obs.length); return topRect(0, top, bw, Math.max(0, base - top), 4); });
    col.append("text").attr("class", "mo-cap").attr("x", bw / 2).attr("y", (d) => y(d.obs.length) - 5).attr("text-anchor", "middle")
      .text((d) => (d.obs.length ? d.obs.length : ""));
    const selBar = col.append("path").attr("class", "mo-selbar");
    col.append("rect").attr("class", "mo-hit").attr("x", -(x.bandwidth() - bw) / 2).attr("width", x.bandwidth()).attr("y", 0).attr("height", h)
      .on("pointermove", (ev, d) => {
        const c = el("div");
        c.appendChild(el("div", "mo-tip__title", nightLabel(d.night)));
        c.appendChild(el("div", "mo-tip__sub", "Night starting " + d.night));
        c.appendChild(tipRows([["observations", String(d.obs.length)], ["new objects", String(d.nNew)], ["repeats", String(d.nRep)],
          ["highlighted", S.selection ? String(d.obs.filter((b) => S.selection.has(b.path)).length) : null]]));
        if (d.obs.length) c.appendChild(el("div", "mo-tip__hint", "Click to filter to this night"));
        showTip(ev, c);
      })
      .on("pointerleave", hideTip)
      .on("click", (ev, d) => {
        if (!d.obs.length && !S.view.obs.length) return;
        const F = S.filters;
        if (F.nightFrom === d.night && F.nightTo === d.night) { F.nightFrom = nights[0]; F.nightTo = nights[nights.length - 1]; }
        else { F.nightFrom = d.night; F.nightTo = d.night; }
        syncControls(); refresh();
      });
    chart.applySelection = (sel) => {
      col.classed("is-dimbar", !!sel);
      selBar.attr("d", (d) => {
        if (!sel) return "";
        const n = d.obs.filter((b) => sel.has(b.path)).length;
        const sw = Math.max(4, bw * 0.4);
        return n ? topRect((bw - sw) / 2, y(n), sw, h - y(n), 2) : "";
      });
    };
  }

  // ---- 7. Spectral class breakdown
  function drawSpectral(chart, plot, W) {
    chart.legend.replaceChildren();
    const sl = el("span", "mo-legend__item mo-legend__selkey"); sl.appendChild(el("span", "mo-legend__rect mo-legend__rect--sel")); sl.appendChild(el("span", null, "Highlighted")); gl(sl, "linked brushing|highlight"); chart.legend.appendChild(sl);
    const stars = S.view.objects.filter((o) => o.category === "stars");
    const rows = CLASSES.map((c) => ({ c, objs: stars.filter((o) => o.specClass === c) }));
    const none = stars.filter((o) => !o.specClass).length;
    chart.foot.textContent = none ? none + " star" + (none > 1 ? "s" : "") + " in view without a spectral type." : "";
    const m = { t: 18, r: 8, b: 36, l: 36 };
    const H = 240, w = W - m.l - m.r, h = H - m.t - m.b;
    const x = d3.scaleBand().domain(CLASSES).range([0, w]).paddingInner(0.25);
    const y = d3.scaleLinear().domain([0, d3.max(rows, (d) => d.objs.length) || 1]).nice().range([h, 0]);
    const bw = Math.min(24, x.bandwidth());
    const svg = makeSvg(plot, W, H, "Stars by spectral class");
    const g = svg.append("g").attr("transform", "translate(" + m.l + "," + m.t + ")");
    g.append("g").call(gridY, y, w);
    g.append("g").attr("transform", "translate(0," + h + ")").call(d3.axisBottom(x).tickSizeOuter(0)).call(axisStyle)
      .selectAll(".tick text").attr("data-gl", "spectral class").attr("data-vk", "spectral_type").attr("data-vv", (d) => d);
    g.append("g").call(d3.axisLeft(y).ticks(4).tickFormat(d3.format("d")).tickSizeOuter(0)).call(axisStyle);
    axisLabel(g, "Spectral class  (hottest → coolest)", w / 2, h + 32, null, false, "spectral class");
    const col = g.selectAll("g.mo-col").data(rows).join("g").attr("class", "mo-col")
      .classed("is-active", (d) => S.filters.classes.indexOf(d.c) >= 0)
      .attr("transform", (d) => "translate(" + (x(d.c) + (x.bandwidth() - bw) / 2) + ",0)");
    col.append("path").attr("class", "mo-bar").attr("fill", (d) => S.theme.temp(CLASS_TEFF[d.c]))
      .attr("d", (d) => topRect(0, y(d.objs.length), bw, h - y(d.objs.length), 4));
    col.append("text").attr("class", "mo-cap").attr("x", bw / 2).attr("y", (d) => y(d.objs.length) - 5).attr("text-anchor", "middle")
      .text((d) => (d.objs.length ? d.objs.length : ""));
    const selBar = col.append("path").attr("class", "mo-selbar");
    col.append("rect").attr("class", "mo-hit").attr("x", -(x.bandwidth() - bw) / 2).attr("width", x.bandwidth()).attr("y", 0).attr("height", h)
      .on("pointermove", (ev, d) => {
        const c = el("div");
        c.appendChild(el("div", "mo-tip__title", "Class " + d.c));
        c.appendChild(el("div", "mo-tip__sub", "about " + fmtInt(CLASS_TEFF[d.c]) + " K"));
        c.appendChild(tipRows([["stars", String(d.objs.length)],
          ["highlighted", S.selection ? String(d.objs.filter((o) => S.selection.has(o.path)).length) : null]]));
        const names = d.objs.slice(0, 8).map((o) => o.name).join(", ") + (d.objs.length > 8 ? ", …" : "");
        if (names) c.appendChild(el("div", "mo-tip__note", names));
        c.appendChild(el("div", "mo-tip__hint", S.filters.classes.indexOf(d.c) >= 0 ? "Click to remove class filter" : "Click to filter by class"));
        showTip(ev, c);
      })
      .on("pointerleave", hideTip)
      .on("click", (ev, d) => {
        const a = S.filters.classes, i = a.indexOf(d.c);
        if (i >= 0) a.splice(i, 1); else a.push(d.c);
        syncControls(); refresh();
      });
    chart.applySelection = (sel) => {
      col.classed("is-dimbar", !!sel);
      selBar.attr("d", (d) => {
        if (!sel) return "";
        const n = d.objs.filter((o) => sel.has(o.path)).length;
        const sw = Math.max(4, bw * 0.4);
        return n ? topRect((bw - sw) / 2, y(n), sw, h - y(n), 2) : "";
      });
    };
  }

  // ---------------------------------------------------------------- filter panel
  function field(label, control, cls, hints) {
    const f = el("label", "mo-field" + (cls ? " " + cls : ""));
    f.appendChild(gl(el("span", "mo-field__label", label), hints));
    f.appendChild(control);
    return f;
  }
  function selectEl(options, value, onChange) {
    const s = el("select", "mo-select");
    options.forEach(([v, t]) => { const o = el("option", null, t); o.value = v; s.appendChild(o); });
    s.value = value;
    s.addEventListener("change", () => onChange(s.value));
    return s;
  }
  function chipGroup(label, items, getArr, hints, chipKind) {
    const wrap = el("div", "mo-field mo-field--chips");
    wrap.appendChild(gl(el("span", "mo-field__label", label), hints));
    const row = el("div", "mo-chips"); row.setAttribute("role", "group"); row.setAttribute("aria-label", label);
    items.forEach(([v, t, n]) => {
      const b = el("button", "mo-chip"); b.type = "button"; b.dataset.value = v;
      if (chipKind && v !== "?") { b.dataset.vk = chipKind; b.dataset.vv = v; }
      b.appendChild(document.createTextNode(t));
      if (n !== undefined) b.appendChild(el("span", "mo-chip__n", String(n)));
      b.addEventListener("click", () => {
        const a = getArr(), i = a.indexOf(v);
        if (i >= 0) a.splice(i, 1); else a.push(v);
        syncControls(); refresh();
      });
      row.appendChild(b);
    });
    wrap.appendChild(row);
    return wrap;
  }
  function buildFilters(form) {
    const P = S.P, F = S.filters, C = S.controls = {};
    form.replaceChildren();
    // sessions
    const nightOpts = P.nights.map((n) => {
      const c = P.obs.filter((b) => b.night === n).length;
      return [n, nightLabel(n) + (c ? " (" + c + ")" : " (–)")];
    });
    C.from = selectEl(nightOpts, F.nightFrom, (v) => { F.nightFrom = v; if (F.nightTo < v) F.nightTo = v; syncControls(); refresh(); });
    C.to = selectEl(nightOpts, F.nightTo, (v) => { F.nightTo = v; if (F.nightFrom > v) F.nightFrom = v; syncControls(); refresh(); });
    const sess = el("div", "mo-field mo-field--range");
    sess.appendChild(gl(el("span", "mo-field__label", "Nights"), "observing session|night"));
    const sr = el("div", "mo-inline"); sr.appendChild(C.from); sr.appendChild(el("span", "mo-dash", "to")); sr.appendChild(C.to);
    sess.appendChild(sr);
    form.appendChild(sess);
    // category
    const cats = Object.keys(CAT_LABEL).filter((c) => P.objects.some((o) => o.category === c))
      .concat(Array.from(new Set(P.objects.map((o) => o.category))).filter((c) => !CAT_LABEL[c]));
    C.cats = chipGroup("Category", cats.map((c) => [c, CAT_LABEL[c] || c, P.objects.filter((o) => o.category === c).length]), () => F.cats);
    form.appendChild(C.cats);
    // spectral class
    const cl = CLASSES.map((c) => [c, c, P.objects.filter((o) => o.specClass === c).length]);
    cl.push(["?", "none", P.objects.filter((o) => !o.specClass).length]);
    C.classes = chipGroup("Spectral class", cl, () => F.classes, "spectral class", "spectral_type");
    form.appendChild(C.classes);
    // constellation
    const cons = d3.rollups(P.objects.filter((o) => o.constellation), (v) => v.length, (o) => o.constellation).sort((a, b) => d3.ascending(a[0], b[0]));
    C.cons = selectEl([["", "All constellations"]].concat(cons.map(([n, c]) => [n, n + " (" + c + ")"])), F.constellation, (v) => { F.constellation = v; refresh(); });
    form.appendChild(field("Constellation", C.cons, null, "constellation"));
    // magnitude limit
    const magWrap = el("div", "mo-field mo-field--mag");
    const ml = gl(el("span", "mo-field__label", "Magnitude limit "), "limiting magnitude|magnitude limit|apparent magnitude");
    C.magOut = el("output", "mo-out");
    ml.appendChild(C.magOut);
    magWrap.appendChild(ml);
    const mr = el("div", "mo-inline");
    C.mag = el("input", "mo-range"); C.mag.type = "range"; C.mag.min = "-3"; C.mag.max = String(P.magCeil); C.mag.step = "0.5";
    C.mag.setAttribute("aria-label", "Magnitude limit");
    C.mag.addEventListener("input", () => { const v = +C.mag.value; F.magMax = v >= P.magCeil ? null : v; syncControls(); refreshSoon(); });
    C.naked = gl(el("button", "mo-chip", "Naked eye ≤ 6"), "naked eye|naked-eye limit|limiting magnitude"); C.naked.type = "button";
    C.naked.addEventListener("click", () => { F.magMax = F.magMax === 6 ? null : 6; syncControls(); refresh(); });
    mr.appendChild(C.mag); mr.appendChild(C.naked);
    magWrap.appendChild(mr);
    form.appendChild(magWrap);
    // distance
    const dist = el("div", "mo-field mo-field--range");
    dist.appendChild(gl(el("span", "mo-field__label", "Distance (ly)"), "light-year|distance"));
    const dr = el("div", "mo-inline");
    const numIn = (ph, key) => {
      const i = el("input", "mo-num"); i.type = "number"; i.min = "0"; i.step = "any"; i.placeholder = ph; i.inputMode = "decimal";
      i.setAttribute("aria-label", "Distance " + ph + " (light-years)");
      i.addEventListener("input", () => { F[key] = num(i.value); refreshSoon(); });
      return i;
    };
    C.dmin = numIn("min", "distMin"); C.dmax = numIn("max", "distMax");
    dr.appendChild(C.dmin); dr.appendChild(el("span", "mo-dash", "to")); dr.appendChild(C.dmax);
    dist.appendChild(dr);
    form.appendChild(dist);
    // minimums
    const minOpts = (any) => [["0", any]].concat([1, 2, 3, 4, 5].map((n) => [String(n), "≥ " + n]));
    C.rating = selectEl(minOpts("Any"), String(F.minRating), (v) => { F.minRating = +v; refresh(); });
    C.seeing = selectEl(minOpts("Any"), String(F.minSeeing), (v) => { F.minSeeing = +v; refresh(); });
    C.transp = selectEl(minOpts("Any"), String(F.minTransp), (v) => { F.minTransp = +v; refresh(); });
    form.appendChild(field("Min rating", C.rating, "mo-field--small", "rating"));
    form.appendChild(field("Min seeing", C.seeing, "mo-field--small", "seeing"));
    form.appendChild(field("Min transparency", C.transp, "mo-field--small", "transparency"));
    // reset
    const rs = el("button", "mo-reset", "Reset"); rs.type = "button";
    rs.addEventListener("click", () => { S.filters = defaultFilters(S.P); setSelectionQuiet(null); buildFilters(form); refresh(); });
    const rw = el("div", "mo-field mo-field--reset"); rw.appendChild(rs);
    form.appendChild(rw);
    syncControls();
  }
  function setSelectionQuiet(sel) { S.selection = sel; S.selSource = null; }
  function syncControls() {
    const C = S.controls, F = S.filters, P = S.P;
    if (!C) return;
    C.from.value = F.nightFrom; C.to.value = F.nightTo;
    C.cats.querySelectorAll(".mo-chip").forEach((b) => b.setAttribute("aria-pressed", String(F.cats.indexOf(b.dataset.value) >= 0)));
    C.classes.querySelectorAll(".mo-chip").forEach((b) => b.setAttribute("aria-pressed", String(F.classes.indexOf(b.dataset.value) >= 0)));
    C.cons.value = F.constellation;
    C.mag.value = String(F.magMax === null ? P.magCeil : F.magMax);
    C.magOut.textContent = F.magMax === null ? "any" : "≤ " + fmt(F.magMax, 1);
    C.naked.setAttribute("aria-pressed", String(F.magMax === 6));
    if (document.activeElement !== C.dmin) C.dmin.value = F.distMin === null ? "" : String(F.distMin);
    if (document.activeElement !== C.dmax) C.dmax.value = F.distMax === null ? "" : String(F.distMax);
    C.rating.value = String(F.minRating); C.seeing.value = String(F.minSeeing); C.transp.value = String(F.minTransp);
  }

  // ---------------------------------------------------------------- table view
  function buildTable() {
    const wrap = S.table;
    const objs = S.view.objects.slice().sort((a, b) => d3.ascending(a.v === null ? 99 : a.v, b.v === null ? 99 : b.v));
    S.tableSummary.textContent = "Table of objects in view (" + objs.length + ")";
    const tbody = wrap.querySelector("tbody");
    tbody.replaceChildren();
    objs.forEach((o) => {
      const tr = el("tr"); tr.dataset.path = o.path;
      const td = el("td"); const a = el("a", null, o.name); a.href = "#" + o.path;
      a.addEventListener("click", (ev) => { ev.preventDefault(); if (S.navigate) S.navigate(o.path); });
      td.appendChild(a); tr.appendChild(td);
      [CAT_LABEL[o.category] || o.category, o.constellation || "—", o.spType || "—", fmt(o.v, 2), fmt(o.absMag, 2), fmt(o.bv, 2),
        o.distLy !== null ? fmtInt(o.distLy) : "—", String(o.obs.length), o.bestRating !== null ? String(o.bestRating) : "—"]
        .forEach((t, i) => tr.appendChild(el("td", i >= 3 ? "mo-num-cell" : null, t)));
      tbody.appendChild(tr);
    });
  }

  // ---------------------------------------------------------------- render loop
  let refreshTimer = null;
  function refreshSoon() { clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, 120); }
  function refresh() {
    if (!S) return;
    hideTip();
    applyFilters();
    const v = S.view, P = S.P;
    S.readout.textContent = v.objects.length + " of " + P.objects.length + " objects · " + v.obs.length + " of " + P.obs.length + " observations";
    drawCharts();
    buildTable();
    updateSelection();
    annotateRoot();
    saved = { filters: S.filters, selection: S.selection };
  }
  function drawCharts() {
    S.theme = readTheme();
    S.charts.forEach((c) => {
      c.plot.replaceChildren();
      c.clearBrush = null; c.applySelection = null;
      const W = Math.max(240, Math.floor(c.plot.clientWidth || c.card.clientWidth - 32));
      try { c.def.draw(c, c.plot, W); } catch (e) { console.error("MO_CHARTS " + c.id, e); emptyNote(c.plot, "This chart could not be drawn."); }
    });
  }

  function render(container, opts) {
    if (!window.d3) { container.textContent = "The charts need D3, which did not load."; return; }
    destroy();
    opts = opts || {};
    const data = opts.data || window.MO_DATA;
    const sky = opts.sky || window.MO_SKY;
    const root = el("div", "mo-overview");
    S = {
      root, container, navigate: opts.navigate || ((p) => { location.hash = p; }), charts: [],
      coarse: window.matchMedia && window.matchMedia("(pointer: coarse)").matches && !window.matchMedia("(any-pointer: fine)").matches,
      selection: null, selSource: null, listeners: [], observers: [],
    };
    S.P = prep(data);
    S.skyPrep = prepSky(sky);
    S.filters = saved && saved.filters ? saved.filters : defaultFilters(S.P);
    if (saved && saved.selection) S.selection = saved.selection;
    // header
    const head = el("header", "mo-head");
    head.appendChild(el("h1", "mo-title", "Overview"));
    S.readout = el("p", "mo-readout"); S.readout.setAttribute("aria-live", "polite");
    head.appendChild(S.readout);
    root.appendChild(head);
    const form = el("form", "mo-filters"); form.setAttribute("aria-label", "Filters");
    form.addEventListener("submit", (e) => e.preventDefault());
    root.appendChild(form);
    S.selbar = el("div", "mo-selbar"); S.selbar.hidden = true;
    S.selCount = el("span", "mo-selbar__count");
    const clr = el("button", "mo-chip", "Clear highlight"); clr.type = "button";
    clr.addEventListener("click", () => setSelection(null, null));
    S.selbar.appendChild(S.selCount); S.selbar.appendChild(clr);
    S.selbar.appendChild(el("span", "mo-selbar__hint", "Esc also clears"));
    root.appendChild(S.selbar);
    const grid = el("div", "mo-grid");
    CHARTS.forEach((def) => {
      const card = el("section", "mo-card" + (def.wide ? " mo-card--wide" : ""));
      card.dataset.chart = def.id;
      card.appendChild(gl(el("h2", "mo-card__title", def.title), def.gl));
      card.appendChild(el("p", "mo-card__sub", def.sub));
      const legend = el("div", "mo-legend");
      const plot = el("div", "mo-plot");
      const foot = el("p", "mo-card__foot");
      card.appendChild(legend); card.appendChild(plot); card.appendChild(foot);
      grid.appendChild(card);
      S.charts.push({ id: def.id, def, card, plot, legend, foot });
    });
    root.appendChild(grid);
    const det = el("details", "mo-table");
    S.tableSummary = el("summary", null, "Table of objects in view");
    det.appendChild(S.tableSummary);
    const tw = el("div", "mo-table__wrap");
    const table = el("table");
    const thead = el("thead"); const hr = el("tr");
    const TH_GL = { Constellation: "constellation", "Spectral type": "spectral type", V: "apparent magnitude|V magnitude", M: "absolute magnitude",
      "B−V": "B−V|colour index|color index", "Distance (ly)": "light-year|distance", "Obs.": "observation", Best: "rating" };
    ["Name", "Category", "Constellation", "Spectral type", "V", "M", "B−V", "Distance (ly)", "Obs.", "Best"].forEach((t, i) => hr.appendChild(gl(el("th", i >= 4 ? "mo-num-cell" : null, t), TH_GL[t])));
    thead.appendChild(hr); table.appendChild(thead); table.appendChild(el("tbody"));
    tw.appendChild(table); det.appendChild(tw); root.appendChild(det);
    S.table = det;
    S.tip = el("div", "mo-tip"); S.tip.hidden = true; S.tip.setAttribute("role", "tooltip");
    root.appendChild(S.tip);
    container.replaceChildren(root);
    buildFilters(form);
    refresh();
    // listeners
    const onKey = (e) => { if (e.key === "Escape" && S && S.selection) setSelection(null, null); };
    document.addEventListener("keydown", onKey);
    S.listeners.push(() => document.removeEventListener("keydown", onKey));
    let lastW = root.clientWidth, rt = null;
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(() => {
        const nw = root.clientWidth;
        if (Math.abs(nw - lastW) < 4) return;
        lastW = nw; clearTimeout(rt);
        rt = setTimeout(() => { if (S) { drawCharts(); updateSelection(); annotateRoot(); } }, 150);
      });
      ro.observe(root);
      S.observers.push(ro);
      S.listeners.push(() => clearTimeout(rt));
    }
    const mo = new MutationObserver(() => { if (S) { drawCharts(); updateSelection(); annotateRoot(); } });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
    S.observers.push(mo);
  }

  function destroy() {
    if (!S) return;
    clearTimeout(refreshTimer);
    S.listeners.forEach((f) => f());
    S.observers.forEach((o) => o.disconnect());
    if (S.root && S.root.parentNode) S.root.parentNode.removeChild(S.root);
    S = null;
  }

  window.MO_CHARTS = { render, destroy };
})();
