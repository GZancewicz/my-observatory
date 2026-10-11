"""Turn MO Pro "My Observations" screenshots into observations.csv.

Rows in observations_manual.csv (same columns plus equipment and notes) are merged in.

Usage: python3 extract.py [screenshots_dir]

Text comes from macOS Vision (./ocr, built from ocr.swift). Vision cannot read
Greek, so the Bayer letter of names like "ρ Hya" is matched by shape against the
labelled reference images in glyphs/. A letter with no good match is saved to
glyphs/unlabeled/ and its row is flagged in the `check` column.
"""
import csv
import json
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent
OCR_BIN = ROOT / "ocr"
CACHE = ROOT / "ocr_cache"
GLYPHS = ROOT / "glyphs"
UNLABELED = GLYPHS / "unlabeled"

LIST_TOP = 566          # px; everything above is the app header and filter chips
NAV_TOP = 2265          # px; Android navigation bar
FAB = (870, 2060, 1040, 2225)  # the "+" button, which can hide stars
TEXT_X = (250, 330)     # left edge of the card text column (location may lack its pin)
STAR_X = [844, 888, 933, 978, 1023]  # centres of the five rating stars
GLYPH_SIZE = 40
GLYPH_MATCH = 0.80      # minimum similarity to accept a reference glyph

GREEK = {
    "alpha": "α", "beta": "β", "gamma": "γ", "delta": "δ", "epsilon": "ε",
    "zeta": "ζ", "eta": "η", "theta": "θ", "iota": "ι", "kappa": "κ",
    "lambda": "λ", "mu": "μ", "nu": "ν", "xi": "ξ", "omicron": "ο", "pi": "π",
    "rho": "ρ", "sigma": "σ", "tau": "τ", "upsilon": "υ", "phi": "φ",
    "chi": "χ", "psi": "ψ", "omega": "ω",
}
SUPERSCRIPT = str.maketrans("0123456789", "⁰¹²³⁴⁵⁶⁷⁸⁹")

IAU = set("""And Ant Aps Aqr Aql Ara Ari Aur Boo Cae Cam Cnc CVn CMa CMi Cap Car
Cas Cen Cep Cet Cha Cir Col Com CrA CrB Crv Crt Cru Cyg Del Dor Dra Equ Eri For
Gem Gru Her Hor Hya Hyi Ind Lac Leo LMi Lep Lib Lup Lyn Lyr Men Mic Mon Mus Nor
Oct Oph Ori Pav Peg Per Phe Pic Psc PsA Pup Pyx Ret Sge Sgr Sco Scl Sct Ser Sex
Tau Tel Tri TrA Tuc UMa UMi Vel Vir Vol Vul""".split())

# Vision sometimes returns Cyrillic look-alikes for Latin letters ("Тус" for "Tyc").
CYRILLIC = str.maketrans("АВЕКМНОРСТУХаеорсуухіј", "ABEKMHOPCTYXaeopcyyxij")


def glyph_label_to_text(label):
    """'tau2' -> 'τ²'."""
    m = re.fullmatch(r"([a-z]+)(\d*)", label)
    return GREEK[m.group(1)] + m.group(2).translate(SUPERSCRIPT)


def ocr(image_path):
    CACHE.mkdir(exist_ok=True)
    cached = CACHE / (image_path.stem + ".json")
    if cached.exists() and cached.stat().st_mtime >= image_path.stat().st_mtime:
        return json.loads(cached.read_text())
    out = subprocess.run([str(OCR_BIN), str(image_path)], check=True,
                         capture_output=True, text=True).stdout
    cached.write_text(out)
    return json.loads(out)


