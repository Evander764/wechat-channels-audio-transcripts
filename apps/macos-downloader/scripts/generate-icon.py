#!/usr/bin/env python3
from __future__ import annotations

import os
import struct
import sys
import zlib
from pathlib import Path


def write_png(path: Path, width: int, height: int, pixels: bytes) -> None:
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    raw = b"".join(b"\x00" + pixels[y * width * 4 : (y + 1) * width * 4] for y in range(height))
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
    path.write_bytes(png)


def rounded_alpha(x: float, y: float, size: float, radius: float) -> float:
    inset = 18.0
    left, top = inset, inset
    right, bottom = size - inset, size - inset
    cx = min(max(x, left + radius), right - radius)
    cy = min(max(y, top + radius), bottom - radius)
    dist = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
    return max(0.0, min(1.0, radius + 1.0 - dist))


def make_icon(path: Path, size: int) -> None:
    scale = 3
    big = size * scale
    radius = big * 0.22
    pixels = bytearray()
    for y in range(size):
        for x in range(size):
            accum = [0.0, 0.0, 0.0, 0.0]
            for sy in range(scale):
                for sx in range(scale):
                    bx = x * scale + sx + 0.5
                    by = y * scale + sy + 0.5
                    a = rounded_alpha(bx, by, big, radius)
                    nx = bx / big
                    ny = by / big
                    bg = (
                        int(32 + 40 * nx),
                        int(94 + 70 * ny),
                        int(116 + 65 * (1 - nx)),
                    )
                    accent = (244, 187, 80)
                    line = abs((ny - 0.58) - 0.22 * __import__("math").sin(nx * 7.0))
                    if line < 0.018 or (0.30 < nx < 0.73 and 0.30 < ny < 0.42):
                        color = accent
                    elif 0.22 < nx < 0.78 and 0.50 < ny < 0.74:
                        color = (235, 248, 250)
                    else:
                        color = bg
                    accum[0] += color[0] * a
                    accum[1] += color[1] * a
                    accum[2] += color[2] * a
                    accum[3] += 255 * a
            samples = scale * scale
            pixels.extend(int(v / samples) for v in accum)
    write_png(path, size, size, bytes(pixels))


def main() -> None:
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("dist/icon.iconset")
    out.mkdir(parents=True, exist_ok=True)
    sizes = [
        (16, "icon_16x16.png"),
        (32, "icon_16x16@2x.png"),
        (32, "icon_32x32.png"),
        (64, "icon_32x32@2x.png"),
        (128, "icon_128x128.png"),
        (256, "icon_128x128@2x.png"),
        (256, "icon_256x256.png"),
        (512, "icon_256x256@2x.png"),
        (512, "icon_512x512.png"),
        (1024, "icon_512x512@2x.png"),
    ]
    for size, name in sizes:
        make_icon(out / name, size)


if __name__ == "__main__":
    main()
