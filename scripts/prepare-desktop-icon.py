#!/usr/bin/env python3
"""Generate the original MIT-licensed 32px proof icon; no third-party artwork."""
from pathlib import Path
import struct

size = 32
pixels = bytearray()
for y in reversed(range(size)):
    for x in range(size):
        note = ((x - 11) ** 2 + (y - 23) ** 2 <= 25 or
                (16 <= x <= 19 and 6 <= y <= 23) or
                (18 <= x <= 26 and 6 <= y <= 10))
        red, green, blue = (244, 246, 241) if note else (50, 107, 76)
        pixels.extend((blue, green, red, 255))
mask = bytes(size * 4)
bitmap = struct.pack('<IiiHHIIiiII', 40, size, size * 2, 1, 32, 0,
                     len(pixels) + len(mask), 0, 0, 0, 0) + pixels + mask
header = struct.pack('<HHH', 0, 1, 1)
entry = struct.pack('<BBBBHHII', size, size, 0, 0, 1, 32, len(bitmap), 22)
root = Path(__file__).resolve().parents[1]
(root / 'crates/desktop-shell/icons/icon.ico').write_bytes(header + entry + bitmap)
