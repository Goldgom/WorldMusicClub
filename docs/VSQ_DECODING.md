# Bounded DSB301 VSQ decoding

The `vsq` module decodes format-aware project data from an SMF container. It
leaves the generic MIDI validator unchanged. A source must contain ordered DM
fragments and a supported DSB301 project; the decoder never infers melody from
absent MIDI channel notes or repairs a generic MIDI byte stream.

Fragments are joined as bytes before strict CP932 decoding. Microsoft single-byte
private-use mappings A0/FD/FE/FF are supported explicitly. Invalid sequences are
errors, never replacement characters. Tests independently cover every single
byte and all 65,536 byte pairs, including validity and Unicode output.

The sole high-bit data exception is channel-zero CC6=255 after selected NRPN
55:03, inside a proven supported VSQ project. Unknown fields, event types,
sections, handles, metadata and structural/encoding failures hold conversion.

All note, singer, lyric, positional numeric, note-expression, vibrato-envelope,
pitch/sensitivity/expression/resonance curve, mixer, tempo/meter and PreMeasure
fields are typed. Source SHA, track index, EventList IDs/order and project-text
hash are provenance. The private decoder model also retains typed controller
inspection records. They must not be written into delivered clean packages;
`vsq_engine` consumes them into named commands, and `vsq_clean` uses separate
controller-free authoring DTOs.

Project ticks remain authoritative. PreMeasure is a separate transform derived
from the actual meter map; changes within a premeasure bar are held. Exact
microseconds integrate every tempo segment. Vibrato handle length and note delay
remain independent, including a difference of one tick/one original pulse.

A canonical score is an explicitly derived base-note view, with every authored
note and singer assignment, exact rational quarter times and no retained source
content. No key signature is invented. Source descriptors do not establish
voicebank identity or availability. The typed project always retains mandatory
interpretation limitations; successful decoding is not a compatible vocal
renderer or acoustic-equivalence claim.

Public fixtures are wholly authored test data. Supplied score material and
private audit outputs must remain outside repository fixtures and CI.

`encoding_rs = 0.8.35` is locked by its registry checksum. Its license is
`(Apache-2.0 OR MIT) AND BSD-3-Clause`; the existing notice collector includes
COPYRIGHT, LICENSE-APACHE, LICENSE-MIT and LICENSE-WHATWG. Platform distribution
acceptance still needs its normal full notice checks.

Primary format investigations are explicitly provisional:

- [Noocyte's VSQ investigation](https://www5d.biglobe.ne.jp/~noocyte/Programming/FileFormat/VSQ.html)
- [Cadencii author's project-format notes](https://w.atwiki.jp/boare/pages/16.html)
- [Microsoft CP932 mapping](https://www.unicode.org/Public/MAPPINGS/VENDORS/MICSFT/WINDOWS/CP932.TXT)
- [WHATWG Shift_JIS decoder](https://encoding.spec.whatwg.org/#shift_jis-decoder)
