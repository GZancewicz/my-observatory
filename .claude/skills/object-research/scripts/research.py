"""Harvest details for every object in observations.csv into data/<category>/<slug>/.

Usage (from the project root):
    python3 .claude/skills/object-research/scripts/research.py            # new objects only
    python3 .claude/skills/object-research/scripts/research.py --refresh  # re-harvest everything
    python3 .claude/skills/object-research/scripts/research.py --only "ρ Hya" --refresh
    python3 .claude/skills/object-research/scripts/research.py --refresh --workers 6
    python3 .claude/skills/object-research/scripts/research.py --sky      # rebuild data/sky/boundaries.*

Each object folder gets object.json (all details plus my observations of it),
papers.json (SIMBAD references), article.json (full Wikipedia article),
extra.js (papers + article for the browser), sky.jpg (DSS2 colour cutout, when
the object has coordinates) and photo.jpg (the Wikipedia lead image, when there
is one). data/index.json and data/bundle.js list every object for the viewer;
data/sky/boundaries.json and .js hold the IAU constellation boundaries.
Observations are rewritten on every run; harvested details are kept unless
--refresh is given.
"""
import argparse
import contextlib
import csv
import json
import math
import re
import sys
import threading
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

import requests

ROOT = Path.cwd()
DATA = ROOT / "data"
CSV_PATH = ROOT / "observations.csv"
TARGETS_PATH = ROOT / "targets.csv"
UA = {"User-Agent": "my-observatory/0.1 (personal observing log)"}
PAUSE = 0.3  # seconds between requests to the same service
# host -> (minimum seconds between request starts, requests in flight at once)
HOST_LIMITS = {"nominatim.openstreetmap.org": (1.1, 1), "celestrak.org": (1.0, 1),
               "query.wikidata.org": (0.5, 1), "simbad.cds.unistra.fr": (PAUSE, 3),
               "en.wikipedia.org": (0.4, 1), "www.wikidata.org": (0.4, 1)}
PER_HOST = 2
TAP_PAGE = 20000  # rows per page when paging long SIMBAD reference lists

SIMBAD_TAP = "https://simbad.cds.unistra.fr/simbad/sim-tap/sync"
SIMBAD_ID = "https://simbad.cds.unistra.fr/simbad/sim-id"
SESAME = "https://cds.unistra.fr/cgi-bin/nph-sesame/-oxp/S?"
WIKI_REST = "https://en.wikipedia.org/api/rest_v1/page/summary/"
WIKI_MEDIA = "https://en.wikipedia.org/api/rest_v1/page/media-list/"
WIKI_API = "https://en.wikipedia.org/w/api.php"
WIKIDATA_API = "https://www.wikidata.org/w/api.php"
WIKIDATA_SPARQL = "https://query.wikidata.org/sparql"
HORIZONS = "https://ssd.jpl.nasa.gov/api/horizons.api"
CELESTRAK_GP = "https://celestrak.org/NORAD/elements/gp.php"
CELESTRAK_SATCAT = "https://celestrak.org/satcat/records.php"
HIPS2FITS = "https://alasky.cds.unistra.fr/hips-image-services/hips2fits"
NOMINATIM = "https://nominatim.openstreetmap.org/search"
VIZIER_TAP = "https://tapvizier.cds.unistra.fr/TAPVizieR/tap/sync"

# MO Pro "type" line -> data/ folder
CATEGORY_RULES = [
    (r"-Star$|^Star$|Double Star|Variable Star", "stars"),
    (r"^Planet$|Dwarf Planet", "planets"),
    (r"^Moon$|Satellite of", "moons"),
    (r"Constellation", "constellations"),
    (r"Artificial Satellite|ISS", "satellites"),
    (r"Galaxy", "galaxies"),
    (r"Nebula", "nebulae"),
    (r"Cluster", "clusters"),
    (r"Comet", "comets"),
    (r"Asteroid|Minor Planet", "minor-bodies"),
]
HORIZONS_ID = {"Mercury": "199", "Venus": "299", "Moon": "301", "Mars": "499",
               "Jupiter": "599", "Saturn": "699", "Uranus": "799", "Neptune": "899",
               "Pluto": "999", "Sun": "10"}

GREEK = {"α": ("alf", "alpha"), "β": ("bet", "beta"), "γ": ("gam", "gamma"),
         "δ": ("del", "delta"), "ε": ("eps", "epsilon"), "ζ": ("zet", "zeta"),
         "η": ("eta", "eta"), "θ": ("tet", "theta"), "ι": ("iot", "iota"),
         "κ": ("kap", "kappa"), "λ": ("lam", "lambda"), "μ": ("mu.", "mu"),
         "ν": ("nu.", "nu"), "ξ": ("ksi", "xi"), "ο": ("omi", "omicron"),
         "π": ("pi.", "pi"), "ρ": ("rho", "rho"), "σ": ("sig", "sigma"),
         "τ": ("tau", "tau"), "υ": ("ups", "upsilon"), "φ": ("phi", "phi"),
         "χ": ("chi", "chi"), "ψ": ("psi", "psi"), "ω": ("ome", "omega")}
SUPER = str.maketrans("⁰¹²³⁴⁵⁶⁷⁸⁹", "0123456789")
GREEK_FROM_ABBR = {abbr.rstrip("."): full for abbr, full in GREEK.values()}

# MO Pro spellings that neither SIMBAD nor Wikipedia know
ALIASES = {"Adara": "Adhara"}

GENITIVE = dict(x.split(":") for x in """And:Andromedae Ant:Antliae Aps:Apodis Aqr:Aquarii Aql:Aquilae Ara:Arae
Ari:Arietis Aur:Aurigae Boo:Boötis Cae:Caeli Cam:Camelopardalis Cnc:Cancri CVn:Canum_Venaticorum
CMa:Canis_Majoris CMi:Canis_Minoris Cap:Capricorni Car:Carinae Cas:Cassiopeiae Cen:Centauri Cep:Cephei
Cet:Ceti Cha:Chamaeleontis Cir:Circini Col:Columbae Com:Comae_Berenices CrA:Coronae_Australis
CrB:Coronae_Borealis Crv:Corvi Crt:Crateris Cru:Crucis Cyg:Cygni Del:Delphini Dor:Doradus Dra:Draconis
Equ:Equulei Eri:Eridani For:Fornacis Gem:Geminorum Gru:Gruis Her:Herculis Hor:Horologii Hya:Hydrae
Hyi:Hydri Ind:Indi Lac:Lacertae Leo:Leonis LMi:Leonis_Minoris Lep:Leporis Lib:Librae Lup:Lupi Lyn:Lyncis
Lyr:Lyrae Men:Mensae Mic:Microscopii Mon:Monocerotis Mus:Muscae Nor:Normae Oct:Octantis Oph:Ophiuchi
Ori:Orionis Pav:Pavonis Peg:Pegasi Per:Persei Phe:Phoenicis Pic:Pictoris Psc:Piscium PsA:Piscis_Austrini
Pup:Puppis Pyx:Pyxidis Ret:Reticuli Sge:Sagittae Sgr:Sagittarii Sco:Scorpii Scl:Sculptoris Sct:Scuti
Ser:Serpentis Sex:Sextantis Tau:Tauri Tel:Telescopii Tri:Trianguli TrA:Trianguli_Australis Tuc:Tucanae
UMa:Ursae_Majoris UMi:Ursae_Minoris Vel:Velorum Vir:Virginis Vol:Volantis Vul:Vulpeculae""".split())
GENITIVE = {k: v.replace("_", " ") for k, v in GENITIVE.items()}
CONSTELLATIONS = dict(x.split(":") for x in """And:Andromeda Ant:Antlia Aps:Apus Aqr:Aquarius Aql:Aquila
Ara:Ara Ari:Aries Aur:Auriga Boo:Boötes Cae:Caelum Cam:Camelopardalis Cnc:Cancer CVn:Canes_Venatici
CMa:Canis_Major CMi:Canis_Minor Cap:Capricornus Car:Carina Cas:Cassiopeia Cen:Centaurus Cep:Cepheus
Cet:Cetus Cha:Chamaeleon Cir:Circinus Col:Columba Com:Coma_Berenices CrA:Corona_Australis
CrB:Corona_Borealis Crv:Corvus Crt:Crater Cru:Crux Cyg:Cygnus Del:Delphinus Dor:Dorado Dra:Draco
Equ:Equuleus Eri:Eridanus For:Fornax Gem:Gemini Gru:Grus Her:Hercules Hor:Horologium Hya:Hydra
Hyi:Hydrus Ind:Indus Lac:Lacerta Leo:Leo LMi:Leo_Minor Lep:Lepus Lib:Libra Lup:Lupus Lyn:Lynx
Lyr:Lyra Men:Mensa Mic:Microscopium Mon:Monoceros Mus:Musca Nor:Norma Oct:Octans Oph:Ophiuchus
Ori:Orion Pav:Pavo Peg:Pegasus Per:Perseus Phe:Phoenix Pic:Pictor Psc:Pisces PsA:Piscis_Austrinus
Pup:Puppis Pyx:Pyxis Ret:Reticulum Sge:Sagitta Sgr:Sagittarius Sco:Scorpius Scl:Sculptor Sct:Scutum
Ser:Serpens Sex:Sextans Tau:Taurus Tel:Telescopium Tri:Triangulum TrA:Triangulum_Australe Tuc:Tucana
UMa:Ursa_Major UMi:Ursa_Minor Vel:Vela Vir:Virgo Vol:Volans Vul:Vulpecula""".split())
CONSTELLATIONS = {k: v.replace("_", " ") for k, v in CONSTELLATIONS.items()}

# empty Wikipedia sections not worth keeping (their lists are dropped by the plain-text extract)
WIKI_SKIP = {"References", "External links", "Notes", "Bibliography", "Further reading", "Sources",
             "Citations", "Footnotes", "Notes and references", "See also"}

