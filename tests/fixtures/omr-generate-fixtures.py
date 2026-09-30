#!/usr/bin/env python3
"""Rebuild original deterministic OMR fixtures with only Python's standard library.
All raster shapes in these fixtures are original project test data, MIT licensed.
They are intentionally simple geometry, not an accuracy benchmark for real scores.
"""
from pathlib import Path
import struct
import zlib

ROOT = Path(__file__).parent

def png(name, width, height, pixels):
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))
    data = b''.join(b'\0' + bytes(pixels[y * width:(y + 1) * width]) for y in range(height))
    (ROOT / name).write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 0, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(data, 9)) + chunk(b'IEND', b''))

def fixture(name, two=False, hollow=False):
    width, height = 640, 320 if two else 160
    pixels = [255] * (width * height)
    def dot(x, y):
        pixels[y * width + x] = 0
    for offset in ([0, 160] if two else [0]):
        for y in range(70 + offset, 119 + offset, 12):
            for x in range(20, 620): dot(x, y)
        for index in range(8):
            cx, cy = 100 + index * 60, 118 - index * 6 + offset
            for y in range(cy - 4, cy + 5):
                for x in range(cx - 7, cx + 8):
                    radius = ((x - cx) / 7) ** 2 + ((y - cy) / 4) ** 2
                    if radius <= 1 and (not hollow or radius >= .60): dot(x, y)
            for y in range(cy - 34, cy + 1): dot(cx + 7, y)
    png(name, width, height, pixels)

fixture('omr-original-scale.png')
fixture('omr-original-two-staffs.png', two=True)
fixture('omr-original-hollow.png', hollow=True)
