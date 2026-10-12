// Size comparison page (#sizes): every star and planet with a known or derivable radius,
// in a row (by size, distance or temperature), diameters on a logarithmic scale with a ruler beside each. Stars take their blackbody colour from
// the effective temperature; planets are plain grey spheres.
// window.MO_SIZES = { render(container, {data, navigate}), destroy(), prep(data), blackbody(t) }
(function () {
  "use strict";

  const R_SUN_KM = 695700;
  const T_SUN = 5772;
  const MBOL_SUN = 4.74;
  const R_EARTH_KM = 6371;
  // Catalogues give satellites a mass and an orbit but no size: typical full span in metres.
  const SAT_SPAN_M = [[/starlink/i, 11]];
  const EYE_LIMIT = 6.0;    // faintest V magnitude seen with the naked eye under a dark sky
  const BINO_LIMIT = 9.5;   // faintest V magnitude seen in typical 10×50 binoculars
  // Effective temperature by spectral type (dwarf scale, Pecaut & Mamajek 2013, rounded).
  const SPT_TEFF = {
    O: [[3, 44900], [5, 41400], [7, 36100], [9, 31900]],
    B: [[0, 31400], [1, 26000], [2, 20600], [3, 17000], [5, 15700], [7, 14000], [8, 12500], [9, 10700]],
    A: [[0, 9700], [2, 8840], [5, 8080], [7, 7800]],
    F: [[0, 7220], [2, 6810], [5, 6510], [8, 6170]],
    G: [[0, 5920], [2, 5770], [5, 5660], [8, 5490]],
    K: [[0, 5280], [2, 5040], [3, 4830], [5, 4450], [7, 4050]],
    M: [[0, 3850], [2, 3560], [4, 3210], [6, 2810], [9, 2400]],
  };

  // Row orders. Every order keeps the same log size scale; only the left-to-right sequence changes.
  const SORTS = {
    size: { label: "Size", order: "from smallest to largest", cmp: (a, b) => a.r - b.r },
    distance: { label: "Distance from Earth", order: "from nearest to farthest",
      cmp: (a, b) => (a.ly === null) - (b.ly === null) || a.ly - b.ly || a.r - b.r },
    temperature: { label: "Temperature", order: "from coolest to hottest (the satellite and planets, which have no stellar temperature, come first)",
      cmp: (a, b) => (a.teff || 0) - (b.teff || 0) || a.r - b.r },
  };
  let S = null;
  let sortKey = "size";   // kept between visits to #sizes

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
  function sig(v) { // 3 significant figures, thousands separated
    if (v === null || v === undefined) return "—";
    const a = Math.abs(v);
    const d = a >= 100 ? 0 : a >= 10 ? 1 : a >= 1 ? 2 : Math.min(6, 2 - Math.floor(Math.log10(a)));
    return (+v.toFixed(d)).toLocaleString("en-US", { maximumFractionDigits: d });
  }
  function lerp(a, b, t) { return a + (b - a) * t; }

  // ---------------------------------------------------------------- colour
  // Planck spectrum integrated against the CIE 1931 2° observer (Wyman, Sloan & Shirley 2013
  // multi-lobe fit), converted to sRGB (D65) and scaled so the brightest channel is 1.
  function lobe(l, mu, s1, s2) { const t = (l - mu) / (l < mu ? s1 : s2); return Math.exp(-0.5 * t * t); }
  const cache = new Map();
  function blackbody(t) {
    const key = Math.round(t / 10) * 10;
    if (cache.has(key)) return cache.get(key);
    let X = 0, Y = 0, Z = 0;
    for (let l = 380; l <= 780; l += 5) {
      const b = 1 / (Math.pow(l, 5) * (Math.exp(1.4388e7 / (l * key)) - 1));
      X += b * (1.056 * lobe(l, 599.8, 37.9, 31.0) + 0.362 * lobe(l, 442.0, 16.0, 26.7) - 0.065 * lobe(l, 501.1, 20.4, 26.2));
      Y += b * (0.821 * lobe(l, 568.8, 46.9, 40.5) + 0.286 * lobe(l, 530.9, 16.3, 31.1));
      Z += b * (1.217 * lobe(l, 437.0, 11.8, 36.0) + 0.681 * lobe(l, 459.0, 26.0, 13.8));
    }
    let rgb = [3.2406 * X - 1.5372 * Y - 0.4986 * Z, -0.9689 * X + 1.8758 * Y + 0.0415 * Z, 0.0557 * X - 0.2040 * Y + 1.0570 * Z];
    const lo = Math.min.apply(null, rgb);
    if (lo < 0) rgb = rgb.map((c) => c - lo);   // out of gamut: desaturate toward white
    const hi = Math.max.apply(null, rgb);
    rgb = rgb.map((c) => {
      c /= hi;
      c = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
      return Math.round(255 * Math.max(0, Math.min(1, c)));
    });
    cache.set(key, rgb);
    return rgb;
  }
  function css(rgb, k, a) {
    k = k === undefined ? 1 : k;
    const c = rgb.map((v) => (k >= 1 ? Math.round(v + (255 - v) * (k - 1)) : Math.round(v * k)));
    return a === undefined ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  }

  // ---------------------------------------------------------------- data
  function teffFromSpType(sp) {
    const m = String(sp || "").match(/([OBAFGKM])(\d(?:\.\d)?)?/);
    if (!m) return null;
    const rows = SPT_TEFF[m[1]], sub = m[2] === undefined ? 5 : +m[2];
    if (sub <= rows[0][0]) return rows[0][1];
    for (let i = 1; i < rows.length; i++) {
      if (sub <= rows[i][0]) {
        const [s0, t0] = rows[i - 1], [s1, t1] = rows[i];
        return Math.round(lerp(t0, t1, (sub - s0) / (s1 - s0)));
      }
    }
    return rows[rows.length - 1][1];
  }
  function bvToTeff(bv) { return 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62)); }   // Ballesteros (2012)
  function bolometricCorrection(t) { // Flower (1996) as corrected by Torres (2010)
    const x = Math.log10(t);
    if (x < 3.70) return -0.190537291496456e5 + x * (0.155144866764412e5 + x * (-0.421278819301717e4 + x * 0.381476328422343e3));
    if (x < 3.90) return -0.370510203809015e5 + x * (0.385672629965804e5 + x * (-0.150651486316025e5 + x * (0.261724637119416e4 + x * -0.170623810323864e3)));
    return -0.118115450538963e6 + x * (0.137145973583929e6 + x * (-0.636233812100225e5 + x * (0.147412923562646e5 + x * (-0.170587278406872e4 + x * 0.788731721804990e2))));
  }
  function radiusSun(q) { // a summary {value, unit} -> solar radii
    if (!q || num(q.value) === null) return null;
    const u = String(q.unit || "");
    if (u === "R☉" || /solar radi/i.test(u)) return num(q.value);
    if (u === "km") return num(q.value) / R_SUN_KM;
    if (u === "R⊕" || /earth radi/i.test(u)) return num(q.value) * 6371 / R_SUN_KM;
    return null;
  }

  function prep(data) {
    const shown = [], missing = [];
    Object.values((data && data.objects) || {}).forEach((raw) => {
      const cat = raw.category;
      if (cat !== "stars" && cat !== "planets" && cat !== "satellites") return;
      const s = raw.summary || {}, sb = raw.simbad || {};
      const o = { path: raw.path, name: raw.name, category: cat, type: s.object_type || raw.app_type || "", spType: s.spectral_type || null };
      o.ly = num(s.distance_ly);
      if (cat === "planets") {   // distance at the latest Horizons ephemeris row, AU -> ly
        const eph = ((raw.horizons || {}).ephemeris || []).filter((e) => num(e.delta) !== null);
        if (eph.length) o.ly = num(eph[eph.length - 1].delta) * 1.58125e-5;
      }
      o.v = num(s.v_mag);
      if (o.v === null && sb.fluxes && sb.fluxes.V) o.v = num(sb.fluxes.V.mag);
      if (o.v === null) {
        const eph = ((raw.horizons || {}).ephemeris || []).filter((e) => num(e.APmag) !== null);
        if (eph.length) o.v = num(eph[eph.length - 1].APmag);
      }
      o.r = radiusSun(s.radius);
      o.how = o.r !== null ? "catalogue" : null;
      if (cat === "satellites") {
        o.type = "Satellite";
        const span = SAT_SPAN_M.find(([re]) => re.test(o.name));
        if (span) { o.r = span[1] / 2000 / R_SUN_KM; o.how = "typical"; }
        // slant range at the sighting, from the mean orbit height and the altitude angle
        const h = (num(s.apogee_km) + num(s.perigee_km)) / 2, b = (raw.observations || []).find((x) => num(x.altitude_deg) !== null);
        if (h > 0 && b) {
          const a = num(b.altitude_deg) * Math.PI / 180, R = R_EARTH_KM;
          const km = Math.sqrt(Math.pow(R + h, 2) - Math.pow(R * Math.cos(a), 2)) - R * Math.sin(a);
          o.ly = km / 9.4607e12;
        }
      }
      if (cat === "stars") {
        o.teff = num(s.teff_k); o.teffHow = "measured";
        if (o.teff === null && o.spType) { o.teff = teffFromSpType(o.spType); o.teffHow = "spectral type"; }
        if (o.teff === null && num(s.b_minus_v) !== null) { o.teff = Math.round(bvToTeff(num(s.b_minus_v))); o.teffHow = "B−V colour"; }
        if (o.teff === null) o.teffHow = null;
        const L = s.luminosity && s.luminosity.unit === "L☉" ? num(s.luminosity.value) : null;
        if (o.r === null && o.teff && L) {
          o.r = Math.sqrt(L) * Math.pow(T_SUN / o.teff, 2);
          o.how = "luminosity";
        }
        let M = num(s.abs_mag);
        const plx = num(sb.plx_value), v = num(s.v_mag);
        if (M === null && v !== null && plx > 0) M = v + 5 * Math.log10(plx) - 10;
        if (o.r === null && o.teff && M !== null) {
          const lum = Math.pow(10, -0.4 * (M + bolometricCorrection(o.teff) - MBOL_SUN));
          o.r = Math.sqrt(lum) * Math.pow(T_SUN / o.teff, 2);
          o.how = "magnitude";
        }
        o.rgb = o.teff ? blackbody(o.teff) : null;
      }
      if (o.r === null || !(o.r > 0) || (cat === "stars" && !o.rgb)) { missing.push(o); return; }
      shown.push(o);
    });
    shown.sort((a, b) => a.r - b.r);
    missing.sort((a, b) => a.name.localeCompare(b.name));
    return { shown, missing };
  }

  // ---------------------------------------------------------------- layout
  // Diameters are drawn on a log scale: an object of radius R stands log10(R / 10^LOG_MIN) decades
  // tall (LOG_MIN is the decade below the smallest object), every object on the same baseline, so the rulers beside them all share one scale.
  const RULER_W = 40;   // ruler line plus its tick labels, left of each sphere
  function esc(t) { return String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]); }
  function decadeLabel(e) {
    if (e <= -4) return "10" + String(e).replace(/./g, (c) => "⁻⁰¹²³⁴⁵⁶⁷⁸⁹"["-0123456789".indexOf(c)]);
    return e < 0 ? (+Math.pow(10, e).toFixed(-e)).toString() : Math.pow(10, e).toLocaleString("en-US");
  }
  function logRange(list) {
    const rs = list.map((o) => Math.log10(o.r));
    return [Math.floor(Math.min.apply(null, rs)), Math.ceil(Math.max.apply(null, rs) - 1e-9)];
  }
  function subLabel(o) {
    if (o.category === "planets") return "planet";
    if (o.category === "satellites") return "satellite";
    return o.spType || Math.round(o.teff).toLocaleString("en-US") + " K";
  }
  function distanceText(o) {
    if (o.ly === null) return "distance unknown";
    if (o.ly < 1e-9) return sig(o.ly * 9.4607e12) + " km";   // satellites
    if (o.ly < 0.01) return sig(o.ly * 525960) + " light-minutes";   // planets
    return sig(o.ly) + " ly";
  }
  function visibility(o) {
    if (o.v === null) return { eye: null, bino: null };
    return { eye: o.v <= EYE_LIMIT, bino: o.v <= BINO_LIMIT };
  }
  function visText(o) {
    const vis = visibility(o);
    if (vis.eye === null) return "Visibility unknown (no V magnitude)";
    return "V " + o.v.toFixed(2).replace("-", "−") + " · " + (vis.eye ? "naked eye" : vis.bino ? "binoculars" : "telescope");
  }
  function radiusText(o) {
    const km = o.r * R_SUN_KM;
    return (o.how === "catalogue" ? "" : "≈ ") + (km < 1 ? sig(km * 1000) + " m" : sig(o.r) + " R☉");
  }

  function layout(list, plotH) {
    const [LOG_MIN, logMax] = logRange(list);
    const unit = plotH / (logMax - LOG_MIN);   // pixels per decade
    let x = 16;
    const items = list.map((o) => {
      const d = Math.max(2, unit * (Math.log10(o.r) - LOG_MIN));
      const nameW = 7.2 * o.name.length + 12;
      const body = RULER_W + 8 + d;
      const w = Math.max(body, nameW) + 14;
      const left = x + (w - body) / 2;
      const it = { o, d, rx: left + RULER_W, cx: left + RULER_W + 8 + d / 2, mid: x + w / 2 };
      x += w;
      return it;
    });
    return { items, unit, logMin: LOG_MIN, logMax, width: x + 16 };
  }

  // ---------------------------------------------------------------- drawing
  function rulerSvg(it, y0, unit, LOG_MIN) {
    const top = y0 - it.d, x = it.rx, out = [];
    out.push(`<line class="mo-sz-rule" x1="${x}" y1="${y0}" x2="${x}" y2="${top}"/>`);
    const eMax = Math.log10(it.o.r);
    for (let e = LOG_MIN; e <= Math.floor(eMax); e++) {
      for (let m = 1; m <= 9; m++) {
        const v = Math.log10(m) + e;
        if (v > eMax + 1e-9) break;
        const y = y0 - unit * (v - LOG_MIN);
        if (m === 1) {
          out.push(`<line class="mo-sz-tick" x1="${x - 7}" y1="${y}" x2="${x}" y2="${y}"/>`);
          if (y0 - y > 4 || e === LOG_MIN) out.push(`<text class="mo-sz-ticklabel" x="${x - 9}" y="${y + 3.5}">${decadeLabel(e)}</text>`);
        } else out.push(`<line class="mo-sz-tick mo-sz-tick--minor" x1="${x - 3.5}" y1="${y}" x2="${x}" y2="${y}"/>`);
      }
    }
    // the object's own value: a cap on the ruler and a dashed line to the top of the sphere
    out.push(`<line class="mo-sz-cap" x1="${x - 7}" y1="${top}" x2="${x + 4}" y2="${top}"/>`);
    out.push(`<line class="mo-sz-lead" x1="${x + 4}" y1="${top}" x2="${it.cx}" y2="${top}"/>`);
    return out.join("");
  }
  function sphereSvg(it, y0, k) {
    const o = it.o, r = it.d / 2, cy = y0 - r;
    if (o.category === "satellites") {   // a grey cube seen corner-on
      return `<polygon class="mo-sz-ball" data-k="${k}" points="${it.cx},${y0 - 2 * r} ${it.cx + r},${cy} ${it.cx},${y0} ${it.cx - r},${cy}" fill="url(#mo-sz-sat)"/>`;
    }
    if (o.category === "planets") return `<circle class="mo-sz-ball" data-k="${k}" cx="${it.cx}" cy="${cy}" r="${r}" fill="url(#mo-sz-planet)"/>`;
    return `<circle class="mo-sz-glow" cx="${it.cx}" cy="${cy}" r="${r * 1.12 + 2}" fill="url(#mo-sz-g${k})"/>` +
      `<circle class="mo-sz-ball" data-k="${k}" cx="${it.cx}" cy="${cy}" r="${r}" fill="url(#mo-sz-s${k})"/>`;
  }
  function defsSvg(list) {
    const out = ['<radialGradient id="mo-sz-planet" cx="50%" cy="50%" fx="35%" fy="32%" r="50%">' +
      '<stop offset="0" stop-color="#ececec"/><stop offset=".45" stop-color="#a4a4a4"/><stop offset="1" stop-color="#2c2c2c"/></radialGradient>',
      '<linearGradient id="mo-sz-sat" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" stop-color="#ececec"/><stop offset=".5" stop-color="#b4b4b4"/><stop offset=".5" stop-color="#6c6c6c"/><stop offset="1" stop-color="#2c2c2c"/></linearGradient>'];
    list.forEach((o, k) => {
      if (o.category !== "stars") return;
      const c = o.rgb;   // limb darkening: brighter centre, darker edge
      out.push(`<radialGradient id="mo-sz-s${k}"><stop offset="0" stop-color="${css(c, 1.45)}"/><stop offset=".55" stop-color="${css(c, 1.08)}"/>` +
        `<stop offset=".88" stop-color="${css(c, 0.85)}"/><stop offset="1" stop-color="${css(c, 0.6)}"/></radialGradient>`);
      out.push(`<radialGradient id="mo-sz-g${k}"><stop offset=".8" stop-color="${css(c, 1, 0.35)}"/><stop offset="1" stop-color="${css(c, 1, 0)}"/></radialGradient>`);
    });
    out.push('<symbol id="mo-sz-eye" viewBox="0 0 24 24"><path d="M1.5 12C4.5 6.5 8 4.5 12 4.5S19.5 6.5 22.5 12C19.5 17.5 16 19.5 12 19.5S4.5 17.5 1.5 12Z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3.6" fill="currentColor"/></symbol>');
    out.push('<symbol id="mo-sz-bino" viewBox="0 0 24 24"><rect x="2.5" y="3" width="7" height="10" rx="2" fill="currentColor"/><rect x="14.5" y="3" width="7" height="10" rx="2" fill="currentColor"/><rect x="9" y="6.5" width="6" height="3.5" fill="currentColor"/><circle cx="6" cy="16" r="5" fill="currentColor"/><circle cx="18" cy="16" r="5" fill="currentColor"/></symbol>');
    return "<defs>" + out.join("") + "</defs>";
  }

  function draw() {
    if (!S) return;
    const plotH = Math.round(Math.max(260, Math.min(460, window.innerHeight * 0.5)));
    const top = 30, y0 = top + plotH, h = y0 + 86;
    const L = layout(S.list, plotH);
    S.layout = L;
    const parts = [`<svg class="mo-sz-svg" width="${L.width}" height="${h}" viewBox="0 0 ${L.width} ${h}" role="img" aria-label="Stars and planets ${SORTS[sortKey].order}, with diameters on a logarithmic scale">`];
    parts.push(defsSvg(S.list));
    parts.push(`<line class="mo-sz-base" x1="0" y1="${y0 + 0.5}" x2="${L.width}" y2="${y0 + 0.5}"/>`);
    L.items.forEach((it, k) => {
      parts.push(`<g class="mo-sz-item" data-k="${k}">`);
      parts.push(rulerSvg(it, y0, L.unit, L.logMin));
      parts.push(sphereSvg(it, y0, k));
      parts.push(`<text class="mo-sz-value" x="${it.cx}" y="${y0 - it.d - 8}">${esc(radiusText(it.o))}</text>`);
      parts.push(`<text class="mo-sz-label" x="${it.mid}" y="${y0 + 20}">${esc(it.o.name)}</text>`);
      parts.push(`<text class="mo-sz-sublabel" x="${it.mid}" y="${y0 + 36}">${esc(subLabel(it.o))}</text>`);
      parts.push(`<text class="mo-sz-distance" x="${it.mid}" y="${y0 + 52}">${esc(distanceText(it.o))}</text>`);
      const vis = visibility(it.o), cls = (on) => "mo-sz-vis" + (on === null ? " is-unknown" : on ? "" : " is-off");
      parts.push(`<use class="${cls(vis.eye)}" href="#mo-sz-eye" x="${it.mid - 21}" y="${y0 + 62}" width="16" height="16"/>`);
      parts.push(`<use class="${cls(vis.bino)}" href="#mo-sz-bino" x="${it.mid + 5}" y="${y0 + 62}" width="16" height="16"/>`);
      parts.push("</g>");
    });
    parts.push("</svg>");
    S.strip.innerHTML = parts.join("");
  }

  // ---------------------------------------------------------------- interaction
  function tipHtml(o) {
    const km = o.r * R_SUN_KM;
    const how = { catalogue: "catalogue radius (Wikidata)", typical: "typical size for this kind of satellite (body and solar array); no catalogue size", luminosity: "estimated from luminosity and temperature",
      magnitude: "estimated from absolute magnitude and temperature" }[o.how];
    const rows = [
      `<strong>${esc(o.name)}</strong>`,
      esc(o.type + (o.spType ? " · " + o.spType : "")),
      (km < 1 ? `Radius ${esc(radiusText(o))}` : `Radius ${esc(sig(o.r))} R☉ · ${esc(sig(km))} km`) + (o.category === "planets" ? ` · ${esc(sig(km / 6371))} Earth radii` : ""),
      esc(how),
    ];
    rows.push(esc(visText(o)));
    rows.push("Distance from Earth " + esc(distanceText(o)) + (o.category === "planets" ? " (latest ephemeris)" : o.category === "satellites" ? " (line of sight at the sighting)" : ""));
    if (o.category === "stars") rows.push(`Temperature ${Math.round(o.teff).toLocaleString("en-US")} K (${esc(o.teffHow)})`);
    return rows.join("<br>");
  }
  function scrollToItem(k, smooth) {
    const it = S.layout.items[k];
    S.strip.scrollTo({ left: it.mid - S.strip.clientWidth / 2, behavior: smooth ? "smooth" : "auto" });
  }
  function bind() {
    const st = S.strip, on = (t, ev, fn) => { t.addEventListener(ev, fn); S.listeners.push(() => t.removeEventListener(ev, fn)); };
    on(st, "pointermove", (e) => {
      if (S.drag) {
        const dx = e.clientX - S.drag.x;
        if (Math.abs(dx) > 3) S.drag.moved = true;
        st.scrollLeft = S.drag.left - dx;
        S.tip.hidden = true;
        return;
      }
      const g = e.target.closest && e.target.closest(".mo-sz-item");
      if (!g) { S.tip.hidden = true; return; }
      S.tip.innerHTML = tipHtml(S.list[+g.dataset.k]);
      const r = S.stage.getBoundingClientRect();
      S.tip.hidden = false;
      const tw = S.tip.offsetWidth;
      S.tip.style.left = Math.max(4, Math.min(e.clientX - r.left + 14, r.width - tw - 4)) + "px";
      S.tip.style.top = Math.max(4, e.clientY - r.top - S.tip.offsetHeight - 10) + "px";
    });
    on(st, "pointerdown", (e) => { if (e.pointerType === "mouse" && e.button === 0) S.drag = { x: e.clientX, left: st.scrollLeft, moved: false }; });
    on(window, "pointerup", (e) => {
      const d = S.drag; S.drag = null;
      if (d && d.moved) return;
      const g = e.target.closest && e.target.closest(".mo-sz-item");
      if (g && st.contains(g)) S.navigate(S.list[+g.dataset.k].path);
    });
    on(st, "pointerleave", () => { S.tip.hidden = true; });
    on(st, "keydown", (e) => {
      const step = { ArrowRight: 240, ArrowLeft: -240 }[e.key];
      if (step === undefined) return;
      e.preventDefault(); st.scrollBy({ left: step, behavior: "smooth" });
    });
    on(S.pick, "change", () => scrollToItem(+S.pick.value, true));
    on(S.sort, "change", () => { sortKey = S.sort.value; applySort(); });
  }

  // ---------------------------------------------------------------- entry points
  function render(container, opts) {
    destroy();
    opts = opts || {};
    const P = prep(opts.data || window.MO_DATA);
    const root = el("div", "mo-sizes");
    if (!P.shown.length) { root.appendChild(el("p", "mo-empty", "No stars or planets with a known size.")); container.replaceChildren(root); return; }
    S = { root, all: P.shown, list: P.shown, listeners: [], observers: [], drag: null,
      navigate: opts.navigate || ((p) => { location.hash = p; }) };

    const head = el("header", "mo-sz-head");
    head.appendChild(el("h1", "mo-sz-title", "Sizes"));
    S.sub = el("p", "mo-sz-sub");
    S.subRest = " Each diameter is drawn on a logarithmic scale " +
      "from " + decadeLabel(logRange(P.shown)[0]) + " to " + decadeLabel(logRange(P.shown)[1]) + " solar radii (R☉), and the ruler beside each object reads its radius on that scale. " +
      "Star colours are the blackbody colour of each star's effective temperature; planets are grey spheres and satellites grey diamonds.";
    head.appendChild(S.sub);
    root.appendChild(head);

    const controls = el("div", "mo-sz-controls");
    S.sort = el("select", "mo-sz-pick"); S.sort.setAttribute("aria-label", "Sort by");
    Object.keys(SORTS).forEach((k) => { const op = el("option", null, SORTS[k].label); op.value = k; S.sort.appendChild(op); });
    S.sort.value = sortKey;
    controls.appendChild(el("span", "mo-sz-controls__label", "Sort by"));
    controls.appendChild(S.sort);
    S.pick = el("select", "mo-sz-pick"); S.pick.setAttribute("aria-label", "Jump to object");
    controls.appendChild(el("span", "mo-sz-controls__label", "Jump to"));
    controls.appendChild(S.pick);
    const legend = el("div", "mo-sz-legend");
    legend.appendChild(el("span", "mo-sz-legend__label", "Blackbody colour"));
    const bar = el("span", "mo-sz-legend__bar");
    const temps = [2500, 3000, 3500, 4000, 5000, 6000, 7000, 8500, 10000, 15000, 25000, 40000];
    bar.style.background = "linear-gradient(to right," + temps.map((t) => css(blackbody(t)) + " " + (100 * Math.log(t / 2500) / Math.log(40000 / 2500)).toFixed(1) + "%").join(",") + ")";
    legend.appendChild(el("span", "mo-sz-legend__end", "2,500 K"));
    legend.appendChild(bar);
    legend.appendChild(el("span", "mo-sz-legend__end", "40,000 K"));
    controls.appendChild(legend);
    root.appendChild(controls);

    S.stage = el("div", "mo-sz-stage");
    S.strip = el("div", "mo-sz-strip");
    S.strip.tabIndex = 0;
    S.tip = el("div", "mo-sz-tip"); S.tip.hidden = true; S.tip.setAttribute("role", "tooltip");
    S.stage.appendChild(S.strip); S.stage.appendChild(S.tip);
    root.appendChild(S.stage);
    root.appendChild(el("p", "mo-sz-hint", "Scroll sideways or drag to move along the row. Hover over an object for its details; click it to open its page. Values marked ≈ are estimates. " +
      "A lit eye means the object is brighter than magnitude " + EYE_LIMIT.toFixed(1) + ", the naked-eye limit under a dark sky; a lit binocular icon means it is brighter than magnitude " + BINO_LIMIT.toFixed(1) + ", the limit of typical 10×50 binoculars."));
    if (P.missing.length) {
      root.appendChild(el("p", "mo-sz-note", "Not drawn, because no radius, temperature or distance is recorded: " + P.missing.map((o) => o.name).join(", ") + ". Constellations and clusters are not drawn."));
    }
    container.replaceChildren(root);
    applySort();
    bind();
    let lastH = window.innerHeight, rt = null;
    const onResize = () => { clearTimeout(rt); rt = setTimeout(() => { if (S && Math.abs(window.innerHeight - lastH) > 40) { lastH = window.innerHeight; draw(); } }, 150); };
    window.addEventListener("resize", onResize);
    S.listeners.push(() => { window.removeEventListener("resize", onResize); clearTimeout(rt); });
  }

  function applySort() {
    const so = SORTS[sortKey];
    S.list = S.all.slice().sort(so.cmp);
    S.sub.textContent = S.list.length + " objects in a row " + so.order + "." + S.subRest;
    S.pick.replaceChildren();
    S.list.forEach((o, k) => {
      const v = sortKey === "distance" ? distanceText(o) : sortKey === "temperature" ? (o.teff ? Math.round(o.teff).toLocaleString("en-US") + " K" : subLabel(o)) : radiusText(o);
      const op = el("option", null, o.name + " — " + v); op.value = String(k); S.pick.appendChild(op);
    });
    draw();
    S.strip.scrollLeft = 0;
  }

  function destroy() {
    if (!S) return;
    S.listeners.forEach((f) => f());
    S.observers.forEach((o) => o.disconnect());
    if (S.root.parentNode) S.root.parentNode.removeChild(S.root);
    S = null;
  }

  window.MO_SIZES = { render, destroy, prep, blackbody };
})();