def split_cards(lines):
    """Group OCR lines in the text column into cards, top to bottom."""
    lines = [{**l, "text": l["text"].translate(CYRILLIC)} for l in lines
             if l["text"].strip("•·○O0 ")]   # the location pin is sometimes read as a line of its own
    col = sorted((l for l in lines if TEXT_X[0] <= l["x"] <= TEXT_X[1]
                  and LIST_TOP <= l["y"] < NAV_TOP), key=lambda l: l["y"])
    badges = sorted((l for l in lines if re.match(r"[STB]:", l["text"])
                     and LIST_TOP <= l["y"] < NAV_TOP), key=lambda l: (l["y"], l["x"]))
    cards = []
    for i, l in enumerate(col):
        text = l["text"].lstrip("•· ").strip()
        if re.match(r"\d{1,2} \w{3} \d{4}, \d{2}:\d{2}$", text) and i >= 2:
            name, kind, date = col[i - 2], col[i - 1], l
            # name and type must be the two lines directly above the date
            if not (0 < date["y"] - kind["y"] < 90 and 0 < kind["y"] - name["y"] < 90):
                continue
            loc = col[i + 1] if i + 1 < len(col) and 0 < col[i + 1]["y"] - date["y"] < 90 else None
            if loc and loc["y"] + loc["h"] > NAV_TOP:   # clipped by the nav bar; text is garbled
                loc = None
            row_y = (loc or date)["y"]
            card_badges = [b for b in badges if 0 < b["y"] - row_y < 110]
            cards.append({"name": name, "kind": kind, "date": date,
                          "loc": loc, "badges": card_badges})
    return cards


def rating(img, name_line):
    """Count gold stars to the right of the name.

    Returns None if the stars are hidden, "" if the card has no stars (unrated).
    """
    if name_line["y"] + 5 < LIST_TOP:   # stars span name_y-5..+27; a few px under the header still count
        return None
    y0, y1 = max(name_line["y"] - 10, LIST_TOP), name_line["y"] + 32  # stars span name_y-5..+27
    if y1 > NAV_TOP:
        return None
    if y1 > FAB[1] and STAR_X[-1] + 20 > FAB[0]:
        return None
    a = img[y0:y1].astype(int)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    gold = (r > 200) & (g > 160) & (b < 90)
    grey = (np.abs(r - b) < 30) & (r > 80) & (r < 160)
    if gold[:, STAR_X[0] - 20:].mean() < 0.01 and grey[:, STAR_X[0] - 20:].mean() < 0.03:  # grey stars give ~0.1-0.2
        return ""
    filled = 0.0
    for cx in STAR_X:
        frac = gold[:, cx - 20:cx + 20].mean()
        if frac > 0.15:
            filled += 1
        elif frac > 0.05:
            filled += 0.5
    return int(filled) if filled.is_integer() else filled


def bayer_prefix_crop(img, name_line):
    """Crop the Greek letter (plus any superscript digit) before the space."""
    x, y, w, h = name_line["x"], name_line["y"], name_line["w"], name_line["h"]
    pad = 8
    region = img[max(y - pad, 0):y + h + pad, max(x - pad, 0):x + w + pad]
    lum = region.mean(axis=2)
    ink = lum > 150
    cols = ink.any(axis=0)
    xs = np.flatnonzero(cols)
    if xs.size == 0:
        return None
    start, end, gap = xs[0], xs[0], 0
    for cx in range(xs[0], len(cols)):
        if cols[cx]:
            if gap >= 12:
                break
            end, gap = cx, 0
        else:
            gap += 1
    glyph = ink[:, start:end + 1]
    return glyph


