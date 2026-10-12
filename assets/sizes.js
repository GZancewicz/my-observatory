// Size comparison page (#sizes): every star and planet with a known or derivable radius,
// in a row from smallest to largest, diameters on a logarithmic scale with a ruler beside each. Stars take their blackbody colour from
// the effective temperature; planets are plain grey spheres.
// window.MO_SIZES = { render(container, {data, navigate}), destroy(), prep(data), blackbody(t) }
(function () {
  "use strict";

  const R_SUN_KM = 695700;
  const T_SUN = 5772;
  const MBOL_SUN = 4.74;
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

  let S = null;

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
      if (cat !== "stars" && cat !== "planets") return;
      const s = raw.summary || {}, sb = raw.simbad || {};
      const o = { path: raw.path, name: raw.name, category: cat, type: s.object_type || raw.app_type || "", spType: s.spectral_type || null };
      o.ly = num(s.distance_ly);
      if (cat === "planets") {   // distance at the latest Horizons ephemeris row, AU -> ly
        const eph = ((raw.horizons || {}).ephemeris || []).filter((e) => num(e.delta) !== null);
        if (eph.length) o.ly = num(eph[eph.length - 1].delta) * 1.58125e-5;
      }
      o.r = radiusSun(s.radius);
      o.how = o.r !== null ? "catalogue" : null;
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
  // tall, every object on the same baseline, so the rulers beside them all share one scale.
  const LOG_MIN = -3;   // 0.001 R☉ (about 700 km) is height zero
  const RULER_W = 40;   // ruler line plus its tick labels, left of each sphere
  function esc(t) { return String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]); }
  function decadeLabel(e) { return e < 0 ? (+Math.pow(10, e).toFixed(-e)).toString() : Math.pow(10, e).toLocaleString("en-US"); }
  function distanceText(o) {
    if (o.ly === null) return "distance unknown";
    if (o.ly < 0.01) return sig(o.ly * 525960) + " light-minutes";   // planets
    return sig(o.ly) + " ly";
  }
  function radiusText(o) { return (o.how === "catalogue" ? "" : "≈ ") + sig(o.r) + " R☉"; }

  function layout(list, plotH) {
    const logMax = Math.ceil(Math.log10(list[list.length - 1].r) - 1e-9);
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
    return { items, unit, logMax, width: x + 16 };
  }

  // ---------------------------------------------------------------- drawing
  function rulerSvg(it, y0, unit) {
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
    if (o.category === "planets") return `<circle class="mo-sz-ball" data-k="${k}" cx="${it.cx}" cy="${cy}" r="${r}" fill="url(#mo-sz-planet)"/>`;
    return `<circle class="mo-sz-glow" cx="${it.cx}" cy="${cy}" r="${r * 1.12 + 2}" fill="url(#mo-sz-g${k})"/>` +
      `<circle class="mo-sz-ball" data-k="${k}" cx="${it.cx}" cy="${cy}" r="${r}" fill="url(#mo-sz-s${k})"/>`;
  }
  function defsSvg(list) {
    const out = ['<radialGradient id="mo-sz-planet" cx="50%" cy="50%" fx="35%" fy="32%" r="50%">' +
      '<stop offset="0" stop-color="#ececec"/><stop offset=".45" stop-color="#a4a4a4"/><stop offset="1" stop-color="#2c2c2c"/></radialGradient>'];
    list.forEach((o, k) => {
      if (o.category !== "stars") return;
      const c = o.rgb;   // limb darkening: brighter centre, darker edge
      out.push(`<radialGradient id="mo-sz-s${k}"><stop offset="0" stop-color="${css(c, 1.45)}"/><stop offset=".55" stop-color="${css(c, 1.08)}"/>` +
        `<stop offset=".88" stop-color="${css(c, 0.85)}"/><stop offset="1" stop-color="${css(c, 0.6)}"/></radialGradient>`);
      out.push(`<radialGradient id="mo-sz-g${k}"><stop offset=".8" stop-color="${css(c, 1, 0.35)}"/><stop offset="1" stop-color="${css(c, 1, 0)}"/></radialGradient>`);
    });
    return "<defs>" + out.join("") + "</defs>";
  }

  function draw() {
    if (!S) return;
    const plotH = Math.round(Math.max(260, Math.min(460, window.innerHeight * 0.5)));
    const top = 30, y0 = top + plotH, h = y0 + 64;
    const L = layout(S.list, plotH);
    S.layout = L;
    const parts = [`<svg class="mo-sz-svg" width="${L.width}" height="${h}" viewBox="0 0 ${L.width} ${h}" role="img" aria-label="Stars and planets, smallest to largest, with diameters on a logarithmic scale">`];
    parts.push(defsSvg(S.list));
    parts.push(`<line class="mo-sz-base" x1="0" y1="${y0 + 0.5}" x2="${L.width}" y2="${y0 + 0.5}"/>`);
    L.items.forEach((it, k) => {
      parts.push(`<g class="mo-sz-item" data-k="${k}">`);
      parts.push(rulerSvg(it, y0, L.unit));
      parts.push(sphereSvg(it, y0, k));
      parts.push(`<text class="mo-sz-value" x="${it.cx}" y="${y0 - it.d - 8}">${esc(radiusText(it.o))}</text>`);
      parts.push(`<text class="mo-sz-label" x="${it.mid}" y="${y0 + 20}">${esc(it.o.name)}</text>`);
      parts.push(`<text class="mo-sz-sublabel" x="${it.mid}" y="${y0 + 36}">${it.o.category === "planets" ? "planet" : esc(it.o.spType || Math.round(it.o.teff).toLocaleString("en-US") + " K")}</text>`);
      parts.push(`<text class="mo-sz-distance" x="${it.mid}" y="${y0 + 52}">${esc(distanceText(it.o))}</text>`);
      parts.push("</g>");
    });
    parts.push("</svg>");
    S.strip.innerHTML = parts.join("");
  }

  // ---------------------------------------------------------------- interaction
  function tipHtml(o) {
    const km = o.r * R_SUN_KM;
    const how = { catalogue: "catalogue radius (Wikidata)", luminosity: "estimated from luminosity and temperature",
      magnitude: "estimated from absolute magnitude and temperature" }[o.how];
    const rows = [
      `<strong>${esc(o.name)}</strong>`,
      esc(o.type + (o.spType ? " · " + o.spType : "")),
      `Radius ${esc(sig(o.r))} R☉ · ${esc(sig(km))} km` + (o.category === "planets" ? ` · ${esc(sig(km / 6371))} Earth radii` : ""),
      esc(how),
    ];
    rows.push("Distance from Earth " + esc(distanceText(o)) + (o.category === "planets" ? " (latest ephemeris)" : ""));
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
  }

  // ---------------------------------------------------------------- entry points
  function render(container, opts) {
    destroy();
    opts = opts || {};
    const P = prep(opts.data || window.MO_DATA);
    const root = el("div", "mo-sizes");
    if (!P.shown.length) { root.appendChild(el("p", "mo-empty", "No stars or planets with a known size.")); container.replaceChildren(root); return; }
    S = { root, list: P.shown, listeners: [], observers: [], drag: null,
      navigate: opts.navigate || ((p) => { location.hash = p; }) };

    const head = el("header", "mo-sz-head");
    head.appendChild(el("h1", "mo-sz-title", "Sizes"));
    head.appendChild(el("p", "mo-sz-sub",
      P.shown.length + " stars and planets in a row from smallest to largest. Each diameter is drawn on a logarithmic scale " +
      "from 0.001 to " + decadeLabel(Math.ceil(Math.log10(P.shown[P.shown.length - 1].r) - 1e-9)) + " solar radii (R☉), and the ruler beside each object reads its radius on that scale. " +
      "Star colours are the blackbody colour of each star's effective temperature; planets are grey."));
    root.appendChild(head);

    const controls = el("div", "mo-sz-controls");
    S.pick = el("select", "mo-sz-pick"); S.pick.setAttribute("aria-label", "Jump to object");
    P.shown.forEach((o, k) => { const op = el("option", null, o.name + " — " + radiusText(o)); op.value = String(k); S.pick.appendChild(op); });
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
    root.appendChild(el("p", "mo-sz-hint", "Scroll sideways or drag to move along the row. Hover over an object for its details; click it to open its page. Values marked ≈ are estimates."));
    if (P.missing.length) {
      root.appendChild(el("p", "mo-sz-note", "Not drawn, because no radius, temperature or distance is recorded: " + P.missing.map((o) => o.name).join(", ") + ". Constellations, clusters and satellites are not drawn."));
    }
    container.replaceChildren(root);
    draw();
    bind();
    let lastH = window.innerHeight, rt = null;
    const onResize = () => { clearTimeout(rt); rt = setTimeout(() => { if (S && Math.abs(window.innerHeight - lastH) > 40) { lastH = window.innerHeight; draw(); } }, 150); };
    window.addEventListener("resize", onResize);
    S.listeners.push(() => { window.removeEventListener("resize", onResize); clearTimeout(rt); });
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
