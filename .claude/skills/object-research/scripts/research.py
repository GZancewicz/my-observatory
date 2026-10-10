"""Harvest details for every object in observations.csv into data/<category>/<slug>/.

Usage (from the project root):
    python3 .claude/skills/object-research/scripts/research.py            # new objects only
    python3 .claude/skills/object-research/scripts/research.py --refresh  # re-harvest everything
    python3 .claude/skills/object-research/scripts/research.py --only "ρ Hya" --refresh

Each object folder gets object.json (all details plus my observations of it),
sky.jpg (DSS2 colour cutout, when the object has coordinates) and photo.jpg
(the Wikipedia lead image, when there is one). data/index.json lists every
object for the viewer. Observations are rewritten on every run; harvested
details are kept unless --refresh is given.
"""
import argparse
import csv
import json
import math
import re
import sys
import time
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import requests

ROOT = Path.cwd()
DATA = ROOT / "data"
CSV_PATH = ROOT / "observations.csv"
UA = {"User-Agent": "my-observatory/0.1 (personal observing log)"}
PAUSE = 0.3  # seconds between requests to the same service

SIMBAD_TAP = "https://simbad.cds.unistra.fr/simbad/sim-tap/sync"
SESAME = "https://cds.unistra.fr/cgi-bin/nph-sesame/-oxp/S?"
WIKI_REST = "https://en.wikipedia.org/api/rest_v1/page/summary/"
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

def get(url, **kw):
    kw.setdefault("timeout", 40)
    headers = {**UA, **kw.pop("headers", {})}
    for attempt in range(3):
        try:
            r = requests.get(url, headers=headers, **kw)
            if r.status_code == 429:
                time.sleep(5 * (attempt + 1))
                continue
            time.sleep(PAUSE)
            return r
        except requests.RequestException:
            time.sleep(2 * (attempt + 1))
    return None


def tap(query):
    try:
        r = requests.post(SIMBAD_TAP, headers=UA, timeout=60, data={
            "request": "doQuery", "lang": "adql", "format": "json", "query": query})
        time.sleep(PAUSE)
        j = r.json()
    except (requests.RequestException, ValueError):
        return []
    cols = [m["name"] for m in j.get("metadata", [])]
    return [dict(zip(cols, row)) for row in j.get("data", [])]


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


# ---------- SIMBAD ----------

def sesame(name):
    r = get(SESAME + requests.utils.quote(name))
    if r is None:
        return None
    m = re.search(r"<oname>([^<]+)</oname>", r.text)
    return m.group(1) if m else None