# SIMBAD measurement tables copied whole into simbad.measurements
MES_TABLES = ["mesDiameter", "mesDistance", "mesFe_h", "mesHerschel", "mesISO", "mesIUE", "mesOtype",
              "mesPLX", "mesPM", "mesRot", "mesSpT", "mesVar", "mesVelocities", "mesXmm"]
# ICRS -> galactic rotation (Hipparcos, ESA 1997)
GAL_MATRIX = ((-0.0548755604162154, -0.8734370902348850, -0.4838350155487132),
              (0.4941094278755837, -0.4448296299600112, 0.7469822444972189),
              (-0.8676661490190047, -0.1980763734312015, 0.4559837761750669))
JD_B1875 = 2405889.258550475
JD_J2000 = 2451545.0

# Wikidata properties worth showing, by label used in object.json
WD_PROPS = {
    "P215": "spectral class", "P59": "constellation", "P1215": "apparent magnitude",
    "P1457": "absolute magnitude", "P2583": "distance from Earth", "P2067": "mass",
    "P2120": "radius", "P2386": "diameter", "P2060": "luminosity",
    "P6879": "effective temperature", "P7584": "age", "P2227": "metallicity",
    "P7015": "surface gravity", "P2054": "density", "P2147": "rotation period",
    "P2146": "orbital period", "P2233": "semi-major axis", "P1096": "orbital eccentricity",
    "P2045": "orbital inclination", "P2216": "radial velocity", "P2214": "parallax",
    "P2046": "area", "P1813": "short name", "P397": "parent astronomical body",
    "P398": "child astronomical body", "P61": "discoverer or inventor",
    "P575": "time of discovery", "P138": "named after", "P31": "instance of",
    "P2076": "temperature", "P4501": "albedo", "P2052": "speed",
    "P6257": "right ascension", "P6258": "declination",
}
UNIT_LABELS = {"megaannum": "Myr", "gigaannum": "Gyr", "annum": "yr", "yottagram": "Yg",
               "kilogram": "kg",
               "square degree": "deg²", "kilometre": "km", "kilogram": "kg", "metre": "m",
               "kelvin": "K", "degree": "°", "day": "d", "hour": "h", "light-year": "ly",
               "parsec": "pc", "astronomical unit": "AU", "kilometre per second": "km/s",
               "metre per second squared": "m/s²", "gram per cubic centimetre": "g/cm³"}
SOLAR = {"Q180892": "M☉", "Q48440": "R☉", "Q843877": "L☉", "Q651336": "M♃",
         "Q3421309": "R♃", "Q11579": "K", "Q531": "ly", "Q12129": "pc", "Q828224": "km",
         "Q11573": "m", "Q577": "yr", "Q1092296": "yr", "Q573": "d", "Q7727": "min",
         "Q25235": "h", "Q11574": "s", "Q1811": "AU", "Q28390": "°", "Q1022113": "cm³",
         "Q13147228": "g/cm³", "Q3332822": "km/s", "Q21500224": "mas", "Q22137107": "mas/yr",
         "Q11570": "kg", "Q35852": "ha", "Q712226": "km²", "Q1428": "deg²",
         "Q39369": "Hz", "Q44395": "Pa", "Q131255": "MJ", "Q177974": "atm",
         "Q20966455": "dex", "Q216880": "Ga", "Q3013059": "Myr"}


# ---------- helpers ----------

_hosts, _hosts_lock = {}, threading.Lock()


@contextlib.contextmanager
def polite(url):
    """Space request starts to one host and cap how many run at once, across worker threads."""
    host = urlparse(url).netloc
    gap, slots = HOST_LIMITS.get(host, (PAUSE, PER_HOST))
    with _hosts_lock:
        st = _hosts.setdefault(host, {"next": 0.0, "lock": threading.Lock(),
                                      "sem": threading.Semaphore(slots)})
    with st["sem"]:
        with st["lock"]:
            wait = st["next"] - time.monotonic()
            st["next"] = max(st["next"], time.monotonic()) + gap
        if wait > 0:
            time.sleep(wait)
        yield


def request(method, url, **kw):
    kw.setdefault("timeout", 40)
    kw["headers"] = {**UA, **kw.pop("headers", {})}
    why = None
    for attempt in range(5):
        try:
            with polite(url):
                r = requests.request(method, url, **kw)
            if r.status_code in (429, 503):
                why = f"HTTP {r.status_code}"
                after = r.headers.get("retry-after", "")
                time.sleep(min(int(after), 60) if after.isdigit() else 5 * (attempt + 1))
                continue
            return r
        except requests.RequestException as exc:
            why = type(exc).__name__
            time.sleep(2 * (attempt + 1))
    print(f"  request failed ({why}): {urlparse(url).netloc}{urlparse(url).path}", flush=True)
    return None


def get(url, **kw):
    return request("GET", url, **kw)


def tap(query, url=SIMBAD_TAP):
    """Run an ADQL query; rows as dicts, [] on failure."""
    for attempt in range(2):
        r = request("POST", url, timeout=120, data={
            "request": "doQuery", "lang": "adql", "format": "json", "MAXREC": 2000000, "query": query})
        try:
            j = r.json()
            cols = [m["name"] for m in j.get("metadata", [])]
            return [dict(zip(cols, row)) for row in j.get("data", [])]
        except (AttributeError, ValueError):
            time.sleep(3)
    print(f"  TAP query failed: {' '.join(query.split())[:120]}", flush=True)
    return []


def esc(s):
    return s.replace("'", "''")


def slugify(name):
    out = []
    for ch in name:
        if ch in GREEK:
            out.append(GREEK[ch][1])
        else:
            out.append(ch.translate(SUPER))
    s = unicodedata.normalize("NFKD", "".join(out)).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def category_for(app_type):
    for pattern, cat in CATEGORY_RULES:
        if re.search(pattern, app_type, re.I):
            return cat
    return "other"


def simbad_style(name):
    """'τ² Hya' -> 'tau02 Hya'; other names unchanged."""
    m = re.fullmatch(r"([α-ω])([⁰¹²³⁴⁵⁶⁷⁸⁹]*) (\w+)", name)
    if not m:
        return name
    abbr = GREEK[m.group(1)][0]
    num = m.group(2).translate(SUPER)
    return f"{abbr}{int(num):02d} {m.group(3)}" if num else f"{abbr} {m.group(3)}"


def clean_id(simbad_id):
    """'*  27 Hya' -> '27 Hya', 'NAME Ori Trapezium' -> 'Ori Trapezium', 'V* R Leo' -> 'R Leo'."""
    return re.sub(r"\s+", " ", re.sub(r"^(NAME|\*|V\*|\*\*|PM\*|Em\*)\s+", "", simbad_id)).strip()


def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def write_json(path, data, indent=2):
    path.write_text(json.dumps(data, indent=indent, ensure_ascii=False))


def js_json(data):
    """JSON safe to embed in a .js file."""
    return json.dumps(data, ensure_ascii=False).replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")


def unit_vector(ra, dec):
    ra, dec = math.radians(ra), math.radians(dec)
    return (math.cos(dec) * math.cos(ra), math.cos(dec) * math.sin(ra), math.sin(dec))


def galactic(ra, dec):
    """ICRS degrees -> galactic (l, b) degrees."""
    v = unit_vector(ra, dec)
    x, y, z = (sum(GAL_MATRIX[i][j] * v[j] for j in range(3)) for i in range(3))
    return round(math.degrees(math.atan2(y, x)) % 360, 5), round(math.degrees(math.asin(max(-1, min(1, z)))), 5)


