# Original skin assets

`default.skin.json` is the built-in portable v1 manifest with no image resources.
`original-midnight/skin.json` is a complete portable sample, with one original
64×64 RGBA PNG (`assets/woven.png`, 246 bytes).

The image is a newly authored procedural woven pattern: for every pixel `(x,y)`,
let `s` be 7 when `floor((x+y)/8)` is odd, otherwise 0. Pixel RGBA is
`(11+s, 18+s, 32+s, 255)`. PNG rows use filter 0, 8-bit RGBA, and zlib compression.
It includes only IHDR, IDAT and IEND chunks. This records sufficient source and
provenance to reproduce the original artwork; no external image, score, private
user music, font or recording is included.

All manifests and the original artwork in this directory are available under
the repository's [MIT license](../LICENSE). The sample's license metadata applies
to this authored sample; it does not license future imported artwork.

See [format and renderer contract](../docs/SKIN_FORMAT.md). Validate with
`npm run validate:skin -- skins/original-midnight --strict-assets`.
