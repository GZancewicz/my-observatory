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
    seq: 0, overview: false, sizes: false, extraLoads: {}, aladin: null, skyWatch: null,
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
  // Wikidata units that arrive unresolved as item ids ("Q254532") are mapped or hidden.
  const UNIT_IDS = { Q254532: "deg²", Q11573: "m", Q828224: "km", Q1811: "AU", Q12129: "pc", Q531: "ly", Q11570: "kg", Q11579: "K" };
  const unitLabel = (u) => /^Q\d+$/.test(String(u || "")) ? UNIT_IDS[u] || "" : u || "";
  const qty = (q) => {
    if (q == null) return "—";
    if (typeof q !== "object") return esc(q);
    let s = `${num(q.value, 3)}<span class="u">${esc(unitLabel(q.unit))}</span>`;
    if (q.plus != null && (q.plus || q.minus)) {
      s += num(q.plus, 3) === num(q.minus, 3) ? `<span class="u">± ${num(q.plus, 3)}</span>`
        : `<span class="u">+${num(q.plus, 3)} / −${num(q.minus, 3)}</span>`;
    }
    return s;
  };
  const stars = (r) => r == null ? '<span class="muted">—</span>' :
    `<span class="stars" title="${r} of 5">${"★".repeat(Math.floor(r))}${r % 1 ? "½" : ""}<span class="off">${"★".repeat(5 - Math.ceil(r))}</span></span>`;
  const scorePill = (v, kind) => {
    if (!v) return '<span class="muted">—</span>';
    const n = parseInt(v, 10);
    const cls = v.includes("/") ? (n >= 4 ? "good" : n >= 3 ? "warn" : "bad") : (n <= 4 ? "good" : n <= 6 ? "warn" : "bad");
    return `<span class="pill ${cls}"${kind ? ` data-vk="${kind}"` : ""}>${esc(v)}</span>`;
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

  // ---------- glossary tooltips ----------
  // window.MO_GLOSSARY (assets/glossary.js) supplies {terms, lookup(text), explainValue(kind, value)}.
  // Everything below degrades to plain text when it is missing. Elements carry data-term="<id>"
  // and/or data-value-kind + data-value; one floating tooltip serves the whole page (and #overview).
  // annotate(root) finds label-like elements and attaches those attributes; markup can steer it
  // with data-gl="candidate|candidate" (lookup texts) and data-vk / data-vv (value kind / raw value).
  const TIP_SEL = "[data-term], [data-value-kind]";
  const gloss = () => { const g = window.MO_GLOSSARY; return g && typeof g === "object" ? g : null; };
  const glTerm = (id) => { const g = gloss(); return (id && g && g.terms && g.terms[id]) || null; };
  const glLookup = (text) => {
    const g = gloss();
    if (!g || typeof g.lookup !== "function" || !text || !String(text).trim()) return null;
    try { const id = g.lookup(String(text).trim()); return id && glTerm(id) ? id : null; } catch { return null; }
  };
  const glExplain = (kind, value) => {
    const g = gloss();
    if (!g || typeof g.explainValue !== "function" || blank(value) || String(value).trim() === "—") return null;
    try { const s = g.explainValue(kind, String(value).trim()); return s ? String(s) : null; } catch { return null; }
  };
  const tip = { el: null, target: null, timer: 0, pointer: "mouse", downAt: 0 };
  const KIND_TITLES = { spectral_type: "Spectral type", otype: "Object type", luminosity_class: "Luminosity class",
    bortle: "Bortle scale", seeing: "Seeing", transparency: "Transparency", mag: "Magnitude", band: "Photometric band" };

  function tipBox() {
    if (!tip.el) {
      tip.el = document.createElement("div");
      tip.el.className = "gtip"; tip.el.id = "gtip"; tip.el.setAttribute("role", "tooltip"); tip.el.hidden = true;
      document.body.appendChild(tip.el);
    }
    return tip.el;
  }
  function tipHtml(t) {
    const id = t.getAttribute("data-term"), term = glTerm(id);
    const kind = t.getAttribute("data-value-kind"), value = t.getAttribute("data-value") || "";
    const expl = kind ? glExplain(kind, value) : null;
    if (!term && !expl) return "";
    const head = term ? term.term || id : KIND_TITLES[kind] || value;
    let h = `<div class="gtip-t">${esc(head)}</div>`;
    // explainValue usually opens with the value itself; prefix it only when it does not.
    const lead = expl && !expl.slice(0, value.length + 20).toLowerCase().includes(value.toLowerCase().replace(/^-/, ""));
    if (expl) h += `<div class="gtip-v">${lead ? `<span class="gtip-vv">${esc(value)}</span> ` : ""}${esc(expl)}</div>`;
    if (term && term.short) h += `<div class="gtip-s">${esc(term.short)}</div>`;
    if (term && term.long) h += `<div class="gtip-l">${esc(term.long)}</div>`;
    return h;
  }
  function showTip(t) {
    clearTimeout(tip.timer);
    if (tip.target === t && tip.el && !tip.el.hidden) return placeTip();
    const html = tipHtml(t);
    if (!html) return;
    const box = tipBox();
    if (tip.target && tip.target !== t) tip.target.removeAttribute("aria-describedby");
    box.innerHTML = html;
    tip.target = t;
    t.setAttribute("aria-describedby", "gtip");
    box.hidden = false;
    placeTip();
  }
  function placeTip() {
    const box = tip.el, t = tip.target;
    if (!box || box.hidden || !t) return;
    if (!t.isConnected) return hideTip();
    const r = t.getBoundingClientRect();
    const vw = document.documentElement.clientWidth || innerWidth, vh = innerHeight, m = 8;
    if ((!r.width && !r.height) || r.bottom < 0 || r.top > vh) return hideTip();
    box.style.maxWidth = Math.min(360, vw - 2 * m) + "px";
    box.style.left = "0px"; box.style.top = "0px";
    const w = box.offsetWidth, h = box.offsetHeight;
    const x = Math.max(m, Math.min(r.left, vw - w - m));
    let y = r.bottom + 6;
    if (y + h > vh - m) y = r.top - h - 6 >= m ? r.top - h - 6 : Math.max(m, vh - h - m);
    box.style.left = Math.round(x) + "px"; box.style.top = Math.round(y) + "px";
  }
  function hideTip() {
    clearTimeout(tip.timer);
    if (tip.target) tip.target.removeAttribute("aria-describedby");
    tip.target = null;
    if (tip.el) tip.el.hidden = true;
  }
  const hideTipSoon = () => { clearTimeout(tip.timer); tip.timer = setTimeout(hideTip, 120); };
  // Keyboard focus on a <summary> or <button> shows the term inside it.
  const tipTargetFor = (n) => !n || !n.closest ? null
    : n.closest(TIP_SEL) || (/^(SUMMARY|BUTTON)$/.test(n.tagName) ? n.querySelector(TIP_SEL) : null);

  document.addEventListener("pointerdown", (e) => { tip.pointer = e.pointerType || "mouse"; tip.downAt = Date.now(); }, true);
  document.addEventListener("pointerover", (e) => {
    if (e.pointerType === "touch") return;
    const t = e.target.closest && e.target.closest(TIP_SEL);
    if (t) showTip(t);
  });
  document.addEventListener("pointerout", (e) => {
    if (e.pointerType === "touch" || !tip.target) return;
    const t = e.target.closest && e.target.closest(TIP_SEL);
    if (t !== tip.target || (e.relatedTarget && t.contains(e.relatedTarget))) return;
    if (document.activeElement === t) return;   // keyboard focus keeps it open
    hideTipSoon();
  });
  document.addEventListener("focusin", (e) => {
    if (tip.pointer === "touch" && Date.now() - tip.downAt < 800) return;   // the tap's click toggles it
    const t = tipTargetFor(e.target);
    if (t) showTip(t);
  });
  document.addEventListener("focusout", (e) => {
    if (tip.target && tipTargetFor(e.target) === tip.target) hideTipSoon();
  });
  // Touch: a tap toggles the tooltip; a tap anywhere else closes it.
  document.addEventListener("click", (e) => {
    if (tip.pointer !== "touch" || Date.now() - tip.downAt > 1500) return;
    const t = e.target.closest && e.target.closest(TIP_SEL);
    if (t) { if (tip.target === t && tip.el && !tip.el.hidden) hideTip(); else showTip(t); return; }
    if (tip.target && !(tip.el && tip.el.contains(e.target))) hideTip();
  }, true);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && tip.target) hideTip(); });
  let tipFrame = 0;
  const tipFollow = () => { if (!tip.target || tipFrame) return; tipFrame = requestAnimationFrame(() => { tipFrame = 0; placeTip(); }); };
  window.addEventListener("scroll", tipFollow, { passive: true, capture: true });
  window.addEventListener("resize", tipFollow);

  // --- annotate
  const LABEL_SEL = [".fact .k", "th", "summary", "h2", "h3", ".mtitle", ".mo-card__title", ".mo-field__label",
    ".mo-axis-label", ".mo-ref-label", "[data-gl]"].join(",");
  const PROSE_SEL = ".note, .fact .x, .mo-card__sub, .mo-card__foot";
  const UNIT_RE = /^(M☉|R☉|L☉|M⊕|R⊕|ly|pc|kpc|Mpc|mas|mas\/yr|AU|K|Myr|Gyr|km\/s|arcmin|arcsec|deg²)$/;
  const COL_KINDS = [[/^(spectral type|sptype|sp\.? type)$/i, "spectral_type"], [/^(otype|type|object type)$/i, "otype"],
    [/^seeing$/i, "seeing"], [/^transp(\.|arency)?$/i, "transparency"], [/^bortle$/i, "bortle"], [/^band$/i, "band"],
    [/^(mag|magnitude|v|apparent magnitude)$/i, "mag"]];
  const WD_KINDS = [[/^spectral (class|type)$/i, "spectral_type"], [/^apparent magnitude$/i, "mag"], [/^instance of$/i, "otype"]];
  const PROSE_STOP = new Set(("the and for with from that this each are was not but all its into than then they them only also more most " +
    "less same show shows click drag filter point points size objects object observation observations highlight highlighted region chart " +
    "view star stars night nights local noon rating time left right top bottom centre center north east south west line lines join " +
    "data page full text place computed when where which there their these those latest none main new repeat mean").split(" "));

  const directText = (el) => {
    let s = "";
    el.childNodes.forEach((n) => { if (n.nodeType === 3) s += n.nodeValue; });
    return s.replace(/\s+/g, " ").trim();
  };
  function candidates(text) {
    text = String(text || "").replace(/\s+/g, " ").trim();
    if (!text) return [];
    const first = text.split(" · ")[0];
    return [...new Set([text, first, first.replace(/\s*\([^)]*\)/g, ""), first.split(/\s+\/\s+/)[0], first.replace(/[:=]\s*$/, "")]
      .map((s) => s.trim()).filter(Boolean))];
  }
  function makeFocusable(el) {
    if (el.matches("a[href], button, summary, input, select, textarea, [tabindex]")) return;
    if (el.closest("a[href], button, summary, select")) return;   // never nest a tab stop in a control
    el.setAttribute("tabindex", "0");
  }
  function markTerm(el, id) {
    el.setAttribute("data-term", id);
    el.classList.add("gl");
    makeFocusable(el);
  }
  // Wrap `phrase` (inside one of el's direct text nodes) in a span; returns the span or null.
  function wrapPhrase(el, phrase) {
    for (const n of [...el.childNodes]) {
      if (n.nodeType !== 3) continue;
      const i = n.nodeValue.indexOf(phrase);
      if (i < 0) continue;
      const mid = i ? n.splitText(i) : n;
      mid.splitText(phrase.length);
      const span = document.createElement("span");
      span.className = "gl-w";
      mid.replaceWith(span);
      span.appendChild(mid);
      return span;
    }
    return null;
  }
  function annotateLabel(el) {
    if (el.hasAttribute("data-term") || (el.closest && el.closest(".gtip"))) return;
    const isSvg = el instanceof SVGElement;
    const gl = el.getAttribute("data-gl");
    const text = gl ? "" : isSvg ? el.textContent.replace(/\s+/g, " ").trim() : directText(el);
    const key = gl || text;
    if (!key || el.getAttribute("data-gl-done") === key) return;
    el.setAttribute("data-gl-done", key);
    const tries = gl ? gl.split("|").map((s) => s.trim()).filter(Boolean) : candidates(text);
    let id = null, hit = "";
    for (const c of tries) { id = glLookup(c); if (id) { hit = c; break; } }
    if (!id) return;
    if (gl || isSvg) return markTerm(el, id);
    const whole = el.children.length === 0 && hit === text;
    if (whole) return markTerm(el, id);
    const span = wrapPhrase(el, hit) || wrapPhrase(el, text.split(" · ")[0]);
    markTerm(span || el, id);
  }
  function annotateValue(el, kind, value) {
    if (!el || el.hasAttribute("data-value-kind")) return;
    value = String(value ?? el.textContent).replace(/\s+/g, " ").trim();
    if (!value || value === "—") return;
    if (!glExplain(kind, value)) return;
    el.setAttribute("data-value-kind", kind);
    el.setAttribute("data-value", value);
    el.classList.add("gl");
    makeFocusable(el);
  }
  // The element inside a table cell that should carry a value explanation.
  function cellTarget(td) {
    const t = td.textContent.replace(/\s+/g, " ").trim();
    if (!t || t === "—" || td.hasAttribute("data-value-kind")) return null;
    const kids = td.children;
    if (kids.length === 1 && kids[0].textContent.trim() === td.textContent.trim()) {
      return kids[0].matches("a, button") ? null : kids[0];
    }
    if (kids.length) return null;
    const span = document.createElement("span");
    span.append(...td.childNodes);
    td.appendChild(span);
    return span;
  }
  function annotateTables(root) {
    root.querySelectorAll("table").forEach((tbl) => {
      const head = tbl.tHead && tbl.tHead.rows[0];
      if (!head) return;
      const kinds = [...head.cells].map((th) => {
        if (th.dataset.colVk) return th.dataset.colVk;
        const t = (th.querySelector(".gl-name") || th).textContent.replace(/\s+/g, " ").trim();
        const hit = COL_KINDS.find(([re]) => re.test(t));
        return hit ? hit[1] : null;
      });
      if (!kinds.some(Boolean)) return;
      [...tbl.tBodies].forEach((tb) => [...tb.rows].forEach((tr) => [...tr.cells].forEach((td, i) => {
        if (kinds[i] && td.tagName === "TD") annotateValue(cellTarget(td), kinds[i], td.dataset.vv);
      })));
    });
    root.querySelectorAll("table.wd tr").forEach((tr) => {
      const th = tr.querySelector("th");
      const hit = th && WD_KINDS.find(([re]) => re.test(th.textContent.trim()));
      if (hit) tr.querySelectorAll(".wdv").forEach((v) => { if (!v.querySelector("a")) annotateValue(v, hit[1]); });
    });
  }
  // Prose: wrap the first occurrence of each glossary term in short notes and chart captions.
  function annotateProse(el) {
    const before = el.textContent;
    if (el.getAttribute("data-gl-scan") === before) return;
    const seen = new Set([...el.querySelectorAll("[data-term]")].map((x) => x.getAttribute("data-term")));
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => n.parentElement.closest("[data-term], [data-value-kind], a, button, .mono, select, option")
        ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach((n) => wrapTerms(n, seen));
    el.setAttribute("data-gl-scan", el.textContent);
  }
  function wrapTerms(node, seen) {
    const s = node.nodeValue;
    const toks = [...s.matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’−–-]*/gu)].map((m) => ({ a: m.index, b: m.index + m[0].length, w: m[0] }));
    const hits = [];
    for (let i = 0; i < toks.length; i++) {
      for (let len = Math.min(4, toks.length - i); len >= 1; len--) {
        let ok = true;
        for (let j = i; j < i + len - 1 && ok; j++) ok = /^[  -]+$/.test(s.slice(toks[j].b, toks[j + 1].a));
        if (!ok) continue;
        const phrase = s.slice(toks[i].a, toks[i + len - 1].b);
        const low = phrase.toLowerCase();
        if (len === 1 && (low.length < 3 || PROSE_STOP.has(low) || /^\d/.test(low))) continue;
        const id = glLookup(phrase);
        if (!id || seen.has(id)) continue;
        if (len === 1) {   // single words must really name the term (no loose variant matches)
          const name = String((glTerm(id) || {}).term || "").toLowerCase().replace(/\s*\(.*\)$/, "");
          if (!(name === low || name.startsWith(low) || low.startsWith(name) || /[A-Z]{2}|[−–]/.test(phrase))) continue;
        }
        seen.add(id);
        hits.push({ a: toks[i].a, b: toks[i + len - 1].b, id });
        i += len - 1;
        break;
      }
    }
    if (!hits.length) return;
    const frag = document.createDocumentFragment();
    let at = 0;
    hits.forEach((h) => {
      if (h.a > at) frag.appendChild(document.createTextNode(s.slice(at, h.a)));
      const span = document.createElement("span");
      span.textContent = s.slice(h.a, h.b);
      frag.appendChild(span);
      markTerm(span, h.id);
      at = h.b;
    });
    if (at < s.length) frag.appendChild(document.createTextNode(s.slice(at)));
    node.replaceWith(frag);
  }
  function annotate(root) {
    root = root || document.body;
    if (!root || !root.querySelectorAll || !gloss()) return;
    try {
      root.querySelectorAll(LABEL_SEL).forEach(annotateLabel);
      root.querySelectorAll("[data-vk]").forEach((el) => annotateValue(el, el.getAttribute("data-vk"), el.getAttribute("data-vv")));
      annotateTables(root);
      root.querySelectorAll(".u, .unit").forEach((el) => {
        const t = el.textContent.trim();
        if (!el.hasAttribute("data-term") && UNIT_RE.test(t)) { const id = glLookup(t); if (id) markTerm(el, id); }
      });
      root.querySelectorAll(PROSE_SEL).forEach(annotateProse);
      if (tip.target && !tip.target.isConnected) hideTip();
    } catch (e) { console.warn("glossary annotate", e); }
  }
  const termHtml = (id, text) => {
    const t = glTerm(id), label = esc(text ?? (t && t.term) ?? id ?? "");
    return t ? `<span class="gl" data-term="${esc(id)}" tabindex="0">${label}</span>` : label;
  };
  window.MO_TIP = { annotate, term: termHtml, hide: hideTip };

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
        const right = [o.v_mag != null ? `<span data-gl="apparent magnitude|magnitude" data-vk="mag" data-vv="${esc(o.v_mag)}">mag ${num(o.v_mag, 1)}</span>` : "", `${o.observations}× seen`].filter(Boolean).join("<br>");
        const img = o.thumb ? `<img loading="lazy" src="${esc(fileUrl(o, o.thumb))}" alt="">` : '<div class="noimg"></div>';
        return `<a class="item" href="#${esc(o.path)}" aria-current="${current === o.path}">${img}<div><div class="t">${esc(o.name)}</div><div class="s">${esc(sub)}</div></div><div class="r">${right}</div></a>`;
      }).join("");
    }
    $("#list").innerHTML = html || '<div class="empty">No objects match.</div>';
    annotate($("#list"));
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
  // Glossary lookup hints for raw SIMBAD column keys (the header text is tried too).
  const COL_GL = {
    pmra: "proper motion in right ascension|proper motion", pmde: "proper motion in declination|proper motion",
    pmdec: "proper motion in declination|proper motion", pmra_err: "proper motion|uncertainty", pmde_err: "proper motion|uncertainty",
    plx: "parallax", plx_err: "parallax|uncertainty", teff: "effective temperature|Teff", log_g: "surface gravity|log g",
    fe_h: "metallicity|[Fe/H]", vsini: "v sin i|projected rotational velocity", vsini_err: "v sin i|uncertainty",
    upvsini: "v sin i", sptype: "spectral type", otype: "object type|otype", bibcode: "bibcode", mag: "magnitude|apparent magnitude",
    err: "uncertainty|error", band: "photometric band|band|passband", membership: "membership probability|membership",
    velvalue: "radial velocity", veltype: "radial velocity", meanerror: "uncertainty", coosystem: "coordinate system|reference frame",
    qual: "quality code|quality", quality: "quality code|quality", nbmes: "number of measurements", wdomain: "wavelength domain|wavelength",
    exptime: "exposure time", obsdate: "observation date", relation: "hierarchy", type: "object type",
  };
  const colTh = (k) => `<th${COL_GL[k] ? ` data-gl="${esc(COL_GL[k])}|${esc(colName(k))}"` : ""}>${esc(colName(k))}</th>`;
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
    return `<div class="clip"><div class="tablewrap"><table><thead><tr>${used.map(colTh).join("")}</tr></thead><tbody>${body}</tbody></table></div>${moreButton(rows.length, limit, unit)}</div>`;
  }
  const moreButton = (n, limit, unit) => n > limit
    ? `<button type="button" class="more-btn" data-action="more" data-label="Show all ${n} ${unit}" aria-expanded="false">Show all ${n} ${unit}</button>` : "";
  // Two-column label/value table from [label, html] pairs; null values are skipped.
  // pairs: [label, html, glossaryHint?]; with rawLabels the label is already HTML.
  function kvTable(pairs, cls = "", rawLabels = false) {
    const rows = pairs.filter(([, v]) => v != null && v !== "").map(([k, v, gl]) =>
      `<tr><th scope="row"${gl ? ` data-gl="${esc(gl)}"` : ""}>${rawLabels ? k : esc(k)}</th><td>${v}</td></tr>`).join("");
    return rows ? `<div class="tablewrap"><table class="kv ${cls}">${rows}</table></div>` : "";
  }
  const section = (id, title, body, extra = "") => body
    ? `<section class="sec" id="sec-${id}"><h2>${title}</h2>${extra}${body}</section>` : "";

  // ---------- detail: hero and key facts ----------
  // opts: {gl: "lookup|hints" for the label, vk/vv: value kind and raw value for a value explanation}
  function factCard(k, v, extra = "", opts = {}) {
    if (v == null || v === "—" || v === "") return "";
    const gl = opts.gl ? ` data-gl="${esc(opts.gl)}"` : "";
    const vk = opts.vk && !blank(opts.vv) ? ` data-vk="${esc(opts.vk)}" data-vv="${esc(opts.vv)}"` : "";
    return `<div class="fact"><div class="k"${gl}>${esc(k)}</div><div class="v"><span${vk}>${v}</span></div>${extra ? `<div class="x">${extra}</div>` : ""}</div>`;
  }

  const paperCount = (o) => o.papers_count ?? (o.simbad || {}).papers_count ?? (o.simbad || {}).nbref ?? null;

  function keyFacts(o) {
    const s = o.summary || {}, sb = o.simbad || {};
    const color = teffColor(s.teff_k);
    const np = paperCount(o);
    const cards = [
      factCard("Apparent magnitude", s.v_mag != null ? num(s.v_mag, 2) : null,
        s.b_minus_v != null ? `B−V ${num(s.b_minus_v, 2)}` : "", { vk: "mag", vv: s.v_mag }),
      factCard("Absolute magnitude", s.abs_mag != null ? num(s.abs_mag, 2) : null),
      factCard("Distance", s.distance_ly != null ? `${num(s.distance_ly, 1)}<span class="u">ly</span>` : null,
        s.distance_pc != null ? `${num(s.distance_pc, 1)} pc · parallax ${num(sb.plx_value, 2)} mas` : ""),
      factCard("Spectral type", s.spectral_type ? esc(s.spectral_type) : null, "", { vk: "spectral_type", vv: s.spectral_type }),
      factCard("Temperature", s.teff_k ? `${color ? `<span class="swatch" style="background:${color};color:${color}"></span>` : ""}${num(s.teff_k, 0)}<span class="u">K</span>` : null, "", { gl: "effective temperature|temperature" }),
      factCard("Mass", s.mass ? qty(s.mass) : null),
      factCard("Radius", s.radius ? qty(s.radius) : null),
      factCard("Luminosity", s.luminosity ? qty(s.luminosity) : null),
      factCard("Age", s.age ? qty(s.age) : null),
      factCard("Constellation", s.constellation ? esc(s.constellation) : null),
      factCard("Right ascension", s.ra_deg != null ? ra(s.ra_deg) : null, s.ra_deg != null ? `${num(s.ra_deg, 4)}°` : ""),
      factCard("Declination", s.dec_deg != null ? dec(s.dec_deg) : null, s.dec_deg != null ? `${num(s.dec_deg, 4)}°` : ""),
      factCard("Object type", s.object_type ? esc(s.object_type) : null, "", { vk: "otype", vv: s.object_type }),
      factCard("Area", s.area ? qty(s.area) : null),
      factCard("Abbreviation", s.abbreviation ? esc(s.abbreviation) : null),
      factCard("Orbital period", s.orbital_period ? qty(s.orbital_period) : null),
      factCard("Rotation period", s.rotation_period ? qty(s.rotation_period) : null),
      factCard("NORAD ID", s.norad_id ?? null, "", { gl: "NORAD ID|NORAD catalog number|NORAD" }),
      factCard("Launched", s.launch_date ? esc(s.launch_date) : null, s.owner ? `Owner: ${esc(s.owner)}` : ""),
      factCard("Orbit", s.apogee_km != null ? `${num(s.perigee_km, 0)}–${num(s.apogee_km, 0)}<span class="u">km</span>` : null,
        s.inclination_deg != null ? `${num(s.inclination_deg, 2)}° inclination · ${num(s.period_min, 1)} min period` : "", { gl: "orbit|perigee|apogee" }),
      factCard("Rotation (v sin i)", (sb.vsini_measurements || []).length ? `${num(median(sb.vsini_measurements.map((x) => x.vsini)), 0)}<span class="u">km/s</span>` : null,
        (sb.vsini_measurements || []).length ? `median of ${sb.vsini_measurements.length} measurements` : "", { gl: "v sin i|Rotation (v sin i)|projected rotational velocity" }),
      factCard("Radial velocity", sb.rvz_radvel != null ? `${num(sb.rvz_radvel, 1)}<span class="u">km/s</span>` : null),
      np ? `<button type="button" class="fact fact-link" data-action="papers" aria-haspopup="dialog"><div class="k">Research papers</div><div class="v">${num(np, 0)}</div><div class="x">references in SIMBAD · <span class="go">browse →</span></div></button>` : "",
    ].join("");
    return cards ? `<section class="sec" id="sec-facts"><h2>Key facts</h2><div class="facts">${cards}</div></section>` : "";
  }

  const median = (xs) => { xs = xs.filter((x) => x != null).sort((a, b) => a - b); return xs.length ? xs[Math.floor(xs.length / 2)] : null; };

  // Satellite passes over the site from 12 h before to 12 h after each sighting (computed with SGP4 at harvest).
  function passesTable(obs) {
    const withTrack = obs.filter((x) => x.track && (x.track.passes || []).length);
    if (!withTrack.length) return "";
    const local = (u) => new Date(u.replace(" ", "T") + ":00Z").toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    return withTrack.map((x) => {
      const rows = x.track.passes.map((q) => `<tr${q.sighting ? ' class="is-seen"' : ""}><td>${esc(local(q.start_utc))}${q.sighting ? ' <span class="pill good">the pass you saw</span>' : ""}</td><td>${esc(local(q.max_utc).split(", ").pop())} · <span data-gl="altitude">${num(q.max_alt, 0)}°</span></td><td>${esc(local(q.end_utc).split(", ").pop())}</td><td><span data-gl="azimuth">${compass(q.start_az)} → ${compass(q.end_az)}</span></td><td>${q.visible ? '<span class="pill good">visible</span>' : '<span class="muted">not visible</span>'}</td></tr>`).join("");
      return `<h3>Passes over ${esc(x.location || x.location_assumed || "your site")}, 12 hours either side of ${esc(x.datetime)}</h3><div class="tablewrap"><table><thead><tr><th>Rises</th><th data-gl="altitude">Highest</th><th>Sets</th><th data-gl="azimuth">Direction</th><th>Could you see it?</th></tr></thead><tbody>${rows}</tbody></table></div><div class="note">Computed from orbital elements dated ${esc(String(x.track.elements_epoch || "").slice(0, 16).replace("T", " "))} UTC. "Visible" means the satellite was in sunlight while your sky was dark (Sun more than 6° below the horizon). The pass you saw is the nearest one to your logged time, which is often a few minutes after the pass itself.</div>`;
    }).join("");
  }

  function observationsTable(o) {
    const obs = o.observations || [];
    if (!obs.length) return "";
    const hasEph = obs.some((x) => x.ephemeris);
    const hasHow = obs.some((x) => x.equipment || x.notes);   // hand-entered rows record naked eye / binoculars
    const rows = obs.map((x) => {
      const alt = x.altitude_deg != null && !Number.isNaN(x.altitude_deg)
        ? `<span data-gl="altitude">${num(x.altitude_deg, 1)}°</span> <span class="muted" data-gl="azimuth">${compass(x.azimuth_deg)} ${num(x.azimuth_deg, 0)}°</span>` : '<span class="muted">—</span>';
      const loc = x.location ? esc(x.location) : x.location_assumed ? `<span class="muted" title="Location not visible in screenshot; assumed">${esc(x.location_assumed)}*</span>` : "—";
      const e = x.ephemeris;
      const eph = hasEph ? `<td>${e ? `<span data-gl="apparent magnitude|magnitude" data-vk="mag" data-vv="${esc(e.mag)}">mag ${esc(e.mag)}</span> · <span data-gl="angular diameter|apparent size">${num(e.angular_diameter_arcsec, 1)}″</span> · <span data-gl="illuminated fraction|illumination|phase">${num(e.illuminated_pct, 0)}% lit</span> · <span data-gl="delta|astronomical unit|AU">${num(e.distance_au, 3)} AU</span>` : "—"}</td>` : "";
      return `<tr><td>${esc(x.datetime)}${x.incomplete ? ' <span class="pill warn" title="Card was cut off in the screenshot">partial</span>' : ""}</td><td>${stars(x.rating)}</td><td>${scorePill(x.seeing, "seeing")}</td><td>${scorePill(x.transparency, "transparency")}</td><td>${scorePill(x.bortle, "bortle")}</td><td>${alt}</td>${eph}${hasHow ? `<td>${esc(x.equipment || "—")}${x.notes ? `<div class="muted">${esc(x.notes)}</div>` : ""}</td>` : ""}<td>${loc}</td></tr>`;
    }).join("");
    return `<section class="sec" id="sec-obs"><h2>My observations · ${obs.length}</h2><div class="tablewrap"><table><thead><tr><th data-gl="local time">Local time</th><th data-gl="rating">Rating</th><th data-gl="seeing">Seeing</th><th data-gl="transparency|Transp.">Transp.</th><th data-gl="Bortle scale|Bortle">Bortle</th><th data-gl="altitude|Altitude / direction">Altitude / direction</th>${hasEph ? '<th data-gl="ephemeris">At that moment</th>' : ""}${hasHow ? "<th>How seen</th>" : ""}<th data-gl="observing location|location">Location</th></tr></thead><tbody>${rows}</tbody></table></div><div class="note">Altitude and direction are computed for the observation time and place.${obs.some((x) => x.location_assumed) ? " * location not visible in the screenshot; assumed." : ""}</div>${passesTable(obs)}</section>`;
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
    // Bright stars saturate the survey plates; a wider field keeps the surroundings visible.
    const v = s.v_mag;
    let fov = v == null ? 0.5 : v < 0.5 ? 3 : v < 2 ? 1.5 : v < 4 ? 0.8 : 0.5;
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

  // Aladin Lite v3 has no destroy(), and every instance holds WebGL contexts, so one instance is
  // created on first use and its element is moved into each object page and re-centred.
  function destroyAladin() {
    if (state.skyWatch) state.skyWatch();
    if (state.aladin && state.aladin.el.isConnected) state.aladin.el.remove();   // park it off-page
  }

  function mountAladin(o, seq) {
    const host = $("#skyview"), t = skyTarget(o);
    if (!host || !t) return;
    const fail = (msg) => { if (host.isConnected) host.innerHTML = `<div class="sky-msg">${esc(msg)}</div>`; };
    const place = (A) => {
      const reticle = o.category !== "constellations";
      if (state.aladin) {
        const { inst, el } = state.aladin;
        host.innerHTML = "";
        host.appendChild(el);
        inst.removeOverlays();
        inst.gotoRaDec(t.ra, t.dec);
        inst.setFoV(t.fov);
        if (typeof inst.showReticle === "function") inst.showReticle(reticle);
        drawBoundary(A, inst, o);
        return;
      }
      host.innerHTML = "";
      const el = document.createElement("div");
      el.className = "aladin-el";
      host.appendChild(el);
      const inst = A.aladin(el, {
        survey: "P/DSS2/color", fov: t.fov, target: `${t.ra} ${t.dec}`, cooFrame: "ICRS",
        showReticle: reticle, showLayersControl: false, showGotoControl: false,
        showFullscreenControl: true, showFrame: false, showCooGridControl: false,
        showProjectionControl: false, showZoomControl: true,
      });
      state.aladin = { inst, el };
      drawBoundary(A, inst, o);
    };
    const start = () => {
      const A = window.A;
      if (!A || !A.init || typeof A.aladin !== "function") return fail("The sky viewer needs an internet connection (Aladin Lite did not load).");
      const ready = typeof A.init === "function" ? A.init() : A.init;
      Promise.resolve(ready).then(() => {
        if (seq !== state.seq || !host.isConnected) return;
        place(A);
      }).catch(() => fail("The sky viewer could not start."));
    };
    // Lazy: start once the panel is within 300px of the viewport.
    const near = () => { const r = host.getBoundingClientRect(); return r.top < innerHeight + 300 && r.bottom > -300; };
    if (near()) return start();
    const watch = () => { if (host.isConnected && near()) { stop(); start(); } };
    const stop = () => { window.removeEventListener("scroll", watch); window.removeEventListener("resize", watch); state.skyWatch = null; };
    window.addEventListener("scroll", watch, { passive: true });
    window.addEventListener("resize", watch);
    state.skyWatch = stop;
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
      `<li><button type="button" class="linklike" data-action="jump" data-target="${g.id}">${esc(g.title)}</button></li>`).join("")}</ol></nav>` : "";
    const imgs = asList(art.images).filter((im) => im && safeUrl(im.thumbnail)).slice(0, 12);
    const strip = imgs.length ? `<div class="strip">${imgs.map((im) => {
      const cap = im.caption || String(im.title || "").replace(/^File:/i, "").replace(/\.[a-z0-9]+$/i, "").replace(/_/g, " ");
      return `<figure><img loading="lazy" src="${esc(safeUrl(im.thumbnail))}" alt="${esc(cap)}"><figcaption>${esc(cap)}</figcaption></figure>`;
    }).join("")}</div>` : "";
    host.innerHTML = `${strip}<div class="article-grid">${toc}<div class="article-main">
      <details class="wp-sec" open><summary>Introduction</summary><div class="prose">${paras(leadText)}</div></details>
      ${shown.map((g) => `<details class="wp-sec" id="${g.id}"><summary>${esc(g.title)}</summary><div class="prose">${body(g)}</div></details>`).join("")}
      </div></div><div class="note">Full text of the ${link} article, as plain text.</div>`;
    annotate(host);
  }

  // ---------- detail: SIMBAD ----------
  const MEASUREMENT_NAMES = {
    mesPM: "Proper motion", mesPLX: "Parallax", mesRV: "Radial velocity", mesVelocities: "Velocities",
    mesSpT: "Spectral type", mesDiameter: "Diameter", mesRot: "Rotation (v sin i)",
    mesFe_h: "Temperature, gravity and metallicity", mesDistance: "Distance", mesVar: "Variability",
    mesIUE: "IUE ultraviolet spectra", mesXmm: "XMM-Newton X-ray observations", mesHerschel: "Herschel observations",
    mesISO: "ISO observations", mesOtype: "Object type history", mesPos: "Position", mesUncertainty: "Position uncertainty",
  };
  const MEASUREMENT_GL = {
    mesPM: "proper motion", mesPLX: "parallax", mesRV: "radial velocity", mesVelocities: "radial velocity",
    mesSpT: "spectral type", mesDiameter: "angular diameter|diameter", mesRot: "v sin i|projected rotational velocity",
    mesFe_h: "metallicity|effective temperature|surface gravity", mesDistance: "distance", mesVar: "variable star|variability",
    mesIUE: "IUE|International Ultraviolet Explorer|ultraviolet", mesXmm: "XMM-Newton|X-ray", mesHerschel: "Herschel|infrared",
    mesISO: "ISO|Infrared Space Observatory|infrared", mesOtype: "object type", mesPos: "coordinates|position",
    mesUncertainty: "positional uncertainty|uncertainty",
  };
  // SIMBAD coordinate fields beyond RA/Dec/l/b: friendly label and glossary hint.
  const COORD_FIELDS = {
    frame: ["Reference frame", "reference frame|ICRS"], epoch: ["Epoch", "epoch|J2000"],
    err_maj_mas: ["Position error, long axis (mas)", "positional uncertainty|error ellipse|uncertainty"],
    err_min_mas: ["Position error, short axis (mas)", "positional uncertainty|error ellipse|uncertainty"],
    err_angle_deg: ["Position error, angle (°)", "position angle|error ellipse"],
    quality: ["Position quality", "quality code|quality"], wavelength: ["Position measured in", "wavelength|wavelength domain"],
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
    const ref = (v, e, u) => v == null ? null : `${rawNum(+v)}${e != null ? ` <span class="muted">± ${rawNum(+e)}</span>` : ""}${u ? ` <span class="muted unit">${u}</span>` : ""}`;
    const np = paperCount(o);
    const consumed = new Set(["ra", "ra_deg", "ra_icrs", "dec", "dec_deg", "dec_icrs", "ra_hms", "dec_dms", "gal_l", "l", "glon", "galactic_l", "lon_gal", "gal_b", "b", "glat", "galactic_b", "lat_gal", "galactic"]);
    const otherCoords = Object.entries(co).filter(([k, v]) => !consumed.has(k) && !blank(v))
      .map(([k, v]) => /bibcode/i.test(k) ? ["Coordinate source", cell(k, v), "bibcode"]
        : COORD_FIELDS[k] ? [COORD_FIELDS[k][0], cell(k, v), COORD_FIELDS[k][1]] : [colName(k), cell(k, v)]);
    const basic = kvTable([
      ["Identifier", sb.main_id ? `<span class="mono">${esc(String(sb.main_id).replace(/\s+/g, " "))}</span>` : null, "SIMBAD identifier|main identifier|designation|identifier"],
      ["Object type", sb.otype || sb.otype_desc ? `<span data-vk="otype" data-vv="${esc(sb.otype || sb.otype_desc)}">${esc(sb.otype_desc || "")}${sb.otype ? ` <span class="muted mono">${esc(sb.otype)}</span>` : ""}</span>` : null, "object type|otype"],
      ["RA (ICRS, J2000)", raDeg != null ? `${ra(+raDeg)} <span class="muted">${rawNum(+raDeg)}°</span>` : null, "right ascension|RA (ICRS, J2000)|RA"],
      ["Dec (ICRS, J2000)", decDeg != null ? `${dec(+decDeg)} <span class="muted">${rawNum(+decDeg)}°</span>` : null, "declination|Dec (ICRS, J2000)|Dec"],
      ["Galactic longitude l", gl != null ? `${(+gl).toFixed(4)}°${galNote}` : null, "galactic longitude|galactic coordinates"],
      ["Galactic latitude b", gb != null ? `${(+gb).toFixed(4)}°${galNote}` : null, "galactic latitude|galactic coordinates"],
      ...otherCoords,
      ["Proper motion", sb.pmra != null || sb.pmdec != null ? `RA ${sb.pmra != null ? rawNum(+sb.pmra) : "—"} · Dec ${sb.pmdec != null ? rawNum(+sb.pmdec) : "—"} <span class="muted unit">mas/yr</span>` : null, "proper motion"],
      ["Parallax", ref(sb.plx_value, sb.plx_err, "mas"), "parallax"],
      ["Radial velocity", ref(sb.rvz_radvel, sb.rvz_err, "km/s"), "radial velocity"],
      ["Redshift z", sb.rvz_redshift != null ? rawNum(+sb.rvz_redshift) : null, "redshift|Redshift z"],
      ["Spectral type", sb.sp_type ? `<span data-vk="spectral_type" data-vv="${esc(sb.sp_type)}">${esc(sb.sp_type)}</span>` : null, "spectral type"],
      ["Morphology", sb.morph_type ? esc(sb.morph_type) : null, "galaxy morphology|morphological type|morphology"],
      ["Dimensions", sb.galdim_majaxis != null ? `${rawNum(+sb.galdim_majaxis)}′ × ${sb.galdim_minaxis != null ? rawNum(+sb.galdim_minaxis) : "—"}′${sb.galdim_angle != null ? ` <span class="muted">PA ${rawNum(+sb.galdim_angle)}°</span>` : ""}` : null, "angular size|angular diameter|dimensions"],
      ["References", np ? `${num(np, 0)} <button type="button" class="linklike" data-action="papers" aria-haspopup="dialog">browse papers →</button>` : null],
    ]);
    let html = `<h3>Basic data</h3>${basic}`;

    const fl = Object.entries(sb.fluxes || {});
    if (fl.length) {
      const order = "UBVRIGJHK";
      fl.sort((a, b) => (order.indexOf(a[0]) + 1 || 99) - (order.indexOf(b[0]) + 1 || 99));
      const rows = fl.map(([band, v]) => Object.assign({ band }, v && typeof v === "object" ? v : { mag: v }));
      html += `<h3><span data-gl="photometry|photometric band|apparent magnitude">Photometry</span> · ${fl.length} bands</h3>${dataTable(rows, { limit: 20, unit: "bands" })}`;
    }

    const hier = hierarchyRows(sb.hierarchy);
    if (hier.length) html += `<h3><span data-gl="hierarchy|SIMBAD hierarchy">Hierarchy</span> · ${hier.length}</h3>${dataTable(hier, { limit: 10 })}`;

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
        const mgl = MEASUREMENT_GL[name] ? ` data-gl="${esc(MEASUREMENT_GL[name])}|${esc(title)}"` : "";
        return `<div class="mtable"><div class="mtitle"><span class="mname"${mgl}>${esc(title)}</span> <span class="muted">· ${rows.length} ${rows.length === 1 ? "row" : "rows"} · <span class="mono">${esc(name)}</span></span></div>${dataTable(rows)}</div>`;
      }).join("");
    }

    if ((sb.identifiers || []).length) {
      html += `<h3><span data-gl="identifier|designation|catalogue designation">Identifiers</span> · ${sb.identifiers.length}</h3><div class="ids">${sb.identifiers.map((i) => `<span class="tag mono">${esc(String(i).replace(/\s+/g, " "))}</span>`).join("")}</div>`;
    }
    if ((sb.types || []).length) {
      html += `<h3 data-gl="object type|otype|classification">Classifications</h3><div class="ids">${sb.types.map((t) => `<span class="tag mono" data-vk="otype">${esc(t)}</span>`).join("")}</div>`;
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
  // JPL Horizons physical data arrives as fixed-width text ("Label = value", one or two pairs per
  // line, then a small Perihelion/Aphelion/Mean table). [pattern on the lower-cased label, friendly
  // name, unit appended to bare numbers, extra glossary hint]
  const HZ_LABELS = [
    [/^mass x\s?10/, "Mass", "kg", "mass"],
    [/^density/, "Density", "g/cm³", "density"],
    [/^equat(\.|orial)? radius/, "Equatorial radius", "km", "equatorial radius|radius"],
    [/^polar radius/, "Polar radius", "km", "polar radius|radius"],
    [/^vol(\.|ume)? mean radius/, "Mean radius", "km", "mean radius|radius"],
    [/^flattening/, "Flattening (how squashed it is)", "", "flattening|oblateness"],
    [/^geometric albedo/, "Geometric albedo (reflectivity)", "", "geometric albedo|albedo"],
    [/^rocky core mass/, "Rocky core mass (fraction of total mass)", "", "rocky core mass|core"],
    [/^sid(\.|ereal)? rot(\.|ation)? period/, "Rotation period (sidereal)", "", "sidereal rotation period|rotation period|sidereal"],
    [/^sid(\.|ereal)? rot(\.|ation)? rate/, "Rotation rate", "rad/s", "rotation rate|angular velocity"],
    [/^mean solar day/, "Length of a solar day", "", "solar day|mean solar day"],
    [/^gm 1-sigma/, "GM uncertainty (1σ)", "km³/s²", "1-sigma|standard deviation|uncertainty"],
    [/^gm\b/, "GM (gravitational parameter)", "km³/s²", "standard gravitational parameter|GM"],
    [/^equ(\.|atorial)? grav/, "Surface gravity at the equator", "m/s²", "surface gravity|gravity"],
    [/^pol(\.|ar)? grav/, "Surface gravity at the poles", "m/s²", "surface gravity|gravity"],
    [/^vis(\.|ual)? mag(\.|nitude)? v\(1,0\)/, "Brightness at 1 AU, V(1,0)", "", "V(1,0)|absolute magnitude"],
    [/^vis(\.|ual)? mag(\.|nitude)? \(opposition\)/, "Magnitude at opposition", "", "opposition|apparent magnitude"],
    [/^obliquity/, "Axial tilt (obliquity)", "", "obliquity|axial tilt"],
    [/^(sidereal orbit period|mean sidereal orb(it)? per)/, "Orbital period (sidereal)", "", "sidereal orbital period|orbital period|sidereal"],
    [/^mean daily motion/, "Mean daily motion", "", "mean daily motion|mean motion"],
    [/^(mean orbit (speed|velocity)|orbital speed)/, "Mean orbital speed", "km/s", "orbital speed|orbital velocity"],
    [/^atmos(\.|pheric)? temp/, "Atmosphere temperature (at 1 bar)", "", "atmospheric temperature|bar|temperature"],
    [/^mean temperature/, "Mean temperature", "K", "temperature|kelvin"],
    [/^escape (speed|velocity)/, "Escape speed", "km/s", "escape velocity|escape speed"],
    [/^a_?roche\(ice\)/, "Roche limit for ice (planet radii)", "", "Roche limit"],
    [/^hill's sphere/, "Hill sphere radius (planet radii)", "", "Hill sphere"],
    [/^core radius/, "Core radius", "km", "core|radius"],
    [/^mass ratio/, "Mass ratio (Sun ÷ planet)", "", "mass ratio|mass"],
    [/^mass of atmosphere/, "Mass of the atmosphere", "kg", "atmosphere|mass"],
    [/^atmos(\.|pheric)? pressure/, "Surface air pressure", "bar", "atmospheric pressure|bar"],
    [/^max(\.|imum)? angular diam/, "Largest apparent size", "", "angular diameter|apparent size"],
    [/^volume/, "Volume", "km³", "volume"],
    [/^solar constant/, "Sunlight received (solar constant)", "W/m²", "solar constant|irradiance"],
    [/^maximum planetary ir/, "Heat given off, maximum (infrared)", "W/m²", "planetary IR|infrared"],
    [/^minimum planetary ir/, "Heat given off, minimum (infrared)", "W/m²", "planetary IR|infrared"],
  ];
  function hzLabel(label) {
    const low = label.toLowerCase().replace(/\s+/g, " ").trim();
    const hit = HZ_LABELS.find(([re]) => re.test(low));
    const exp = label.match(/x\s?10\^(-?\d+)/i);
    let unit = hit ? hit[2] : "";
    if (!unit && /,\s*hrs?\b/.test(low)) unit = "h";
    const name = hit ? hit[1] : label;
    return { name, unit, exp: exp ? exp[1] : null, gl: [label, name, hit && hit[3]].filter(Boolean).join("|") };
  }
  function hzValue(v, f) {
    let s = esc(String(v).trim()).replace(/\s*\+-\s*/g, " ± ").replace(/(^|[\s±(~])\.(\d)/g, "$10.$2").replace(/(\d)\s*deg\/d\b/g, "$1°/day").replace(/(\d)\s*deg\b/g, "$1°")
      .replace(/\bx\s*10\^(-?\d+)/g, "× 10<sup>$1</sup>").replace(/\^(-?\d+)/g, "<sup>$1</sup>");
    const bare = /^[~<>]?\s*[+\-−]?\d*\.?\d+(\(\d+(\s*±\s*\d+)?\))?(\s*±\s*\d*\.?\d+)?$/.test(String(v).trim().replace(/\s*\+-\s*/g, " ± "));
    if (bare && f) {
      if (f.exp) s += ` × 10<sup>${esc(f.exp)}</sup>`;
      if (f.unit) s += ` <span class="u">${esc(f.unit)}</span>`;
    }
    return s;
  }
  const hzLabelHtml = (label) => {
    const f = hzLabel(label);
    return `<span class="gl-name" data-gl="${esc(f.gl)}">${esc(f.name)}</span>${f.name !== label ? `<span class="hz-orig">${esc(label)}</span>` : ""}`;
  };

  function parsePhysical(text) {
    const lines = String(text || "").replace(/\r/g, "").split("\n");
    const out = { title: "", pairs: [], head: null, rows: [], other: [] };
    const eqs = (l) => [...l].reduce((a, c, i) => (c === "=" ? a.concat(i) : a), []);
    // Word starts between two "=" signs (after the first value token), with the run of spaces before each.
    const splits = (l, from, to) => {
      const c = [];
      let i = from + 1;
      while (i < to && l[i] === " ") i++;
      while (i < to && l[i] !== " ") i++;
      for (; i < to; i++) {
        if (l[i] === " " || l[i - 1] !== " ") continue;
        let run = 0;
        for (let j = i - 1; j >= 0 && l[j] === " "; j--) run++;
        c.push({ p: i, run });
      }
      return c;
    };
    // Horizons aligns the second column; learn its start column from the unambiguous lines.
    const cols = [];
    lines.forEach((l) => {
      const e = eqs(l);
      for (let k = 0; k + 1 < e.length; k++) {
        const c = splits(l, e[k], e[k + 1]);
        const best = c.reduce((a, b) => (b.run > (a ? a.run : -1) ? b : a), null);
        if (best && best.run >= 3) cols.push(best.p);
      }
    });
    cols.sort((a, b) => a - b);
    const C = cols.length ? cols[Math.floor(cols.length / 2)] : null;
    lines.forEach((l) => {
      if (!l.trim()) return;
      const e = eqs(l);
      if (!e.length) {
        if (/perihelion/i.test(l) && /aphelion/i.test(l)) { out.head = l.trim().split(/\s{2,}/); return; }
        const m = out.head && l.match(/^\s*(.+?)\s{2,}(\S+)\s+(\S+)\s+(\S+)\s*$/);
        if (m) { out.rows.push([m[1].trim(), m[2], m[3], m[4]]); return; }
        if (!out.pairs.length && !out.title && /:\s*$|physical data/i.test(l)) { out.title = l.trim().replace(/:$/, ""); return; }
        out.other.push(l.trim());
        return;
      }
      let start = 0;
      e.forEach((eq, k) => {
        const label = l.slice(start, eq).trim();
        let end = l.length;
        if (k + 1 < e.length) {
          const c = splits(l, eq, e[k + 1]);
          const wide = c.filter((x) => x.run >= 2), pool = wide.length ? wide : c;
          const pick = !pool.length ? null : C != null
            ? pool.reduce((a, b) => (Math.abs(b.p - C) < Math.abs(a.p - C) || (Math.abs(b.p - C) === Math.abs(a.p - C) && b.run > a.run) ? b : a))
            : pool.reduce((a, b) => (b.run > a.run ? b : a));
          end = pick ? pick.p : e[k + 1];
        }
        const value = l.slice(eq + 1, end).trim();
        if (label || value) out.pairs.push({ label: label || "—", value });
        start = end;
      });
    });
    return out;
  }

  function physicalBlock(text) {
    const P = parsePhysical(text);
    const raw = `<details class="raw"><summary>Raw text from JPL Horizons</summary><div><pre>${esc(text)}</pre></div></details>`;
    if (!P.pairs.length && !P.rows.length) return `<pre>${esc(text)}</pre>`;
    let html = kvTable(P.pairs.map(({ label, value }) => [hzLabelHtml(label), value ? hzValue(value, hzLabel(label)) : '<span class="muted">—</span>']), "hz", true);
    if (P.rows.length) {
      const head = (P.head || ["Perihelion", "Aphelion", "Mean"]).slice(-3);
      const HEAD_GL = { perihelion: "perihelion", aphelion: "aphelion", mean: "mean distance|semi-major axis" };
      html += `<div class="tablewrap hz-pam"><table><thead><tr><th></th>${head.map((h) =>
        `<th${HEAD_GL[h.toLowerCase()] ? ` data-gl="${HEAD_GL[h.toLowerCase()]}|${esc(h)}"` : ""}>${esc(h)}</th>`).join("")}</tr></thead><tbody>${P.rows.map(([label, ...vals]) => {
        const f = hzLabel(label);
        return `<tr><th scope="row">${hzLabelHtml(label)}</th>${vals.map((v) => `<td>${hzValue(v, f)}</td>`).join("")}</tr>`;
      }).join("")}</tbody></table></div>`;
    }
    if (P.other.length) html += `<div class="note">${P.other.map(esc).join("<br>")}</div>`;
    if (P.title) html += `<div class="note">${esc(P.title.replace(/^physical data\s*/i, "Horizons physical data "))}</div>`;
    return html + raw;
  }

  // Horizons ephemeris columns: [pattern on the raw key, header, glossary hints, cell formatter, value kind]
  const deg = (v) => `${rawNum(+v)}°`;
  const EPH_COLS = [
    [/^date/i, "Date and time (UT)", "Universal Time|UT|UTC", null],
    [/^r\.?a\.?(_|\b)/i, "Right ascension", "right ascension|RA", (v) => ra(+v)],
    [/^dec(_|\b)/i, "Declination", "declination|Dec", (v) => dec(+v)],
    [/^azi/i, "Azimuth", "azimuth", (v) => `${rawNum(+v)}° <span class="muted">${compass(+v)}</span>`],
    [/^elev/i, "Altitude", "altitude|elevation", deg],
    [/^apmag$/i, "Magnitude", "APmag|apparent magnitude|magnitude", null, "mag"],
    [/^s-brt$/i, "Surface brightness", "S-brt|surface brightness", (v) => `${rawNum(+v)} <span class="u">mag/arcsec²</span>`],
    [/^illu%$/i, "Illuminated", "Illu%|illuminated fraction|illumination|phase", (v) => `${num(+v, 1)}%`],
    [/^ang-diam$/i, "Apparent size", "Ang-diam|angular diameter|apparent size", (v) => `${num(+v, 2)}″`],
    [/^delta$/i, "Distance from you (AU)", "delta|astronomical unit|AU", (v) => num(+v, 4)],
    [/^deldot$/i, "Range rate", "deldot|range rate|radial velocity", (v) => `${num(+v, 3)} <span class="u">km/s</span>`],
    [/^s-o-t$/i, "Sun–object–observer angle (elongation)", "S-O-T|elongation", deg],
    [/^\/r$/i, "Side of the Sun", "S-O-T|elongation|leading|trailing", (v) => /L/i.test(v) ? "leads the Sun <span class=\"muted\">(morning sky)</span>" : /T/i.test(v) ? "trails the Sun <span class=\"muted\">(evening sky)</span>" : esc(v), null, true],
    [/^s-t-o$/i, "Phase angle", "S-T-O|phase angle", deg],
    [/^r$/i, "Distance from the Sun (AU)", "heliocentric distance|r|astronomical unit", (v) => num(+v, 4)],
    [/^rdot$/i, "Sun range rate", "rdot|range rate", (v) => `${num(+v, 3)} <span class="u">km/s</span>`],
    [/^t-o-m$/i, "Angle from the Moon", "T-O-M|lunar elongation", deg],
    [/^cnst$/i, "Constellation", "constellation", null],
  ];
  function ephemerisTable(eph) {
    const keys = [];
    eph.forEach((r) => Object.keys(r).forEach((k) => { if (!keys.includes(k)) keys.push(k); }));
    // Junk columns: empty keys and columns with no values.
    const used = keys.filter((k) => k.replace(/[\s/_]/g, "") && eph.some((r) => !blank(r[k])));
    if (!used.length) return "";
    const spec = used.map((k) => EPH_COLS.find(([re]) => re.test(k.trim())) || [null, colName(k), k, null]);
    const head = used.map((k, i) => {
      const [, name, gl, , vk] = spec[i];
      return `<th${vk ? ` data-col-vk="${vk}"` : ""}><span class="gl-name" data-gl="${esc(gl)}|${esc(name)}">${esc(name)}</span>${name !== k ? `<span class="hz-orig">${esc(k)}</span>` : ""}</th>`;
    }).join("");
    const body = eph.map((r, n) => `<tr${n >= 10 ? ' class="extra"' : ""}>${used.map((k, i) => {
      const v = r[k], f = spec[i][3];
      if (blank(v)) return '<td><span class="muted">—</span></td>';
      const s = String(v).trim();
      const isNum = s !== "" && !Number.isNaN(+s);
      return `<td data-vv="${esc(s)}">${f && (isNum || spec[i][5]) ? f(s) : esc(s)}</td>`;
    }).join("")}</tr>`).join("");
    return `<div class="clip"><div class="tablewrap"><table class="eph"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>${moreButton(eph.length, 10, "rows")}</div>`;
  }

  function horizonsSection(o) {
    const hz = o.horizons;
    if (!hz) return "";
    let html = "";
    if (hz.physical_data) html += `<h3>Physical data</h3>${physicalBlock(hz.physical_data)}`;
    const eph = asList(hz.ephemeris).filter((r) => r && typeof r === "object");
    if (eph.length) {
      html += `<h3><span data-gl="ephemeris">Ephemeris</span> · ${eph.length} ${eph.length === 1 ? "row" : "rows"}</h3>${ephemerisTable(eph)}<div class="note">Positions computed by JPL Horizons for the observation times, as seen from the observing site.</div>`;
    }
    const link = safeUrl(hz.url) ? ` <a class="sec-src" href="${esc(safeUrl(hz.url))}" target="_blank" rel="noopener">Horizons ↗</a>` : "";
    return section("horizons", `JPL Horizons${link}`, html);
  }

  // CelesTrak SATCAT / GP fields: friendly label, glossary hints, unit, value decoder.
  const CT_FIELDS = {
    OBJECT_NAME: ["Name", "satellite name|name"],
    OBJECT_ID: ["International designator (COSPAR ID)", "COSPAR ID|international designator"],
    NORAD_CAT_ID: ["NORAD catalogue number", "NORAD ID|NORAD catalog number|NORAD"],
    EPOCH: ["Epoch (time these elements describe)", "epoch"],
    MEAN_MOTION: ["Mean motion (orbits/day)", "mean motion"],
    ECCENTRICITY: ["Eccentricity (0 = circular)", "eccentricity"],
    INCLINATION: ["Inclination", "inclination", "°"],
    RA_OF_ASC_NODE: ["Right ascension of ascending node", "right ascension of the ascending node|RAAN|ascending node", "°"],
    ARG_OF_PERICENTER: ["Argument of perigee", "argument of perigee|argument of periapsis|argument of pericenter", "°"],
    MEAN_ANOMALY: ["Mean anomaly", "mean anomaly", "°"],
    EPHEMERIS_TYPE: ["Ephemeris type", "ephemeris type|SGP4"],
    CLASSIFICATION_TYPE: ["Classification", "classification type|classification"],
    ELEMENT_SET_NO: ["Element set number", "element set number|element set|TLE"],
    REV_AT_EPOCH: ["Orbit count at epoch", "revolution number|revolution"],
    BSTAR: ["Drag term (B*)", "BSTAR|B*|drag term"],
    MEAN_MOTION_DOT: ["Change in mean motion (1st derivative)", "mean motion derivative|MEAN_MOTION_DOT|mean motion"],
    MEAN_MOTION_DDOT: ["Change in mean motion (2nd derivative)", "mean motion second derivative|MEAN_MOTION_DDOT|mean motion"],
    OBJECT_TYPE: ["Object type", "satellite object type|object type"],
    OPS_STATUS_CODE: ["Operational status", "operational status"],
    OWNER: ["Owner", "owner"],
    LAUNCH_DATE: ["Launch date", "launch date"],
    LAUNCH_SITE: ["Launch site", "launch site"],
    DECAY_DATE: ["Re-entry (decay) date", "orbital decay|decay date|re-entry"],
    PERIOD: ["Orbital period", "orbital period|period", "min"],
    APOGEE: ["Apogee (highest point)", "apogee", "km"],
    PERIGEE: ["Perigee (lowest point)", "perigee", "km"],
    RCS: ["Radar cross-section", "radar cross-section|RCS", "m²"],
    DATA_STATUS_CODE: ["Data status", "data status"],
    ORBIT_CENTER: ["Orbit centre", "orbit center|orbit centre"],
    ORBIT_TYPE: ["Orbit type", "orbit type"],
  };
  const CT_VALUES = {
    OBJECT_TYPE: { PAY: "Payload (working spacecraft)", "R/B": "Rocket body", DEB: "Debris", UNK: "Unknown" },
    OPS_STATUS_CODE: { "+": "Operational", "-": "Not operational", P: "Partially operational", B: "Backup", S: "Spare",
      X: "Extended mission", D: "Decayed", "?": "Unknown" },
    ORBIT_CENTER: { EA: "Earth", MO: "Moon", SU: "Sun", EM: "Earth–Moon" },
    ORBIT_TYPE: { ORB: "In orbit", LAN: "Landed", IMP: "Impacted", DOC: "Docked", "R/T": "Round trip" },
    CLASSIFICATION_TYPE: { U: "Unclassified", C: "Classified", S: "Secret" },
    EPHEMERIS_TYPE: { 0: "Standard (SGP4 model)" },
    OWNER: { US: "United States", PRC: "China", CIS: "Russia / former USSR", ESA: "European Space Agency", JPN: "Japan",
      IND: "India", UK: "United Kingdom", FR: "France", GER: "Germany", CA: "Canada", ISS: "International Space Station partners" },
    LAUNCH_SITE: { AFETR: "Cape Canaveral, Florida", AFWTR: "Vandenberg, California", TYMSC: "Baikonur, Kazakhstan",
      PKMTR: "Plesetsk, Russia", JSC: "Jiuquan, China", XICLF: "Xichang, China", TAISC: "Taiyuan, China", WSC: "Wenchang, China",
      FRGUI: "Kourou, French Guiana", SRILR: "Sriharikota, India", TNSTA: "Tanegashima, Japan", KYMSC: "Kapustin Yar, Russia",
      VOSTO: "Vostochny, Russia", RLLB: "Mahia, New Zealand", WRAS: "Wallops Island, Virginia", STAR: "Starbase, Texas" },
  };
  function ctValue(k, v) {
    if (blank(v)) return '<span class="muted">—</span>';
    const f = CT_FIELDS[k], dict = CT_VALUES[k];
    if (dict && dict[v] != null) return `${esc(dict[v])} <span class="muted mono">${esc(v)}</span>`;
    if (k === "EPOCH" && /^\d{4}-\d\d-\d\dT/.test(v)) return `${esc(String(v).replace("T", " ").replace(/\.\d+$/, ""))} <span class="u">UTC</span>`;
    const s = typeof v === "number" ? (k === "ECCENTRICITY" ? String(+v.toPrecision(4)) : rawNum(v)) : esc(v);
    return f && f[2] && typeof v === "number" ? `${s}${f[2] === "°" ? "°" : ` <span class="u">${f[2]}</span>`}` : s;
  }

  function celestrakSection(o) {
    const c = o.celestrak;
    if (!c) return "";
    const tbl = (obj) => kvTable(Object.entries(obj || {}).map(([k, v]) => {
      const f = CT_FIELDS[k];
      const name = f ? f[0] : colName(k);
      const label = `<span class="gl-name" data-gl="${esc(f ? f[1] : k)}|${esc(name)}|${esc(k)}">${esc(name)}</span><span class="hz-orig">${esc(k)}</span>`;
      return [label, ctValue(k, v)];
    }), "ct", true);
    const parts = [];
    if (c.catalog) parts.push(`<div><h3 data-gl="satellite catalog|SATCAT">Satellite catalogue record</h3>${tbl(c.catalog)}</div>`);
    if (c.orbit) parts.push(`<div><h3 data-gl="orbital elements|TLE|two-line element set">Current orbital elements</h3>${tbl(c.orbit)}<div class="note">Latest elements, not those at the time of the observation.</div></div>`);
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
    annotate(el);
  }

  // ---------- glossary modal (topbar "?") ----------
  function openGlossary(opener) {
    closeModal();
    modal.obj = null; modal.opener = opener || document.activeElement; modal.papers = [];
    const g = gloss();
    const terms = g && g.terms ? Object.entries(g.terms).filter(([, t]) => t && typeof t === "object")
      .map(([id, t]) => ({ id, t, hay: [t.term, t.short, t.long, id].filter(Boolean).join(" ").toLowerCase() }))
      .sort((a, b) => String(a.t.term || a.id).localeCompare(String(b.t.term || b.id), undefined, { sensitivity: "base" })) : [];
    const el = document.createElement("div");
    el.className = "modal-backdrop";
    el.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div class="modal-head"><h3 id="modal-title">Glossary</h3><button type="button" class="ghost modal-close" data-action="close" aria-label="Close">✕</button></div>
      <div class="modal-tools"><input type="search" class="modal-search" placeholder="Search ${terms.length} terms…" aria-label="Search the glossary" autocomplete="off"></div>
      <div class="modal-count muted" aria-live="polite"></div>
      <div class="modal-body"></div></div>`;
    document.body.appendChild(el);
    document.body.classList.add("modal-open");
    modal.el = el;
    const input = el.querySelector(".modal-search"), body = el.querySelector(".modal-body"), count = el.querySelector(".modal-count");
    const render = () => {
      const q = input.value.trim().toLowerCase();
      const named = (x) => String(x.t.term || x.id).toLowerCase().includes(q) ? 0 : 1;   // name matches first
      const list = terms.filter((x) => !q || q.split(/\s+/).every((w) => x.hay.includes(w))).sort((a, b) => q ? named(a) - named(b) : 0);
      count.textContent = q ? `${list.length} of ${terms.length} terms` : `${terms.length} terms`;
      if (!terms.length) { body.innerHTML = '<div class="empty">The glossary (assets/glossary.js) is not loaded.</div>'; return; }
      body.innerHTML = list.length ? `<dl class="gloss">${list.map(({ id, t }) => `<div class="gloss-item" id="gloss-${esc(id)}"><dt>${esc(t.term || id)}</dt>${t.short ? `<dd>${esc(t.short)}</dd>` : ""}${t.long ? `<dd class="gloss-long">${esc(t.long)}</dd>` : ""}</div>`).join("")}</dl>`
        : '<div class="empty">No terms match.</div>';
    };
    el.addEventListener("click", (e) => { if (e.target === el || e.target.closest('[data-action="close"]')) closeModal(); });
    input.addEventListener("input", render);
    render();
    input.focus();
  }

  function closeModal() {
    if (!modal.el) return;
    modal.el.remove();
    modal.el = null;
    if (tip.target && !tip.target.isConnected) hideTip();
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
    $("#objects-link").removeAttribute("aria-current");
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

  function renderSizes() {
    document.body.classList.add("is-overview");   // same full-width layout as the overview
    $("#objects-link").removeAttribute("aria-current");
    $(".layout").classList.add("showing");
    $("#sizes-link").setAttribute("aria-current", "page");
    if (state.sizes) return;
    const detail = $("#detail");
    if (!window.MO_SIZES || typeof window.MO_SIZES.render !== "function") {
      detail.innerHTML = '<div class="empty">Sizes not available. The script assets/sizes.js did not load.</div>';
      return;
    }
    state.sizes = true;
    detail.innerHTML = "";
    try {
      window.MO_SIZES.render(detail, { data: window.MO_DATA, navigate: (path) => { location.hash = path; } });
    } catch (e) {
      detail.innerHTML = `<div class="empty">The size comparison could not be drawn: ${esc(e.message)}</div>`;
    }
    window.scrollTo({ top: 0 });
  }

  function leaveSizes() {
    if (state.sizes) {
      try { window.MO_SIZES && window.MO_SIZES.destroy && window.MO_SIZES.destroy(); } catch {}
      state.sizes = false;
    }
    document.body.classList.remove("is-overview");
    $("#sizes-link").removeAttribute("aria-current");
  }

  async function renderDetail() {
    const path = decodeURIComponent(location.hash.slice(1));
    const seq = ++state.seq;
    hideTip();
    closeModal();
    destroyAladin();
    if (!path || path === "overview") { leaveSizes(); return renderOverview(); }   // the overview is the home page
    if (path === "sizes") { leaveOverview(); return renderSizes(); }
    leaveOverview();
    leaveSizes();
    const layout = $(".layout");
    if (path === "objects") {
      layout.classList.remove("showing");
      $("#objects-link").setAttribute("aria-current", "page");
      $("#detail").innerHTML = `<div class="empty">Pick an object on the left, or open the <a href="#overview">overview</a>. ${state.objects.length} objects, ${state.objects.reduce((n, o) => n + o.observations, 0)} observations.</div>`;
      return;
    }
    layout.classList.add("showing");
    $("#objects-link").removeAttribute("aria-current");
    $("#detail").innerHTML = '<div class="empty">Loading…</div>';
    let o;
    try { o = await loadObject(path); }
    catch (e) { if (seq === state.seq) $("#detail").innerHTML = `<div class="empty">Could not load ${esc(path)}: ${esc(e.message)}</div>`; return; }
    if (seq !== state.seq) return;
    const s = o.summary || {};
    const des = cleanId(s.designation);
    const tags = [o.gz_id, CATEGORIES[o.category] || o.category, o.app_type, des && des !== o.name ? des : null]
      .filter(Boolean).map((t) => `<span class="tag">${esc(t)}</span>`).join("");
    const body = [keyFacts(o), skySection(o), observationsTable(o), horizonsSection(o), celestrakSection(o),
      articleSection(o), simbadSection(o), wikidataSection(o), sourcesRow(o)].join("");
    $("#detail").innerHTML = `
      <a class="back" href="#objects">← All objects</a>
      <div class="hero"><div><h1>${esc(o.name)}</h1>${s.description ? `<div class="desc">${esc(s.description)}</div>` : ""}<div class="tags">${tags}</div></div>${images(o)}</div>
      ${pageNav(body)}
      ${body}`;
    annotate($("#detail"));
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
    if (state.overview || document.body.classList.contains("is-overview")) location.hash = "objects";   // searching leaves the overview
  });
  $("#sort").addEventListener("change", (e) => { state.sort = e.target.value; save("sort", state.sort); renderList(); });
  const glossBtn = $("#glossary-btn");
  if (glossBtn) glossBtn.addEventListener("click", () => openGlossary(glossBtn));
  $("#night").addEventListener("click", () => {
    const on = document.documentElement.dataset.theme !== "night";
    setNight(on); save("night", on ? "1" : "");
  });
  $("#detail").addEventListener("click", (e) => {
    if (state.overview || state.sizes) return;   // the charts own their clicks
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
        annotate(clip);
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