def normalise(glyph):
    """Fixed-size image keeping the vertical position within the line box."""
    h, w = glyph.shape
    side = max(h, w)
    canvas = np.zeros((side, side), dtype=np.uint8)
    canvas[:h, (side - w) // 2:(side - w) // 2 + w] = glyph * 255
    im = Image.fromarray(canvas).resize((GLYPH_SIZE, GLYPH_SIZE), Image.BILINEAR)
    v = np.asarray(im, dtype=float)
    v -= v.mean()
    n = np.linalg.norm(v)
    return v / n if n else v, w / h


def load_references():
    refs = []
    for p in sorted(GLYPHS.glob("*.png")):
        g = np.asarray(Image.open(p).convert("L")) > 127
        vec, aspect = normalise(g)
        refs.append((p.stem.split("_")[0], vec, aspect))
    return refs


def classify(glyph, refs):
    vec, aspect = normalise(glyph)
    best, score = None, -1.0
    for label, rvec, raspect in refs:
        s = float((vec * rvec).sum()) - abs(aspect - raspect) * 0.3
        if s > score:
            best, score = label, s
    return best, score


def save_unlabeled(glyph, guess):
    UNLABELED.mkdir(parents=True, exist_ok=True)
    vec, _ = normalise(glyph)
    for p in UNLABELED.glob("*.png"):
        g = np.asarray(Image.open(p).convert("L")) > 127
        if float((normalise(g)[0] * vec).sum()) > 0.95:
            return p.name
    p = UNLABELED / f"{len(list(UNLABELED.glob('*.png'))):03d}_{guess}.png"
    Image.fromarray(glyph.astype(np.uint8) * 255).save(p)
    return p.name


def parse_card(card, img, refs, source):
    clean = lambda l: l["text"].lstrip("•· ").strip().translate(CYRILLIC) if l else ""
    name = clean(card["name"])
    check = []

    m = re.fullmatch(r"(\S{1,3}) ([A-Z][A-Za-z]{2})", name)
    if m and m.group(2) in IAU and not (m.group(1).isdigit() and m.group(1) != "0"):  # Flamsteed numbers OCR fine; "0" is θ
        glyph = bayer_prefix_crop(img, card["name"])
        label, score = classify(glyph, refs) if glyph is not None and refs else (None, 0)
        if label and score >= GLYPH_MATCH:
            name = f"{glyph_label_to_text(label)} {m.group(2)}"
        else:
            saved = save_unlabeled(glyph, re.sub(r"\W", "x", m.group(1))) if glyph is not None else "?"
            check.append(f"unknown Greek letter (glyphs/unlabeled/{saved})")

    when = datetime.strptime(clean(card["date"]), "%d %b %Y, %H:%M")
    badges = {b["text"][0]: b["text"].split(":", 1)[1].strip() for b in card["badges"]}
    stars = rating(img, card["name"])
    if not badges:
        check.append("card cut off: rating and S/T/B not visible")
    elif stars is None:
        check.append("rating hidden")

    return {
        "object": name,
        "type": clean(card["kind"]),
        "datetime": when.strftime("%Y-%m-%d %H:%M"),
        "location": clean(card["loc"]),
        "rating": stars,
        "seeing": badges.get("S", ""),
        "transparency": badges.get("T", ""),
        "bortle": badges.get("B", ""),
        "source": source,
        "check": "; ".join(check),
    }


def completeness(row):
    return sum(1 for k in ("location", "rating", "seeing", "transparency", "bortle")
               if row[k] not in ("", None)) - bool(row["check"])


def main():
    shots = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "screenshots"
    refs = load_references()
    rows = {}
    for path in sorted(shots.glob("*.jpg")) + sorted(shots.glob("*.png")):
        img = np.asarray(Image.open(path).convert("RGB"))
        for card in split_cards(ocr(path)):
            row = parse_card(card, img, refs, path.name)
            key = (row["datetime"], row["type"], row["object"] if not row["check"].startswith("unknown") else path.name + row["object"])
            if key not in rows or completeness(row) > completeness(rows[key]):
                rows[key] = row

    for row in rows.values():
        row.update(equipment="", notes="")
    # Hand-entered observations (e.g. from sky-chart captures) live in their own file
    # because this script rewrites observations.csv from the screenshots every run.
    manual = ROOT / "observations_manual.csv"
    if manual.exists():
        for row in csv.DictReader(open(manual, encoding="utf-8")):
            rows[(row["datetime"], row["type"], row["object"])] = row

    out = sorted(rows.values(), key=lambda r: r["datetime"], reverse=True)
    with open(ROOT / "observations.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(out[0].keys()))
        w.writeheader()
        w.writerows(out)
    flagged = [r for r in out if r["check"]]
    print(f"{len(out)} observations -> observations.csv ({len(flagged)} flagged)")
    for r in flagged:
        print(f"  {r['datetime']}  {r['object']:<20} {r['check']}")


if __name__ == "__main__":
    main()