def simbad_record(main_id):
    rows = tap(f"""SELECT b.oid, b.main_id, b.ra, b.dec, b.otype, d.description AS otype_desc,
        b.sp_type, b.plx_value, b.plx_err, b.pmra, b.pmdec, b.rvz_radvel, b.rvz_redshift,
        b.galdim_majaxis, b.galdim_minaxis, b.morph_type, b.nbref
        FROM basic b LEFT JOIN otypedef d ON b.otype = d.otype
        WHERE b.main_id = '{esc(main_id)}'""")
    if not rows:
        return None
    rec = rows[0]
    oid = rec.pop("oid")
    rec["identifiers"] = [i["id"] for i in tap(f"SELECT id FROM ident WHERE oidref = {oid}")]
    rec["fluxes"] = {f["filter"]: {"mag": f["flux"], "err": f["flux_err"]}
                     for f in tap(f"SELECT filter, flux, flux_err FROM flux WHERE oidref = {oid}")}
    feh = tap(f"SELECT teff, log_g, fe_h, bibcode FROM mesFe_h WHERE oidref = {oid}")
    rec["atmosphere_measurements"] = feh
    teffs = sorted(x["teff"] for x in feh if x["teff"])
    rec["teff_median"] = teffs[len(teffs) // 2] if teffs else None
    rot = tap(f"SELECT vsini, vsini_err, bibcode FROM mesRot WHERE oidref = {oid}")
    rec["vsini_measurements"] = rot
    rec["distance_measurements"] = tap(
        f"SELECT dist, unit, plus_err, minus_err, method, bibcode FROM mesDistance WHERE oidref = {oid}")
    rec["types"] = [t["otype"] for t in tap(f"SELECT otype FROM otypes WHERE oidref = {oid}")]
    rec["url"] = "https://simbad.cds.unistra.fr/simbad/sim-id?Ident=" + requests.utils.quote(main_id)
    return rec


# ---------- Wikipedia / Wikidata ----------

def wiki_summary(title):
    r = get(WIKI_REST + requests.utils.quote(title.replace(" ", "_")))
    if r is None or r.status_code != 200:
        return None
    s = r.json()
    if s.get("type") == "disambiguation":
        return None
    return s


def wiki_intro(title):
    r = get(WIKI_API, params={"action": "query", "prop": "extracts", "exintro": 1,
                              "explaintext": 1, "redirects": 1, "titles": title, "format": "json"})
    if r is None:
        return None
    pages = r.json().get("query", {}).get("pages", {})
    return next(iter(pages.values()), {}).get("extract")


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


def wikidata_labels(qids):
    labels = {}
    qids = sorted(set(qids))
    for i in range(0, len(qids), 50):
        r = get(WIKIDATA_API, params={"action": "wbgetentities", "ids": "|".join(qids[i:i + 50]),
                                      "props": "labels", "languages": "en", "format": "json"})
        if r is None:
            continue
        for q, e in r.json().get("entities", {}).items():
            labels[q] = e.get("labels", {}).get("en", {}).get("value", q)
    return labels


def wikidata_facts(entity):
    """Selected claims as {label: [{"value", "unit", "rank"}...]}, preferred rank first."""
    claims = entity.get("claims", {})
    raw, item_ids = {}, []
    for pid, label in WD_PROPS.items():
        vals = []
        for c in claims.get(pid, []):
            dv = c["mainsnak"].get("datavalue")
            if not dv:
                continue
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
                item_ids.append(v["id"])
                entry = {"value": v["id"]}
            elif t == "time":
                entry = {"value": v["time"].lstrip("+").split("T")[0]}
            elif t in ("string", "monolingualtext"):
                entry = {"value": v if isinstance(v, str) else v["text"]}
            else:
                continue
            entry["rank"] = c.get("rank")
            vals.append(entry)
        if vals:
            vals.sort(key=lambda e: e["rank"] != "preferred")
            raw[label] = vals
    labels = wikidata_labels(item_ids) if item_ids else {}
    for vals in raw.values():
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
            e.pop("rank", None)
    image = claims.get("P18", [{}])[0].get("mainsnak", {}).get("datavalue", {}).get("value")
    return raw, image


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
    r = get(NOMINATIM, params={"q": place, "format": "json", "limit": 1}, timeout=30)
    time.sleep(1)  # Nominatim policy: one request per second
    if r is None or not r.json():
        return None
    hit = r.json()[0]
    locations[place] = {"lat": float(hit["lat"]), "lon": float(hit["lon"]), "elev_m": 0,
                        "tz": "America/Chicago", "note": "geocoded by Nominatim; check tz and elevation"}
    (DATA / "locations.json").write_text(json.dumps(locations, indent=2, ensure_ascii=False))
    return locations[place]


def constellation_geometry(abbr):
    """Centre and radius of a constellation from the IAU boundaries (VizieR VI/49)."""
    try:
        r = requests.post(VIZIER_TAP, headers=UA, timeout=60, data={
            "request": "doQuery", "lang": "adql", "format": "json",
            "query": f"SELECT RAJ2000, DEJ2000 FROM \"VI/49/bound_20\" WHERE cst = '{abbr.upper():<4}'"})
        pts = r.json()["data"]
    except (requests.RequestException, ValueError, KeyError):
        return None
    if not pts:
        return None
    vec = lambda ra, de: (math.cos(math.radians(de)) * math.cos(math.radians(ra)),
                          math.cos(math.radians(de)) * math.sin(math.radians(ra)), math.sin(math.radians(de)))
    vs = [vec(ra, de) for ra, de in pts]
    x, y, z = (sum(v[i] for v in vs) for i in range(3))
    n = math.sqrt(x * x + y * y + z * z)
    x, y, z = x / n, y / n, z / n
    radius = max(math.degrees(math.acos(max(-1, min(1, v[0] * x + v[1] * y + v[2] * z)))) for v in vs)
    return {"ra_deg": round(math.degrees(math.atan2(y, x)) % 360, 3),
            "dec_deg": round(math.degrees(math.asin(z)), 3), "radius_deg": round(radius, 1),
            "source": "IAU boundaries, VizieR VI/49"}


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
    """Replace Wikidata ids left unlabelled by a failed label lookup."""
    facts = (obj.get("wikidata") or {}).get("facts", {})
    qids = [e["value"] for vals in facts.values() for e in vals
            if isinstance(e.get("value"), str) and re.fullmatch(r"Q\d+", e["value"])]
    if not qids:
        return
    labels = wikidata_labels(qids)
    for vals in facts.values():
        for e in vals:
            if e.get("value") in labels:
                e["value"] = labels[e["value"]]


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
            if not wiki_title:
                wiki_title = first_star_article(wiki_titles_from_ids(name, rec["identifiers"]))

    wp = wikipedia_block(wiki_title) if wiki_title else None
    if wp:
        obj["wikipedia"] = wp
        qid = qid or wp.get("wikidata")
        obj["sources"].append({"name": "Wikipedia", "url": wp["url"], "retrieved": now_iso()})
    if qid:
        ent = wikidata_entity(qid)
        if ent:
            facts, commons_image = wikidata_facts(ent)
            obj["wikidata"] = {"id": qid, "facts": facts, "commons_image": commons_image,
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
        fov = 1.0 if category in ("clusters", "nebulae", "galaxies") else 0.4
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
    wp = obj.get("wikipedia") or {}
    s["description"] = wp.get("description")
    ct = (obj.get("celestrak") or {})
    if ct.get("catalog"):
        c = ct["catalog"]
        s.update({"norad_id": c.get("NORAD_CAT_ID"), "launch_date": c.get("LAUNCH_DATE"),
                  "owner": c.get("OWNER"), "apogee_km": c.get("APOGEE"), "perigee_km": c.get("PERIGEE"),
                  "inclination_deg": c.get("INCLINATION"), "period_min": c.get("PERIOD")})
    return {k: v for k, v in s.items() if v not in (None, "")}


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
                entry["altitude_deg"] = float(e.get("Elev_(a-app)") or "nan")
                entry["azimuth_deg"] = float(e.get("Azi_(a-app)") or "nan")
                entry["ephemeris"] = {"mag": e.get("APmag"), "illuminated_pct": e.get("Illu%"),
                                      "angular_diameter_arcsec": e.get("Ang-diam"),
                                      "distance_au": e.get("delta"), "elongation_deg": e.get("S-O-T")}
        out.append(entry)
    obj["observations"] = sorted(out, key=lambda e: e["datetime"], reverse=True)


# ---------- main ----------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true", help="re-harvest objects that already have object.json")
    ap.add_argument("--only", help="limit to one object name, as written in observations.csv")
    ap.add_argument("--incomplete", action="store_true",
                    help="re-harvest objects missing SIMBAD (stars) or Wikipedia data")
    args = ap.parse_args()

    rows = list(csv.DictReader(open(CSV_PATH, encoding="utf-8")))
    locations = load_locations()
    objects = {}
    for r in rows:
        objects.setdefault(r["object"], {"type": r["type"], "rows": []})["rows"].append(r)

    for name, info in objects.items():
        if args.only and name != args.only:
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
        if path.exists() and not args.refresh and not stale:
            obj = json.loads(path.read_text())
            relabel(obj)
            obj["summary"] = summarise(obj)   # derived from stored data; cheap to rebuild
        else:
            print(f"harvesting {cat}/{folder.name} ({name})", flush=True)
            obj = harvest(name, cat, info["type"], folder, obs_utc, site)
            relabel(obj)
            obj["summary"] = summarise(obj)
        obj["id"], obj["path"] = folder.name, f"{cat}/{folder.name}"
        attach_observations(obj, info["rows"], locations)
        path.write_text(json.dumps(obj, indent=2, ensure_ascii=False))

    write_index()


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
        obs = o.get("observations", [])
        ratings = [x["rating"] for x in obs if x.get("rating") is not None]
        s = o.get("summary", {})
        entries.append({
            "id": o["id"], "path": o["path"], "name": o["name"], "category": o["category"],
            "app_type": o["app_type"], "description": s.get("description"),
            "designation": s.get("designation"), "constellation": s.get("constellation"),
            "v_mag": s.get("v_mag"), "spectral_type": s.get("spectral_type"),
            "distance_ly": s.get("distance_ly"), "observations": len(obs),
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