def sexagesimal(value, hours=False):
    """101.287 -> '06 45 08.917' (hours) or -16.716 -> '-16 42 58.02'."""
    v = value / 15 if hours else value
    sign = "-" if v < 0 else ("" if hours else "+")
    total = round(abs(v) * 3600, 3 if hours else 2)
    d, m = int(total // 3600), int(total % 3600 // 60)
    s = total - d * 3600 - m * 60
    return f"{sign}{d:02d} {m:02d} {s:0{6 if hours else 5}.{3 if hours else 2}f}"


# ---------- SIMBAD ----------

def sesame(name):
    r = get(SESAME + requests.utils.quote(name))
    if r is None:
        return None
    m = re.search(r"<oname>([^<]+)</oname>", r.text)
    return m.group(1) if m else None


def strip_columns(row, drop=("oidref", "mespos", "hpx", "otype_txt")):
    """Drop internal ids and *_prec digit counts from a SIMBAD row."""
    return {k: v for k, v in row.items() if k not in drop and not k.endswith("_prec")}


def subset(rows, keys):
    return [{k: r.get(k) for k in keys} for r in rows]


def simbad_record(main_id):
    rows = tap(f"""SELECT b.*, d.description AS otype_desc
        FROM basic b LEFT JOIN otypedef d ON b.otype = d.otype
        WHERE b.main_id = '{esc(main_id)}'""")
    if not rows:
        return None
    rec = strip_columns(rows[0])
    oid = rec["oid"]
    rec["identifiers"] = [i["id"] for i in tap(f"SELECT id FROM ident WHERE oidref = {oid}")]
    rec["fluxes"] = {f["filter"]: {"mag": f["flux"], "err": f["flux_err"]}
                     for f in tap(f"SELECT filter, flux, flux_err FROM flux WHERE oidref = {oid}")}
    if rec.get("ra") is not None:
        rec["coordinates"] = simbad_coordinates(rec)
    rec["hierarchy"] = simbad_hierarchy(oid)
    mes = {}
    for table in MES_TABLES:
        got = [strip_columns(r) for r in tap(f"SELECT * FROM {table} WHERE oidref = {oid}")]
        if got:
            mes[table] = got
    rec["measurements"] = mes
    feh = subset(mes.get("mesFe_h", []), ("teff", "log_g", "fe_h", "bibcode"))
    rec["atmosphere_measurements"] = feh
    teffs = sorted(x["teff"] for x in feh if x["teff"])
    rec["teff_median"] = teffs[len(teffs) // 2] if teffs else None
    rec["vsini_measurements"] = subset(mes.get("mesRot", []), ("vsini", "vsini_err", "bibcode"))
    rec["distance_measurements"] = subset(mes.get("mesDistance", []),
                                          ("dist", "unit", "plus_err", "minus_err", "method", "bibcode"))
    rec["types"] = [t["otype"] for t in tap(f"SELECT otype FROM otypes WHERE oidref = {oid}")]
    notes = simbad_notes(main_id)
    if notes:
        rec["notes"] = notes
    rec["url"] = "https://simbad.cds.unistra.fr/simbad/sim-id?Ident=" + requests.utils.quote(main_id)
    return rec


def simbad_coordinates(rec):
    ra, dec = rec["ra"], rec["dec"]
    gl, gb = galactic(ra, dec)
    return {"frame": "ICRS", "epoch": "J2000", "ra_deg": ra, "dec_deg": dec,
            "ra_hms": sexagesimal(ra, hours=True), "dec_dms": sexagesimal(dec),
            "gal_l": gl, "gal_b": gb,
            "err_maj_mas": rec.get("coo_err_maj"), "err_min_mas": rec.get("coo_err_min"),
            "err_angle_deg": rec.get("coo_err_angle"), "quality": rec.get("coo_qual"),
            "wavelength": rec.get("coo_wavelength"), "bibcode": rec.get("coo_bibcode")}


def simbad_hierarchy(oid, cap=500):
    """Parents and children from h_link, e.g. a star's cluster or its components."""
    cols = "b.main_id, b.otype, d.description AS otype_desc, h.membership, h.link_bibcode AS bibcode"
    parents = tap(f"""SELECT {cols} FROM h_link h JOIN basic b ON b.oid = h.parent
        LEFT JOIN otypedef d ON d.otype = b.otype WHERE h.child = {oid}""")
    children = tap(f"""SELECT TOP {cap} {cols} FROM h_link h JOIN basic b ON b.oid = h.child
        LEFT JOIN otypedef d ON d.otype = b.otype WHERE h.parent = {oid}""")
    out = {"parents": parents, "children": children}
    if len(children) == cap:
        n = tap(f"SELECT COUNT(*) AS n FROM h_link WHERE parent = {oid}")
        out["children_total"] = n[0]["n"] if n else None
    return out


def simbad_notes(main_id):
    """Notes from the SIMBAD object page (not in TAP), as [{date, text}]."""
    r = get(SIMBAD_ID, params={"Ident": main_id, "output.format": "ASCII", "obj.notesel": "on",
                               "obj.bibsel": "off", "obj.messel": "off"})
    if r is None or r.status_code != 200:
        return []
    m = re.search(r"^Notes \((\d+)\) :\n(.*?)^={10,}", r.text, re.S | re.M)
    if not m or m.group(1) == "0":
        return []
    notes = []
    for line in m.group(2).splitlines():
        head = re.match(r"\(\w\)\s+(\S+)", line)
        if head:
            notes.append({"date": head.group(1), "text": ""})
        elif notes and line.strip():
            notes[-1]["text"] += " " + line.strip()
    for n in notes:
        n["text"] = re.sub(r"\\\w+((?:\{[^}]*\})+)",
                           lambda g: re.findall(r"\{([^}]*)\}", g.group(1))[-1], n["text"]).strip()
    return notes


def simbad_papers(oid):
    """Every reference for the object (has_ref joined to ref), first 10 authors each, newest first."""
    refs, last = [], -1
    while True:
        page = tap(f"""SELECT TOP {TAP_PAGE} r.oidbib, r.bibcode, r.title, r."year", r.journal, r.volume,
            r.page, r.last_page, r.doi FROM has_ref h JOIN ref r ON h.oidbibref = r.oidbib
            WHERE h.oidref = {oid} AND r.oidbib > {last} ORDER BY oidbib""")
        refs += page
        if len(page) < TAP_PAGE:
            break
        last = page[-1]["oidbib"]
    authors, last = {}, -1
    while True:
        page = tap(f"""SELECT TOP {TAP_PAGE} a.oidbibref AS bib, a.pos, a.name FROM has_ref h
            JOIN author a ON a.oidbibref = h.oidbibref
            WHERE h.oidref = {oid} AND a.pos <= 11 AND a.oidbibref > {last} ORDER BY bib""")
        full = len(page) == TAP_PAGE
        if full:   # the last paper may be cut off; fetch it again with the next page
            last = page[-1]["bib"] - 1
            page = [a for a in page if a["bib"] <= last]
            if not page:
                break
        for a in page:
            authors.setdefault(a["bib"], []).append((a["pos"], a["name"]))
        if not full:
            break
    out = []
    for r in refs:
        names = [n.strip() for _, n in sorted(authors.get(r["oidbib"], []))]
        p = {k: r.get(k) for k in ("bibcode", "title", "year", "journal", "volume", "page", "last_page", "doi")}
        p["bibcode"] = (p["bibcode"] or "").strip()
        p["authors"] = names[:10]
        if len(names) > 10:
            p["et_al"] = True
        out.append({k: v for k, v in p.items() if v not in (None, "")})
    out.sort(key=lambda p: (p.get("year") or 0, p["bibcode"]), reverse=True)
    return out


# ---------- Wikipedia / Wikidata ----------

def wiki_summary(title):
    r = get(WIKI_REST + requests.utils.quote(title.replace(" ", "_")))
    if r is None or r.status_code != 200:
        return None
    s = r.json()
    if s.get("type") == "disambiguation":
        return None
    return s


def wiki_extract(title, intro=False):
    """Plain-text extract of an article (lead only with intro=True); retried, since it comes back empty at times."""
    params = {"action": "query", "prop": "extracts", "explaintext": 1, "redirects": 1,
              "titles": title, "format": "json"}
    params.update({"exintro": 1} if intro else {"exsectionformat": "wiki"})
    for attempt in range(3):
        r = get(WIKI_API, params=params)
        try:
            pages = r.json().get("query", {}).get("pages", {})
            text = next(iter(pages.values()), {}).get("extract")
        except (AttributeError, ValueError):
            text = None
        if text:
            return text
        time.sleep(3 * (attempt + 1))
    print(f"  empty Wikipedia extract: {title}", flush=True)
    return None


def wiki_intro(title):
    return wiki_extract(title, intro=True)


def wiki_titles_from_ids(name, identifiers):
    """Likely Wikipedia titles for a star, from its proper name and SIMBAD identifiers."""
    titles = []
    if not re.match(r"^(HD|HIP|TYC|SAO|BD|\d)", name, re.I) and not re.match(r"^[α-ω]", name):
        titles.append(name)
    for i in identifiers:
        i = re.sub(r"\s+", " ", i)
        if i.startswith("NAME "):
            titles.append(i[5:])
        m = re.fullmatch(r"\* ([a-z]{2,3})(\d*) (\w+)", i)
        if m and m.group(1) in GREEK_FROM_ABBR and m.group(3) in GENITIVE:
            num = str(int(m.group(2))) if m.group(2) else ""
            titles.append(f"{GREEK_FROM_ABBR[m.group(1)].title()}{num} {GENITIVE[m.group(3)]}")
        m = re.fullmatch(r"\* (\d+) (\w+)", i)
        if m and m.group(2) in GENITIVE:
            titles.append(f"{m.group(1)} {GENITIVE[m.group(2)]}")
    titles += [re.sub(r"\s+", " ", i) for i in identifiers if re.match(r"^HD \d+$", re.sub(r"\s+", " ", i))]
    return list(dict.fromkeys(titles))


def first_star_article(titles):
    for t in titles:
        s = wiki_summary(t)
        text = ((s or {}).get("extract", "") + " " + (s or {}).get("description", "")).lower()
        if s and s.get("type") == "standard" and ("star" in text or "constellation" in text):
            return s["title"]
    return None


def wikidata_by_simbad(main_id):
    variants = {main_id, re.sub(r"\s+", " ", main_id)}
    values = " ".join(f'"{esc(v)}"' for v in variants)
    q = f"""SELECT ?item ?article WHERE {{
      VALUES ?id {{ {values} }} ?item wdt:P3083 ?id .
      OPTIONAL {{ ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> . }}
    }} LIMIT 1"""
    r = get(WIKIDATA_SPARQL, params={"query": q, "format": "json"})
    if r is None or r.status_code != 200:
        return None, None
    b = r.json()["results"]["bindings"]
    if not b:
        return None, None
    qid = b[0]["item"]["value"].rsplit("/", 1)[1]
    title = b[0].get("article", {}).get("value")
    title = requests.utils.unquote(title.rsplit("/", 1)[1]).replace("_", " ") if title else None
    return qid, title


def wikidata_entity(qid):
    r = get(f"https://www.wikidata.org/wiki/Special:EntityData/{qid}.json")
    if r is None or r.status_code != 200:
        return None
    return r.json()["entities"].get(qid)


_labels, _labels_lock = {}, threading.Lock()


def wikidata_labels(qids):
    """English labels for items or properties, cached across objects."""
    qids = sorted(set(qids))
    with _labels_lock:
        todo = [q for q in qids if q not in _labels]
    for i in range(0, len(todo), 50):
        r = get(WIKIDATA_API, params={"action": "wbgetentities", "ids": "|".join(todo[i:i + 50]),
                                      "props": "labels", "languages": "en|mul", "format": "json"})
        if r is None:
            continue
        try:
            entities = r.json().get("entities", {})
        except ValueError:
            continue
        with _labels_lock:
            for q, e in entities.items():
                lab = e.get("labels", {})
                _labels[q] = (lab.get("en") or lab.get("mul") or {}).get("value", q)
    with _labels_lock:
        return {q: _labels[q] for q in qids if q in _labels}


_formatters = {}


def wikidata_formatters(pids):
    """Formatter URLs (P1630) for external-id properties, cached across objects."""
    todo = sorted(set(pids) - set(_formatters))
    for i in range(0, len(todo), 100):
        values = " ".join(f"wd:{p}" for p in todo[i:i + 100])
        r = get(WIKIDATA_SPARQL, params={"format": "json", "query":
                f"SELECT ?p ?f WHERE {{ VALUES ?p {{ {values} }} ?p wdt:P1630 ?f . }}"})
        for p in todo[i:i + 100]:
            _formatters.setdefault(p, None)
        if r is None or r.status_code != 200:
            continue
        for b in r.json()["results"]["bindings"]:
            pid = b["p"]["value"].rsplit("/", 1)[1]
            if not _formatters.get(pid):
                _formatters[pid] = b["f"]["value"]
    return {p: _formatters.get(p) for p in pids}


def wd_time(v):
    """Wikidata time value -> '1862-01-31', '1862-01' or '1862' by its precision."""
    neg = v["time"].startswith("-")
    y, m, d = v["time"].lstrip("+-").split("T")[0].split("-")
    y, prec = y.lstrip("0") or "0", v.get("precision", 11)
    out = y if prec <= 9 else f"{y}-{m}" if prec == 10 else f"{y}-{m}-{d}"
    return ("-" if neg else "") + out


def wd_entry(snak, item_ids):
    """One claim value as {"value", "unit"?, "plus"?, "minus"?, "type"}; item ids collected for labelling."""
    dv = snak.get("datavalue")
    if not dv:
        return None
    v, t = dv["value"], dv["type"]
    if t == "quantity":
        unit = v["unit"].rsplit("/", 1)[-1] if v["unit"] != "1" else ""
        if unit and unit not in SOLAR:
            item_ids.append(unit)
        entry = {"value": float(v["amount"]), "unit": unit}
        if "upperBound" in v:
            entry["plus"] = float(v["upperBound"]) - float(v["amount"])
            entry["minus"] = float(v["amount"]) - float(v["lowerBound"])
    elif t == "wikibase-entityid":
        qid = v.get("id") or f"Q{v.get('numeric-id')}"
        item_ids.append(qid)
        entry = {"value": qid, "qid": qid}
    elif t == "time":
        entry = {"value": wd_time(v)}
    elif t == "monolingualtext":
        entry = {"value": v["text"]}
    elif t == "string":
        entry = {"value": v}
    elif t == "globecoordinate":
        entry = {"value": f"{v['latitude']:.4f}, {v['longitude']:.4f}"}
    else:
        entry = {"value": json.dumps(v, ensure_ascii=False)}
    entry["type"] = snak.get("datatype") or t
    return entry


def wd_finish(groups, labels):
    """Label units and items in place; yottagrams become kg."""
    for vals in groups.values():
        for e in vals:
            if "unit" in e:
                u = SOLAR.get(e["unit"], labels.get(e["unit"], e["unit"]))
                e["unit"] = UNIT_LABELS.get(u, u)
                if e["unit"] == "Yg":   # yottagrams -> kg, so planet masses read normally
                    e["unit"] = "kg"
                    for k in ("value", "plus", "minus"):
                        if k in e:
                            e[k] *= 1e21
            elif isinstance(e["value"], str) and re.fullmatch(r"Q\d+", e["value"]):
                e["value"] = labels.get(e["value"], e["value"])


def wikidata_facts(entity):
    """Selected claims as {label: [{"value", "unit"...}]}, preferred rank first."""
    claims = entity.get("claims", {})
    raw, item_ids = {}, []
    for pid, label in WD_PROPS.items():
        vals = []
        for c in claims.get(pid, []):
            entry = wd_entry(c["mainsnak"], item_ids)
            if not entry or entry["type"] not in ("quantity", "wikibase-item", "time", "string",
                                                  "monolingualtext", "external-id"):
                continue
            entry["rank"] = c.get("rank")
            vals.append(entry)
        if vals:
            vals.sort(key=lambda e: e["rank"] != "preferred")
            raw[label] = vals
    labels = wikidata_labels(item_ids) if item_ids else {}
    wd_finish(raw, labels)
    for vals in raw.values():
        for e in vals:
            for k in ("rank", "type", "qid"):
                e.pop(k, None)
    image = claims.get("P18", [{}])[0].get("mainsnak", {}).get("datavalue", {}).get("value")
    return raw, image


def wikidata_all_claims(entity):
    """Every claim keyed by property label, deprecated values dropped, preferred first.
    Returns (claims, property ids by label)."""
    claims = entity.get("claims", {})
    raw, item_ids = {}, []
    for pid, cs in claims.items():
        vals = []
        for c in cs:
            if c.get("rank") == "deprecated":
                continue
            entry = wd_entry(c["mainsnak"], item_ids)
            if entry:
                entry["preferred"] = c.get("rank") == "preferred"
                vals.append(entry)
        if vals:
            vals.sort(key=lambda e: not e["preferred"])
            raw[pid] = vals
    labels = wikidata_labels(item_ids + list(raw))
    wd_finish(raw, labels)
    ext = [p for p, vals in raw.items() if vals[0]["type"] == "external-id"]
    fmts = wikidata_formatters(ext) if ext else {}
    out, pids = {}, {}
    for pid in sorted(raw, key=lambda p: int(p[1:])):
        for e in raw[pid]:
            e.pop("preferred")
            if e["type"] == "external-id" and fmts.get(pid):
                e["url"] = fmts[pid].replace("$1", requests.utils.quote(str(e["value"]), safe=":/"))
            if e["type"] == "commonsMedia":
                e["url"] = "https://commons.wikimedia.org/wiki/File:" + str(e["value"]).replace(" ", "_")
        label = labels.get(pid, pid)
        if label in out:
            label = f"{label} ({pid})"
        out[label] = raw[pid]
        pids[label] = pid
    return out, pids


def wikipedia_block(title):
    s = wiki_summary(title)
    if not s:
        return None
    return {
        "title": s.get("title"),
        "description": s.get("description"),
        "summary": s.get("extract"),
        "intro": wiki_intro(s.get("title")),
        "url": s.get("content_urls", {}).get("desktop", {}).get("page"),
        "thumbnail": (s.get("thumbnail") or {}).get("source"),
        "image": (s.get("originalimage") or {}).get("source"),
        "wikidata": s.get("wikibase_item"),
    }


def wiki_sections(title):
    """Whole article as plain text, split into [{title, level, text}]; the lead is level 1."""
    text = wiki_extract(title)
    if not text:
        return []
    sections = [{"title": "Introduction", "level": 1, "text": ""}]
    for line in text.split("\n"):
        m = re.fullmatch(r"(={2,6})\s*(.*?)\s*\1\s*", line)
        if m:
            sections.append({"title": m.group(2), "level": len(m.group(1)), "text": ""})
        else:
            sections[-1]["text"] += line + "\n"
    for s in sections:
        s["text"] = re.sub(r"\n{3,}", "\n\n", s["text"]).strip()
    return [s for s in sections if s["text"] or s["title"] not in WIKI_SKIP]


def wiki_images(title, cap=12):
    """Up to `cap` article images: file title, thumbnail URL, caption."""
    r = get(WIKI_MEDIA + requests.utils.quote(title.replace(" ", "_"), safe=""))
    if r is None or r.status_code != 200:
        return []
    out = []
    for it in r.json().get("items", []):
        if it.get("type") != "image" or it.get("showInGallery") is False or not it.get("srcset"):
            continue
        src = it["srcset"][0]["src"].split("?")[0]
        out.append({"title": it["title"], "thumbnail": ("https:" + src) if src.startswith("//") else src,
                    "caption": ((it.get("caption") or {}).get("text") or "").strip() or None,
                    "url": "https://en.wikipedia.org/wiki/" + requests.utils.quote(it["title"])})
        if len(out) >= cap:
            break
    return out


def wiki_article(title):
    return {"title": title, "url": "https://en.wikipedia.org/wiki/" + requests.utils.quote(title.replace(" ", "_")),
            "sections": wiki_sections(title), "images": wiki_images(title), "retrieved": now_iso()}


# ---------- Horizons / CelesTrak ----------

def horizons(command, obs_times_utc, site):
    params = {"format": "json", "COMMAND": f"'{command}'", "OBJ_DATA": "YES",
              "MAKE_EPHEM": "YES" if obs_times_utc else "NO", "EPHEM_TYPE": "OBSERVER",
              "CENTER": "'coord@399'", "COORD_TYPE": "GEODETIC",
              "SITE_COORD": f"'{site['lon']},{site['lat']},{site['elev_m'] / 1000}'",
              "TIME_TYPE": "UT", "QUANTITIES": "'1,4,9,10,13,20,23,24'",
              "CSV_FORMAT": "YES", "ANG_FORMAT": "DEG"}
    if obs_times_utc:
        params["TLIST"] = "'" + " ".join(f"{julian_date(t):.6f}" for t in obs_times_utc) + "'"
        params["TLIST_TYPE"] = "JD"
    r = get(HORIZONS, params=params, timeout=60)
    if r is None or r.status_code != 200:
        return None
    text = r.json().get("result", "")
    header = text.split("$$SOE")[0]
    phys = re.search(r"(PHYSICAL (?:DATA|PROPERTIES).*?)(?:\n\s*\n\s*Perihelion|\n\*{10,})", header, re.S)
    ephem = []
    if "$$SOE" in text:
        cols_line = header.strip().splitlines()[-2]
        cols = [c.strip() for c in cols_line.split(",")]
        for line in text.split("$$SOE")[1].split("$$EOE")[0].strip().splitlines():
            vals = [v.strip() for v in line.split(",")]
            ephem.append(dict(zip(cols, vals)))
    return {"physical_data": phys.group(1).strip() if phys else None,
            "ephemeris": ephem,
            "url": "https://ssd.jpl.nasa.gov/horizons/app.html"}


def celestrak(name):
    out = {}
    r = get(CELESTRAK_GP, params={"NAME": name, "FORMAT": "json"})
    if r is not None and r.status_code == 200:
        try:
            gp = [g for g in r.json() if g.get("OBJECT_NAME") == name] or r.json()
            out["orbit"] = gp[0] if gp else None
        except ValueError:
            pass
    catnr = (out.get("orbit") or {}).get("NORAD_CAT_ID")
    if catnr:
        r = get(CELESTRAK_SATCAT, params={"CATNR": catnr, "FORMAT": "json"})
        if r is not None and r.status_code == 200:
            try:
                out["catalog"] = (r.json() or [None])[0]
            except ValueError:
                pass
        out["url"] = f"https://celestrak.org/satcat/table-satcat.php?CATNR={catnr}"
    return out or None


# ---------- sky position at observation time ----------

def julian_date(dt_utc):
    return dt_utc.timestamp() / 86400.0 + 2440587.5


def alt_az(ra_deg, dec_deg, dt_utc, lat, lon):
    jd = julian_date(dt_utc)
    gmst = (280.46061837 + 360.98564736629 * (jd - 2451545.0)) % 360
    ha = math.radians((gmst + lon - ra_deg) % 360)
    phi, dec = math.radians(lat), math.radians(dec_deg)
    alt = math.asin(math.sin(phi) * math.sin(dec) + math.cos(phi) * math.cos(dec) * math.cos(ha))
    az = math.atan2(-math.sin(ha) * math.cos(dec),
                    math.cos(phi) * math.sin(dec) - math.sin(phi) * math.cos(dec) * math.cos(ha))
    return round(math.degrees(alt), 1), round(math.degrees(az) % 360, 1)


def load_locations():
    path = DATA / "locations.json"
    return json.loads(path.read_text()) if path.exists() else {}


def locate(place, locations):
    if place in locations or not place:
        return locations.get(place)
    r = get(NOMINATIM, params={"q": place, "format": "json", "limit": 1}, timeout=30)  # 1/s via HOST_LIMITS
    if r is None or not r.json():
        return None
    hit = r.json()[0]
    locations[place] = {"lat": float(hit["lat"]), "lon": float(hit["lon"]), "elev_m": 0,
                        "tz": "America/Chicago", "note": "geocoded by Nominatim; check tz and elevation"}
    (DATA / "locations.json").write_text(json.dumps(locations, indent=2, ensure_ascii=False))
    return locations[place]


def constellation_geometry(abbr):
    """Centre and radius of a constellation from the IAU boundaries (VizieR VI/49)."""
    rows = tap(f"SELECT RAJ2000, DEJ2000 FROM \"VI/49/bound_20\" WHERE cst = '{abbr.upper():<4}'", VIZIER_TAP)
    if not rows:
        return None
    vs = [unit_vector(p["RAJ2000"], p["DEJ2000"]) for p in rows]
    x, y, z = (sum(v[i] for v in vs) for i in range(3))
    n = math.sqrt(x * x + y * y + z * z)
    x, y, z = x / n, y / n, z / n
    radius = max(math.degrees(math.acos(max(-1, min(1, v[0] * x + v[1] * y + v[2] * z)))) for v in vs)
    return {"ra_deg": round(math.degrees(math.atan2(y, x)) % 360, 3),
            "dec_deg": round(math.degrees(math.asin(z)), 3), "radius_deg": round(radius, 1),
            "source": "IAU boundaries, VizieR VI/49"}


_SKY = None


def constellation_at(ra, dec):
    """Full name of the IAU constellation containing a J2000 position, from data/sky/boundaries.json.

    A ray runs north along the point's RA; an odd number of boundary crossings means the point
    and the north celestial pole are on opposite sides of that boundary."""
    global _SKY
    if _SKY is None:
        try:
            _SKY = json.loads((DATA / "sky" / "boundaries.json").read_text())
        except (OSError, ValueError):
            _SKY = {}
    wrap = lambda a: (a + 180) % 360 - 180
    for abbr, rings in (_SKY.get("boundaries") or {}).items():
        rings = rings if isinstance(rings[0][0], list) else [rings]
        for ring in rings:
            crossings, winding = 0, 0.0
            for (a1, d1), (a2, d2) in zip(ring, ring[1:]):
                da = wrap(a2 - a1)
                winding += da
                if da == 0:
                    continue
                t = wrap(ra - a1) / da
                if 0 <= t < 1 and d1 + t * (d2 - d1) > dec:
                    crossings += 1
            holds_pole = abs(winding) > 180 and sum(d for _, d in ring) > 0
            if (crossings % 2 == 1) != holds_pole:
                return _SKY["names"].get(abbr, abbr)
    return None


# ---------- constellation boundaries for the sky map ----------

def precess(ra, dec, jd0=JD_B1875, jd1=JD_J2000):
    """Rigorous IAU 1976 precession (Meeus 21.4), degrees in and out."""
    T, t = (jd0 - JD_J2000) / 36525, (jd1 - jd0) / 36525
    asec = lambda x: math.radians(x / 3600)
    zeta = asec((2306.2181 + 1.39656 * T - 0.000139 * T * T) * t + (0.30188 - 0.000344 * T) * t * t + 0.017998 * t ** 3)
    z = asec((2306.2181 + 1.39656 * T - 0.000139 * T * T) * t + (1.09468 + 0.000066 * T) * t * t + 0.018203 * t ** 3)
    theta = asec((2004.3109 - 0.85330 * T - 0.000217 * T * T) * t - (0.42665 + 0.000217 * T) * t * t - 0.041833 * t ** 3)
    a, d = math.radians(ra), math.radians(dec)
    A = math.cos(d) * math.sin(a + zeta)
    B = math.cos(theta) * math.cos(d) * math.cos(a + zeta) - math.sin(theta) * math.sin(d)
    C = math.sin(theta) * math.cos(d) * math.cos(a + zeta) + math.cos(theta) * math.sin(d)
    return math.degrees(math.atan2(A, B) + z) % 360, math.degrees(math.asin(max(-1, min(1, C))))


def ring_area(ring):
    """Spherical area of a closed [lon, lat] ring as d3.geoArea measures it (interior on the clockwise side)."""
    total = 0.0
    lam0, phi0 = math.radians(ring[0][0]), math.radians(ring[0][1]) / 2 + math.pi / 4
    cos0, sin0 = math.cos(phi0), math.sin(phi0)
    for lon, lat in ring[1:]:
        lam, phi = math.radians(lon), math.radians(lat) / 2 + math.pi / 4
        dl = lam - lam0
        sd = 1 if dl >= 0 else -1
        c, s = math.cos(phi), math.sin(phi)
        k = sin0 * s
        total += math.atan2(k * sd * math.sin(sd * dl), cos0 * c + k * math.cos(sd * dl))
        lam0, cos0, sin0 = lam, c, s
    area = 2 * total
    return area + 4 * math.pi if area < 0 else area


def boundary_ring(vertices, step=1.0):
    """B1875 vertices (edges along constant RA or Dec) -> J2000 ring with points every `step` degrees."""
    pts = []
    for (ra0, de0), (ra1, de1) in zip(vertices, vertices[1:]):
        dra = (ra1 - ra0 + 180) % 360 - 180
        n = max(1, math.ceil(max(abs(dra) * math.cos(math.radians(de0)), abs(de1 - de0)) / step),
                math.ceil(abs(dra) / 5))
        for k in range(n):
            pts.append(precess((ra0 + dra * k / n) % 360, de0 + (de1 - de0) * k / n))
    pts.append(pts[0])
    ring = [[round(ra, 4), round(de, 4)] for ra, de in pts]
    return ring if ring_area(ring) < 2 * math.pi else ring[::-1]


def build_boundaries():
    """data/sky/boundaries.json and .js from VizieR VI/49 (B1875 vertices with adjacency, precessed to J2000)."""
    rows = tap('SELECT recno, RAB1875, DEB1875, cst, adj FROM "VI/49/constbnd" ORDER BY recno', VIZIER_TAP)
    if not rows:
        print("  constellation boundaries: VizieR query failed", flush=True)
        return
    polys = []
    for r in rows:
        if not (r["adj"] or "").strip():      # first vertex of a polygon has no neighbour
            polys.append((r["cst"].strip(), []))
        polys[-1][1].append((r["RAB1875"], r["DEB1875"]))
    canon = {k.upper(): k for k in CONSTELLATIONS}
    bounds = {}
    for abbr, verts in polys:      # 'Cra' -> 'CrA', 'Ser1'/'Ser2' -> 'Ser'
        bounds.setdefault(canon.get(abbr.rstrip("12").upper(), abbr), []).append(boundary_ring(verts))
    bounds = {k: v[0] if len(v) == 1 else v for k, v in sorted(bounds.items())}
    sky = {"boundaries": bounds, "names": {k: CONSTELLATIONS.get(k, k) for k in bounds},
           "source": "IAU constellation boundaries, VizieR VI/49 (Davenhall & Leggett 1989), "
                     "B1875 vertices precessed to J2000, edges sampled every 1 degree",
           "format": "[ra_deg, dec_deg] J2000, closed rings wound clockwise for d3-geo with lon = RA; "
                     "Ser is a list of two rings (Caput, Cauda)",
           "generated": now_iso()}
    folder = DATA / "sky"
    folder.mkdir(exist_ok=True)
    write_json(folder / "boundaries.json", sky, indent=None)
    (folder / "boundaries.js").write_text("window.MO_SKY = " + js_json(sky) + ";\n")
    print(f"{len(bounds)} constellations -> data/sky/boundaries.json", flush=True)


# ---------- images ----------

def download(url, dest, params=None):
    r = get(url, params=params, timeout=60)
    if r is not None and r.status_code == 200 and r.headers.get("content-type", "").startswith("image"):
        dest.write_bytes(r.content)
        return dest.name
    return None


def brighten(path):
    """Stretch a dark wide-field mosaic so the stars show."""
    from PIL import Image, ImageOps
    im = ImageOps.autocontrast(Image.open(path).convert("RGB"), cutoff=(0, 0.5))
    im = im.point(lambda v: int(255 * (v / 255) ** 0.6))
    im.save(path, quality=90)


def relabel(obj):
    """Resolve Wikidata ids left raw by a failed label lookup: item values, quantity units and
    all_claims property labels."""
    wd = obj.get("wikidata") or {}
    claims, pids = wd.get("all_claims", {}), wd.get("property_ids", {})
    groups = list(wd.get("facts", {}).values()) + list(claims.values())
    qid = lambda v: isinstance(v, str) and re.fullmatch(r"Q\d+", v)
    items = [e for vals in groups for e in vals
             if qid(e.get("value")) and "unit" not in e and e.get("type", "wikibase-item") == "wikibase-item"]
    units = [e for vals in groups for e in vals if qid(e.get("unit"))]
    raw_props = [k for k in claims if re.fullmatch(r"P\d+", k)]
    if not (items or units or raw_props):
        return
    labels = wikidata_labels([e["value"] for e in items] + [e["unit"] for e in units] + raw_props)
    for e in items:
        e["value"] = labels.get(e["value"], e["value"])
    wd_finish({"units": units}, labels)
    for pid in raw_props:
        label = labels.get(pid, pid)
        if label != pid:
            label = label if label not in claims else f"{label} ({pid})"
            claims[label] = claims.pop(pid)
            pids.pop(pid, None)
            pids[label] = pid
    if raw_props:
        wd["all_claims"] = {k: claims[k] for k in sorted(claims, key=lambda k: int(pids.get(k, "P0")[1:]))}


def star_fov(vmag):
    """Bright stars saturate the survey plates; widen the field so the surroundings show."""
    if vmag is None:
        return 0.4
    return 3.0 if vmag < 0.5 else 1.5 if vmag < 2 else 0.8 if vmag < 4 else 0.4


def sky_cutout(ra, dec, fov, dest):
    return download(HIPS2FITS, dest, params={
        "hips": "CDS/P/DSS2/color", "ra": ra, "dec": dec, "fov": fov,
        "width": 600, "height": 600, "projection": "TAN", "format": "jpg"})


# ---------- harvest one object ----------

def resolve_star(name):
    """Return (simbad main_id, wikidata qid, wikipedia title, method)."""
    name = ALIASES.get(name, name)
    for candidate in dict.fromkeys([simbad_style(name), name]):
        main = sesame(candidate)
        if main:
            qid, title = wikidata_by_simbad(main)
            return main, qid, title, f"sesame:{candidate}"
    s = wiki_summary(name)
    if s and s.get("wikibase_item"):
        e = wikidata_entity(s["wikibase_item"])
        ids = [c["mainsnak"].get("datavalue", {}).get("value")
               for c in (e or {}).get("claims", {}).get("P3083", [])]
        if ids and ids[0]:
            return ids[0], s["wikibase_item"], s["title"], "wikipedia-redirect"
        return None, s["wikibase_item"], s["title"], "wikipedia-only"
    return None, None, None, "unresolved"


def harvest(name, category, app_type, folder, obs_times_utc, site):
    obj = {"name": name, "category": category, "app_type": app_type,
           "harvested": now_iso(), "sources": [], "images": {}}
    simbad_id = qid = wiki_title = None

    if category in ("stars", "galaxies", "nebulae", "clusters", "other"):
        simbad_id, qid, wiki_title, method = resolve_star(name)
        obj["resolved"] = {"method": method}
    elif category == "constellations":
        wiki_title = f"{name} (constellation)"
        obj["resolved"] = {"method": "wikipedia"}
    elif category == "satellites":
        wiki_title = name if wiki_summary(name) else name.split("-")[0].title()
        obj["resolved"] = {"method": "celestrak"}
    else:
        wiki_title = name
        obj["resolved"] = {"method": "wikipedia"}

    if simbad_id:
        rec = simbad_record(simbad_id)
        if rec:
            obj["simbad"] = rec
            obj["sources"].append({"name": "SIMBAD (CDS)", "url": rec["url"], "retrieved": now_iso()})
            papers = simbad_papers(rec["oid"])
            write_json(folder / "papers.json", papers)
            obj["papers_count"] = len(papers)
            if not wiki_title:
                wiki_title = first_star_article(wiki_titles_from_ids(name, rec["identifiers"]))

    wp = wikipedia_block(wiki_title) if wiki_title else None
    if wp:
        obj["wikipedia"] = wp
        qid = qid or wp.get("wikidata")
        obj["sources"].append({"name": "Wikipedia", "url": wp["url"], "retrieved": now_iso()})
        article = wiki_article(wp["title"])
        obj["wikipedia"]["sections_count"] = len(article["sections"])
    else:
        article = {"sections": [], "images": []}
    write_json(folder / "article.json", article)
    if not obj.get("simbad"):
        write_json(folder / "papers.json", [])
    if qid:
        ent = wikidata_entity(qid)
        if ent:
            facts, commons_image = wikidata_facts(ent)
            claims, pids = wikidata_all_claims(ent)
            obj["wikidata"] = {"id": qid, "facts": facts, "all_claims": claims, "property_ids": pids,
                               "commons_image": commons_image,
                               "url": f"https://www.wikidata.org/wiki/{qid}"}
            obj["sources"].append({"name": "Wikidata", "url": obj["wikidata"]["url"], "retrieved": now_iso()})

    if category in ("planets", "moons") or name in HORIZONS_ID:
        hz = horizons(HORIZONS_ID.get(name, name), obs_times_utc, site)
        if hz:
            obj["horizons"] = hz
            obj["sources"].append({"name": "JPL Horizons", "url": hz["url"], "retrieved": now_iso()})

    if category == "satellites":
        ct = celestrak(name)
        if ct:
            obj["celestrak"] = ct
            obj["sources"].append({"name": "CelesTrak", "url": ct.get("url", CELESTRAK_GP), "retrieved": now_iso()})

    obj["resolved"].update({"simbad_id": simbad_id, "wikidata": qid,
                            "wikipedia": (wp or {}).get("title")})

    sb = obj.get("simbad") or {}
    if sb.get("ra") is not None:
        fov = 1.0 if category in ("clusters", "nebulae", "galaxies") else star_fov((sb.get("fluxes") or {}).get("V", {}).get("mag"))
        if sky_cutout(sb["ra"], sb["dec"], fov, folder / "sky.jpg"):
            obj["images"]["sky"] = {"file": "sky.jpg", "credit": "DSS2 colour via CDS hips2fits",
                                    "fov_deg": fov}
    facts = (obj.get("wikidata") or {}).get("facts", {})
    abbr = (facts.get("short name") or [{}])[0].get("value")
    geo = constellation_geometry(abbr) if category == "constellations" and abbr else None
    if geo:
        obj["geometry"] = geo
        fov = min(round(geo["radius_deg"] * 2.2), 120)
        if download(HIPS2FITS, folder / "sky.jpg", params={
                "hips": "CDS/P/Mellinger/color", "ra": geo["ra_deg"], "dec": geo["dec_deg"], "fov": fov,
                "width": 800, "height": 800, "projection": "STG", "format": "jpg"}):
            brighten(folder / "sky.jpg")
            obj["images"]["sky"] = {"file": "sky.jpg", "credit": "Mellinger colour mosaic via CDS hips2fits",
                                    "fov_deg": fov}
    if wp and wp.get("thumbnail"):
        big = re.sub(r"/\d+px-", "/640px-", wp["thumbnail"])
        got = download(big, folder / "photo.jpg") or download(wp["thumbnail"], folder / "photo.jpg")
        if got:
            obj["images"]["photo"] = {"file": "photo.jpg", "credit": "Wikipedia / Wikimedia Commons",
                                      "source": wp["thumbnail"]}

    obj["summary"] = summarise(obj)
    return obj


# ---------- summary ----------

def first(facts, key):
    v = (facts.get(key) or [None])[0]
    return v


def spectral_classes(sp):
    """'A0mA1Va' -> ('A', 'V'); 'M1-M2Ia-Iab' -> ('M', 'Ia'); 'K0III' -> ('K', 'III')."""
    m = re.match(r"\s*(?:sd|esd|usd|d|g|c|k)?([OBAFGKM])(.*)", sp or "")
    if not m:
        return None, None
    lum = re.search(r"(Ia0|Ia\+|Iab|Ia|Ib|III|II|IV|VI|V|I)(?![IV])", m.group(2))
    return m.group(1), lum.group(1) if lum else None


def summarise(obj):
    sb, facts = obj.get("simbad") or {}, (obj.get("wikidata") or {}).get("facts", {})
    s = {}
    if sb:
        s["designation"] = clean_id(sb["main_id"])
        s["object_type"] = sb.get("otype_desc")
        s["spectral_type"] = sb.get("sp_type")
        s["ra_deg"], s["dec_deg"] = sb.get("ra"), sb.get("dec")
        v = sb.get("fluxes", {}).get("V")
        s["v_mag"] = v["mag"] if v else None
        if sb.get("plx_value") and sb["plx_value"] > 0:
            pc = 1000 / sb["plx_value"]
            s["distance_pc"], s["distance_ly"] = round(pc, 1), round(pc * 3.26156, 1)
        s["teff_k"] = sb.get("teff_median")
        b = sb.get("fluxes", {}).get("B")
        if b and v:
            s["b_minus_v"] = round(b["mag"] - v["mag"], 2)
    for key, label in [("mass", "mass"), ("radius", "radius"), ("luminosity", "luminosity"),
                       ("age", "age"), ("constellation", "constellation"), ("area", "area"),
                       ("orbital period", "orbital_period"), ("rotation period", "rotation_period"),
                       ("short name", "abbreviation")]:
        f = first(facts, key)
        if f:
            s[label] = f["value"] if "unit" not in f else {"value": f["value"], "unit": f["unit"]}
    if not s.get("teff_k"):
        t = first(facts, "effective temperature")
        if t and t.get("unit") == "K":
            s["teff_k"] = t["value"]
    if s.get("v_mag") is None:
        m = first(facts, "apparent magnitude")
        if m:
            s["v_mag"] = m["value"]
    if "distance_ly" not in s:
        d = first(facts, "distance from Earth")
        if d and d.get("unit") == "ly":
            s["distance_ly"] = d["value"]
        elif d and d.get("unit") == "pc":
            s["distance_ly"] = round(d["value"] * 3.26156, 1)
    if obj.get("geometry"):
        s["ra_deg"], s["dec_deg"] = obj["geometry"]["ra_deg"], obj["geometry"]["dec_deg"]
    if not s.get("constellation") and obj.get("category") not in ("constellations", "planets", "satellites") \
            and s.get("ra_deg") is not None and s.get("dec_deg") is not None:
        s["constellation"] = constellation_at(s["ra_deg"], s["dec_deg"])
    if s.get("v_mag") is not None and (sb.get("plx_value") or 0) > 0:
        s["abs_mag"] = round(s["v_mag"] + 5 * math.log10(sb["plx_value"]) - 10, 2)
    s["spectral_class"], s["luminosity_class"] = spectral_classes(s.get("spectral_type"))
    if s.get("ra_deg") is not None and s.get("dec_deg") is not None:
        s["gal_l"], s["gal_b"] = galactic(s["ra_deg"], s["dec_deg"])
    wp = obj.get("wikipedia") or {}
    s["description"] = wp.get("description")
    ct = (obj.get("celestrak") or {})
    if ct.get("catalog"):
        c = ct["catalog"]
        s.update({"norad_id": c.get("NORAD_CAT_ID"), "launch_date": c.get("LAUNCH_DATE"),
                  "owner": c.get("OWNER"), "apogee_km": c.get("APOGEE"), "perigee_km": c.get("PERIGEE"),
                  "inclination_deg": c.get("INCLINATION"), "period_min": c.get("PERIOD")})
    return {k: v for k, v in s.items() if v not in (None, "")}


# ---------- satellite passes ----------

def sun_vector(jd):
    """Unit vector to the Sun in equatorial coordinates (low precision, ~0.01°)."""
    n = jd - 2451545.0
    g = math.radians((357.528 + 0.9856003 * n) % 360)
    lam = math.radians((280.460 + 0.9856474 * n + 1.915 * math.sin(g) + 0.020 * math.sin(2 * g)) % 360)
    eps = math.radians(23.439 - 0.0000004 * n)
    return (math.cos(lam), math.cos(eps) * math.sin(lam), math.sin(eps) * math.sin(lam))


def satellite_track(orbit, sighting_utc, site, hours=12, step_s=30):
    """Passes over the site from `hours` before to `hours` after a sighting.

    Propagates the CelesTrak elements with SGP4. Each pass lists points
    [seconds from sighting, RA, Dec, alt, az, sunlit] while above the horizon;
    `visible` means sunlit while the sky at the site was dark (Sun below -6°).
    """
    try:
        from sgp4.api import Satrec
        from sgp4 import omm
    except ImportError:
        return None
    sat = Satrec()
    try:
        omm.initialize(sat, {k: str(v) for k, v in orbit.items()})
    except (KeyError, ValueError):
        return None
    a, f = 6378.137, 1 / 298.257223563
    e2 = f * (2 - f)
    phi, lam, h = math.radians(site["lat"]), math.radians(site["lon"]), site.get("elev_m", 0) / 1000
    nrad = a / math.sqrt(1 - e2 * math.sin(phi) ** 2)
    ox, oy, oz = ((nrad + h) * math.cos(phi) * math.cos(lam), (nrad + h) * math.cos(phi) * math.sin(lam),
                  (nrad * (1 - e2) + h) * math.sin(phi))
    t0 = julian_date(sighting_utc)
    passes, cur, at = [], None, None
    for k in range(-hours * 3600 // step_s, hours * 3600 // step_s + 1):
        jd = t0 + k * step_s / 86400
        err, r, _ = sat.sgp4(math.floor(jd - 0.5) + 0.5, jd - (math.floor(jd - 0.5) + 0.5))
        if err:
            continue
        theta = math.radians((280.46061837 + 360.98564736629 * (jd - 2451545.0)) % 360)
        obs = (ox * math.cos(theta) - oy * math.sin(theta), ox * math.sin(theta) + oy * math.cos(theta), oz)
        rho = [r[i] - obs[i] for i in range(3)]
        dist = math.sqrt(sum(c * c for c in rho))
        lst = theta + lam
        south = (math.sin(phi) * math.cos(lst) * rho[0] + math.sin(phi) * math.sin(lst) * rho[1] - math.cos(phi) * rho[2])
        east = -math.sin(lst) * rho[0] + math.cos(lst) * rho[1]
        up = math.cos(phi) * math.cos(lst) * rho[0] + math.cos(phi) * math.sin(lst) * rho[1] + math.sin(phi) * rho[2]
        alt = math.degrees(math.asin(up / dist))
        az = math.degrees(math.atan2(east, -south)) % 360
        ra = math.degrees(math.atan2(rho[1], rho[0])) % 360
        dec = math.degrees(math.asin(rho[2] / dist))
        sv = sun_vector(jd)
        along = sum(r[i] * sv[i] for i in range(3))
        perp = math.sqrt(max(sum(c * c for c in r) - along * along, 0))
        lit = along > 0 or perp > 6371.0
        sun_up = math.cos(phi) * math.cos(lst) * sv[0] + math.cos(phi) * math.sin(lst) * sv[1] + math.sin(phi) * sv[2]
        dark = math.degrees(math.asin(max(-1, min(1, sun_up)))) < -6
        if k == 0:
            at = {"alt": round(alt, 1), "az": round(az, 1), "ra": round(ra, 2), "dec": round(dec, 2),
                  "sunlit": lit, "dark": dark, "range_km": round(dist)}
        if alt > 0:
            if cur is None:
                cur = {"points": [], "visible": False}
                passes.append(cur)
            cur["points"].append([k * step_s, round(ra, 2), round(dec, 2), round(alt, 1), round(az, 1), int(lit)])
            cur["visible"] |= lit and dark
        else:
            cur = None
    for p in passes:
        pts = p["points"]
        top = max(pts, key=lambda q: q[3])
        stamp = lambda sec: (sighting_utc + timedelta(seconds=sec)).strftime("%Y-%m-%d %H:%M")
        p.update(start_utc=stamp(pts[0][0]), end_utc=stamp(pts[-1][0]), max_utc=stamp(top[0]),
                 max_alt=top[3], start_az=pts[0][4], end_az=pts[-1][4], sighting=False,
                 gap_s=0 if pts[0][0] <= 0 <= pts[-1][0] else min(abs(pts[0][0]), abs(pts[-1][0])))
    # The logged time is often a few minutes after the pass (time taken to log it):
    # the nearest pass within 15 minutes is taken as the one seen.
    near = min(passes, key=lambda q: q["gap_s"], default=None)
    if near and near["gap_s"] <= 900:
        near["sighting"] = True
    return {"hours": hours, "step_s": step_s, "elements_epoch": orbit.get("EPOCH"),
            "at_sighting": at, "passes": passes}


# ---------- observations ----------

def attach_observations(obj, rows, locations):
    pos = obj.get("summary") or {}
    eph = []
    for e in (obj.get("horizons") or {}).get("ephemeris", []):
        try:
            t = datetime.strptime(e.get("Date__(UT)__HR:MN:SC.fff", "")[:20], "%Y-%b-%d %H:%M:%S")
            eph.append((t.replace(tzinfo=timezone.utc), e))
        except ValueError:
            pass
    out = []
    default_site = next(iter(locations.values()), {})
    for r in rows:
        site = locate(r["location"], locations) or default_site
        local = datetime.strptime(r["datetime"], "%Y-%m-%d %H:%M")
        entry = {k: r[k] for k in ("datetime", "location", "rating", "seeing", "transparency", "bortle")}
        for k in ("equipment", "notes"):   # only hand-entered rows carry these
            if r.get(k):
                entry[k] = r[k]
        entry["rating"] = float(r["rating"]) if r["rating"] else None
        entry["incomplete"] = bool(r["check"])
        if not r["location"] and site:
            entry["location_assumed"] = next(k for k, v in locations.items() if v is site)
        if site:
            utc = local.replace(tzinfo=ZoneInfo(site["tz"])).astimezone(timezone.utc)
            entry["utc"] = utc.strftime("%Y-%m-%d %H:%M")
            if pos.get("ra_deg") is not None:
                entry["altitude_deg"], entry["azimuth_deg"] = alt_az(pos["ra_deg"], pos["dec_deg"], utc, site["lat"], site["lon"])
            near = min(eph, key=lambda te: abs((te[0] - utc).total_seconds()), default=None)
            e = near[1] if near and abs((near[0] - utc).total_seconds()) < 120 else None
            if e:
                with contextlib.suppress(TypeError, ValueError):   # planets move between constellations
                    entry["constellation"] = constellation_at(float(e["R.A._(ICRF)"]), float(e["DEC_(ICRF)"]))
                entry["altitude_deg"] = float(e.get("Elev_(a-app)") or "nan")
                entry["azimuth_deg"] = float(e.get("Azi_(a-app)") or "nan")
                entry["ephemeris"] = {"mag": e.get("APmag"), "illuminated_pct": e.get("Illu%"),
                                      "angular_diameter_arcsec": e.get("Ang-diam"),
                                      "distance_au": e.get("delta"), "elongation_deg": e.get("S-O-T")}
            orbit = (obj.get("celestrak") or {}).get("orbit")
            if orbit:
                track = satellite_track(orbit, utc, site)
                if track:
                    entry["track"] = track
                    seen = next((q for q in track["passes"] if q["sighting"]), None)
                    if seen:   # logged time is usually just after the pass: report the pass's highest point
                        top = max(seen["points"], key=lambda q: q[3])
                        entry["altitude_deg"], entry["azimuth_deg"] = top[3], top[4]
                        entry["constellation"] = constellation_at(top[1], top[2])
                    else:
                        entry["altitude_deg"], entry["azimuth_deg"] = track["at_sighting"]["alt"], track["at_sighting"]["az"]
        out.append(entry)
    obj["observations"] = sorted(out, key=lambda e: e["datetime"], reverse=True)


# ---------- targets (not yet observed) ----------

def harvest_target(name, note):
    """Summary-only record for a star on targets.csv: SIMBAD and Wikidata, no papers, images or article."""
    simbad_id, qid, wiki_title, method = resolve_star(name)
    obj = {"name": name, "category": "stars", "note": note or None, "harvested": now_iso(),
           "resolved": {"method": method, "simbad_id": simbad_id, "wikidata": qid, "wikipedia": wiki_title}}
    rec = simbad_record(simbad_id) if simbad_id else None
    if rec:
        obj["simbad"] = {k: rec.get(k) for k in ("main_id", "otype_desc", "sp_type", "ra", "dec", "plx_value",
                                                 "plx_err", "fluxes", "teff_median")}
    if qid:
        ent = wikidata_entity(qid)
        if ent:
            obj["wikidata"] = {"id": qid, "facts": wikidata_facts(ent)[0]}
    if wiki_title:
        obj["wikipedia"] = {"title": wiki_title, "description": (wiki_summary(wiki_title) or {}).get("description")}
    s = summarise(obj)
    # Red supergiants have poor parallaxes: under 5 sigma, use Wikidata's distance or none at all.
    sb, d = obj.get("simbad") or {}, first((obj.get("wikidata") or {}).get("facts", {}), "distance from Earth")
    weak = not sb.get("plx_value") or not sb.get("plx_err") or sb["plx_value"] / sb["plx_err"] < 5
    if weak:
        for k in ("distance_ly", "distance_pc", "abs_mag"):
            s.pop(k, None)
        if d and d.get("unit") in ("ly", "pc"):
            s["distance_ly"] = d["value"] if d["unit"] == "ly" else round(d["value"] * 3.26156, 1)
    obj["summary"] = s
    obj.pop("simbad", None)
    obj.pop("wikidata", None)
    return obj


def write_targets(refresh=False):
    """targets.csv -> data/targets.json and data/targets.js (window.MO_TARGETS)."""
    if not TARGETS_PATH.exists():
        return
    try:
        old = {t["name"]: t for t in json.loads((DATA / "targets.json").read_text())["targets"]}
    except (OSError, ValueError, KeyError):
        old = {}
    out = []
    for row in csv.DictReader(open(TARGETS_PATH, encoding="utf-8")):
        name = row["object"].strip()
        if not name:
            continue
        t = old.get(name) if not refresh else None
        if t is None:
            print(f"target {name}", flush=True)
            t = harvest_target(name, (row.get("note") or "").strip())
        out.append(t)
    data = {"generated": now_iso(), "targets": out}
    write_json(DATA / "targets.json", data)
    (DATA / "targets.js").write_text("window.MO_TARGETS = " + js_json(data) + ";\n")
    print(f"{len(out)} targets -> data/targets.json", flush=True)


# ---------- GZ catalogue numbers ----------

def assign_gz_ids(objects):
    """GZ-1, GZ-2, ... in the order objects were first observed, kept in data/gz_ids.json.

    A number never changes once given: objects new to the file are numbered after every existing
    one, in order of their earliest observation (then name)."""
    path = DATA / "gz_ids.json"
    try:
        ids = json.loads(path.read_text())
    except (OSError, ValueError):
        ids = {}
    new = sorted((n for n in objects if n not in ids),
                 key=lambda n: (min(r["datetime"] for r in objects[n]["rows"]), n))
    nxt = max(ids.values(), default=0) + 1
    for name in new:
        ids[name] = nxt
        nxt += 1
    if new:
        write_json(path, dict(sorted(ids.items(), key=lambda kv: kv[1])))
        print(f"{len(new)} new GZ numbers -> data/gz_ids.json", flush=True)
    return ids


# ---------- main ----------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true", help="re-harvest objects that already have object.json")
    ap.add_argument("--only", action="append",
                    help="limit to an object name as written in observations.csv (repeatable)")
    ap.add_argument("--incomplete", action="store_true",
                    help="re-harvest objects missing SIMBAD (stars) or Wikipedia data")
    ap.add_argument("--workers", type=int, default=4, help="objects harvested in parallel (default 4)")
    ap.add_argument("--sky", action="store_true", help="rebuild data/sky/boundaries.* (also built when missing)")
    args = ap.parse_args()

    rows = list(csv.DictReader(open(CSV_PATH, encoding="utf-8")))
    locations = load_locations()
    objects = {}
    for r in rows:
        objects.setdefault(r["object"], {"type": r["type"], "rows": []})["rows"].append(r)
    if args.only:
        missing = [n for n in args.only if n not in objects]
        if missing:
            print(f"not in observations.csv: {', '.join(missing)}", flush=True)

    gz = assign_gz_ids(objects)
    jobs, todo = [], []
    for name, info in objects.items():
        if args.only and name not in args.only:
            continue
        cat = category_for(info["type"])
        folder = DATA / cat / slugify(name)
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / "object.json"
        site = locate(info["rows"][0]["location"], locations) or {"lat": 0, "lon": 0, "elev_m": 0, "tz": "UTC"}
        obs_utc = [datetime.strptime(r["datetime"], "%Y-%m-%d %H:%M").replace(tzinfo=ZoneInfo(site["tz"]))
                   .astimezone(timezone.utc) for r in info["rows"]]
        stale = False
        if args.incomplete and path.exists():
            old = json.loads(path.read_text())
            stale = not old.get("wikipedia") or (cat == "stars" and not old.get("simbad"))
        job = {"name": name, "cat": cat, "info": info, "folder": folder, "path": path,
               "site": site, "obs_utc": obs_utc, "obj": None}
        jobs.append(job)
        if not path.exists() or args.refresh or stale:
            todo.append(job)

    def run(job):
        print(f"harvesting {job['cat']}/{job['folder'].name} ({job['name']})", flush=True)
        t0 = time.monotonic()
        obj = harvest(job["name"], job["cat"], job["info"]["type"], job["folder"], job["obs_utc"], job["site"])
        print(f"  done {job['cat']}/{job['folder'].name} in {time.monotonic() - t0:.0f}s"
              f" (papers {obj.get('papers_count', '-')})", flush=True)
        return obj

    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
        futures = {pool.submit(run, job): job for job in todo}
        for fut in as_completed(futures):
            job = futures[fut]
            try:
                job["obj"] = fut.result()
            except Exception as exc:  # keep the old data for this object
                print(f"  FAILED {job['cat']}/{job['folder'].name}: {exc!r}", flush=True)

    for job in jobs:
        obj = job["obj"]
        if obj is None:
            if not job["path"].exists():
                continue
            obj = json.loads(job["path"].read_text())
        relabel(obj)
        obj["summary"] = summarise(obj)   # derived from stored data; cheap to rebuild
        obj["id"], obj["path"] = job["folder"].name, f"{job['cat']}/{job['folder'].name}"
        obj["gz_id"] = f"GZ-{gz[job['name']]}"
        attach_observations(obj, job["info"]["rows"], locations)
        write_json(job["path"], obj)

    if args.sky or (args.refresh and not args.only) or not (DATA / "sky" / "boundaries.js").exists():
        build_boundaries()
    write_targets(refresh=args.refresh and not args.only)
    write_index()


def write_extra(folder, key):
    """extra.js: papers and article text, loaded by the page on demand."""
    def load(name, default):
        try:
            return json.loads((folder / name).read_text())
        except (OSError, ValueError):
            return default
    papers, article = load("papers.json", []), load("article.json", {})
    payload = {"papers": papers, "article": {"sections": article.get("sections", []),
                                             "images": article.get("images", [])}}
    (folder / "extra.js").write_text(
        f"(window.MO_EXTRA = window.MO_EXTRA || {{}})[{json.dumps(key)}] = {js_json(payload)};\n")


def thumb(o):
    """Stars: own sky cutout (Wikipedia photos are mostly constellation charts). Others: photo first."""
    im = o.get("images", {})
    order = ("sky", "photo") if o["category"] in ("stars", "clusters", "nebulae", "galaxies") else ("photo", "sky")
    return next((im[k]["file"] for k in order if im.get(k)), None)


def write_index():
    entries, everything = [], {}
    for path in sorted(DATA.glob("*/*/object.json")):
        o = json.loads(path.read_text())
        everything[o["path"]] = o
        write_extra(path.parent, o["path"])
        obs = o.get("observations", [])
        ratings = [x["rating"] for x in obs if x.get("rating") is not None]
        s = o.get("summary", {})
        entries.append({
            "id": o["id"], "path": o["path"], "name": o["name"], "gz_id": o.get("gz_id"), "category": o["category"],
            "app_type": o["app_type"], "description": s.get("description"),
            "designation": s.get("designation"), "constellation": s.get("constellation"),
            "v_mag": s.get("v_mag"), "spectral_type": s.get("spectral_type"),
            "distance_ly": s.get("distance_ly"), "observations": len(obs),
            "papers_count": o.get("papers_count"),
            "last_observed": obs[0]["datetime"] if obs else None,
            "best_rating": max(ratings) if ratings else None,
            "thumb": thumb(o),
            "resolved": bool(o.get("simbad") or o.get("wikipedia") or o.get("horizons") or o.get("celestrak")),
        })
    index = {"generated": now_iso(), "objects": entries}
    (DATA / "index.json").write_text(json.dumps(index, indent=2, ensure_ascii=False))
    # Same data as a script, so index.html also works opened straight from disk (file://),
    # where browsers block fetch() of the JSON files.
    (DATA / "bundle.js").write_text("window.MO_DATA = " + json.dumps(
        {"index": index, "objects": everything}, ensure_ascii=False) + ";\n")
    print(f"{len(entries)} objects -> data/index.json")


if __name__ == "__main__":
    sys.exit(main())
