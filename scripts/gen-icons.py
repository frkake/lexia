#!/usr/bin/env python3
"""E-2: regenerate Lexia's app icons into public/.

The "L." serif lettermark is defined once here as normalized rectangles + a
period dot, mirroring public/favicon.svg (the hand-authored primary source), so
the SVG and the rasterized PNG/ICO stay in lock-step. Pure Python stdlib only
(zlib + struct) — no external rasterizer, no font files, fully reproducible.

Usage:  python3 scripts/gen-icons.py [output_dir]   # default: ./public
Outputs: icon-192.png, icon-512.png, apple-touch-icon.png, favicon.ico
(favicon.svg and manifest.webmanifest are hand-authored and not regenerated.)
"""
import os
import struct
import sys
import zlib

OUTDIR = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public"
)

PRIMARY = (61, 108, 176)  # #3D6CB0 brand primary
LETTER = (246, 248, 250)  # #F6F8FA warm white

# --- lettermark geometry (normalized 0..1, y down); mirrors public/favicon.svg -
LETTER_RECTS = [
    (0.335, 0.300, 0.435, 0.700),  # stem
    (0.300, 0.300, 0.470, 0.335),  # top serif (overhangs both sides)
    (0.335, 0.615, 0.600, 0.700),  # base arm / foot
    (0.300, 0.665, 0.435, 0.700),  # bottom-left serif overhang
    (0.565, 0.595, 0.605, 0.700),  # right terminal serif on the arm
]
DOT_CX, DOT_CY, DOT_R = 0.690, 0.655, 0.048  # period


def letter_hit(px, py):
    for x0, y0, x1, y1 in LETTER_RECTS:
        if x0 <= px < x1 and y0 <= py < y1:
            return True
    dx, dy = px - DOT_CX, py - DOT_CY
    return dx * dx + dy * dy <= DOT_R * DOT_R


def bg_hit(px, py, rounded, rr):
    if not rounded:
        return True
    if rr <= px <= 1 - rr or rr <= py <= 1 - rr:
        return 0 <= px <= 1 and 0 <= py <= 1
    cx = rr if px < 0.5 else 1 - rr
    cy = rr if py < 0.5 else 1 - rr
    dx, dy = px - cx, py - cy
    return dx * dx + dy * dy <= rr * rr


def render(size, rounded, radius, ss=4):
    buf = bytearray(size * size * 4)
    inv = 1.0 / size
    subs = [(i + 0.5) / ss for i in range(ss)]
    n = ss * ss
    for y in range(size):
        row = y * size * 4
        for x in range(size):
            bg = lt = 0
            for sy in subs:
                py = (y + sy) * inv
                for sx in subs:
                    px = (x + sx) * inv
                    if bg_hit(px, py, rounded, radius):
                        bg += 1
                        if letter_hit(px, py):
                            lt += 1
            bg_a, lt_a = bg / n, lt / n
            out_a = lt_a + bg_a * (1 - lt_a)
            i = row + x * 4
            if out_a <= 0:
                continue
            for c in range(3):
                col = (LETTER[c] * lt_a + PRIMARY[c] * bg_a * (1 - lt_a)) / out_a
                buf[i + c] = int(col + 0.5)
            buf[i + 3] = int(out_a * 255 + 0.5)
    return bytes(buf)


def png(size, raw):
    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    stride = size * 4
    scan = bytearray()
    for y in range(size):
        scan.append(0)
        scan += raw[y * stride:(y + 1) * stride]
    idat = zlib.compress(bytes(scan), 9)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")


def ico(png_bytes, size):
    header = struct.pack("<HHH", 0, 1, 1)
    w = size if size < 256 else 0
    entry = struct.pack("<BBBBHHII", w, w, 0, 0, 1, 32, len(png_bytes), 22)
    return header + entry + png_bytes


def write(name, data):
    with open(os.path.join(OUTDIR, name), "wb") as f:
        f.write(data)
    print(f"wrote {name} ({len(data)} bytes)")


def main():
    # Maskable PWA icons: full-bleed square background (platform applies the mask).
    write("icon-192.png", png(192, render(192, False, 0.0, ss=4)))
    write("icon-512.png", png(512, render(512, False, 0.0, ss=3)))
    # apple-touch-icon: opaque 180 square; iOS rounds it itself.
    write("apple-touch-icon.png", png(180, render(180, False, 0.0, ss=4)))
    # favicon.ico: rounded 32px PNG wrapped in an ICO container.
    write("favicon.ico", ico(png(32, render(32, True, 0.22, ss=4)), 32))
    print("done")


if __name__ == "__main__":
    main()
