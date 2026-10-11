"""Identify unlabelled stars on a sky-chart screenshot from two labelled ones.

Fits a similarity transform (scale, rotation, offset) from a gnomonic projection of
the sky to screen pixels using two reference stars, then lists the catalogue stars
nearest each circled point.

Usage:
    python3 fit_chart.py --ref "Procyon:234,703" --ref "Alhena:192,385" \
        --check "Betelgeuse:345,320" --circle 140,280 --circle 55,340 --circle 230,445 \
        [--maglim 5.5] [--radius 25]

Pixel coordinates are in whatever frame you measured (e.g. the image as displayed),
as long as every point uses the same frame. --check stars are only reported, to show
how well the fit predicts a third known star.
"""
import argparse
import cmath
import math
import re

import requests

UA = {"User-Agent": "my-observatory/0.1 (personal observing log)"}
SESAME = "https://cds.unistra.fr/cgi-bin/nph-sesame/-oxp/S?"
TAP = "https://simbad.cds.unistra.fr/simbad/sim-tap/sync"


def resolve(name):
    r = requests.get(SESAME + requests.utils.quote(name), headers=UA, timeout=30).text
    ra, de = re.search(r"<jradeg>([-\d.]+)", r), re.search(r"<jdedeg>([-\d.]+)", r)
    if not ra:
        raise SystemExit(f"Sesame could not resolve {name!r}")
    return float(ra.group(1)), float(de.group(1))


def tap(q):
    r = requests.post(TAP, headers=UA, timeout=60,
                      data={"request": "doQuery", "lang": "adql", "format": "json", "query": q}).json()
    cols = [m["name"] for m in r["metadata"]]
    return [dict(zip(cols, row)) for row in r["data"]]


def point(s):
    name, xy = s.rsplit(":", 1) if ":" in s else (None, s)
    x, y = (float(v) for v in xy.split(","))
    return name, complex(x, y)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ref", action="append", required=True, help='"Name:x,y" (exactly two)')
    ap.add_argument("--check", action="append", default=[], help='"Name:x,y" to test the fit')
    ap.add_argument("--circle", action="append", default=[], help="x,y of a circled star")
    ap.add_argument("--maglim", type=float, default=5.5)
    ap.add_argument("--radius", type=float, default=25, help="match radius in pixels")
    ap.add_argument("--projection", choices=["stereographic", "gnomonic"], default="stereographic",
                    help="sky apps usually draw stereographic; try gnomonic if --check stars fit badly")
    a = ap.parse_args()
    if len(a.ref) != 2:
        raise SystemExit("give exactly two --ref stars")

    refs = [point(r) for r in a.ref]
    sky = [resolve(n) for n, _ in refs]
    ra0 = math.radians(sum(s[0] for s in sky) / 2)
    de0 = math.radians(sum(s[1] for s in sky) / 2)

    def plane(ra, de):   # east to the left, north up
        ra, de = math.radians(ra), math.radians(de)
        c = math.sin(de0) * math.sin(de) + math.cos(de0) * math.cos(de) * math.cos(ra - ra0)
        f = 1 / c if a.projection == "gnomonic" else 2 / (1 + c)
        x = f * math.cos(de) * math.sin(ra - ra0)
        y = f * (math.cos(de0) * math.sin(de) - math.sin(de0) * math.cos(de) * math.cos(ra - ra0))
        return complex(-x, y)

    # screen y grows downward: conjugate so both planes have the same handedness
    w1, w2 = plane(*sky[0]), plane(*sky[1])
    z1, z2 = refs[0][1].conjugate(), refs[1][1].conjugate()
    k = (z2 - z1) / (w2 - w1)
    b = z1 - k * w1
    to_screen = lambda ra, de: (k * plane(ra, de) + b).conjugate()
    scale = abs(k) * math.pi / 180
    print(f"scale {scale:.1f} px/deg, rotation {math.degrees(cmath.phase(k)):.1f} deg")

    for n, z in (point(c) for c in a.check):
        p = to_screen(*resolve(n))
        print(f"check {n}: predicted ({p.real:.0f},{p.imag:.0f}) vs given ({z.real:.0f},{z.imag:.0f}), "
              f"off by {abs(p - z):.0f} px")

    # catalogue stars in the field
    span = max(abs(refs[0][1] - refs[1][1]), *(abs(point(c)[1] - refs[0][1]) for c in a.circle)) / scale
    stars = tap(f"""SELECT b.oid, b.main_id, b.ra, b.dec, f.flux AS v FROM basic b JOIN flux f ON b.oid = f.oidref
        WHERE f.filter = 'V' AND f.flux < {a.maglim}
        AND CONTAINS(POINT('ICRS', b.ra, b.dec), CIRCLE('ICRS', {math.degrees(ra0)}, {math.degrees(de0)}, {span * 1.5 + 2})) = 1""")
    if stars:
        oids = ",".join(str(s["oid"]) for s in stars)
        names = {}
        for row in tap(f"SELECT oidref, id FROM ident WHERE id LIKE 'NAME %' AND oidref IN ({oids})"):
            names.setdefault(row["oidref"], row["id"][5:])
        for s in stars:
            s["label"] = re.sub(r"\s+", " ", s["main_id"].lstrip("* ").strip())
            if s["oid"] in names:
                s["label"] = f'{names[s["oid"]]} ({s["label"]})'
            s["xy"] = to_screen(s["ra"], s["dec"])

    for c in a.circle:
        _, z = point(c)
        near = sorted((abs(s["xy"] - z), s) for s in stars)
        hits = [(d, s) for d, s in near if d <= a.radius] or near[:1]
        print(f"circle ({z.real:.0f},{z.imag:.0f}):")
        for d, s in hits[:4]:
            print(f"   {s['label']:<32} V {s['v']:.2f}   {d:.0f} px away")


if __name__ == "__main__":
    main()
