# Limited MusicXML import and standard headers

The Rust importer reads a supported subset of UTF-8 `score-partwise` MusicXML.
It preserves the exact original UTF-8 text in `source.content`, including a
leading BOM, CRLF line endings and the document type declaration. Original bytes
also determine the stable source-derived score/note IDs; the ID is not a
cryptographic integrity assertion. Headerless imports keep their existing IDs
and behavior. Source retention does not mean every notation feature is modeled,
rendered or performed.

## Standard external-only declarations

Generic XML import and the selected score inside an MXL may contain one of these
two fixed tuples:

| Root name | PUBLIC identifier | SYSTEM identifier | Required explicit root version |
| --- | --- | --- | --- |
| `score-partwise` | `-//Recordare//DTD MusicXML 3.1 Partwise//EN` | `http://www.musicxml.org/dtds/partwise.dtd` | `3.1` |
| `score-partwise` | `-//Recordare//DTD MusicXML 4.0 Partwise//EN` | `http://www.musicxml.org/dtds/partwise.dtd` | `4.0` |

The declaration must be external-only: `<!DOCTYPE score-partwise PUBLIC
"public identifier" "system identifier">`. Ordinary XML whitespace, multiline
formatting and either matching quote style are supported around the fixed
identifiers. A bounded recognizer finds it in the prolog, after an optional BOM,
XML declaration and comments, within 64 KiB. The root must be unprefixed and have
the matching explicit `version`. Unknown identifiers, SYSTEM-only declarations,
internal subsets (even empty ones), entity declarations, repeated declarations,
other roots and missing/mismatched versions are refused. Existing headerless
version handling is unchanged.

Only a separate parsing projection omits the recognized declaration, replacing
its characters with equal-length XML whitespace while preserving line endings
and parser offsets. The original is neither rewritten nor normalized. The XML
parser still uses `allow_dtd: false` with no resolver. Nothing reads the URL,
downloads a DTD, consults a local DTD, or enables DTD parsing.

An import retains one `musicxml_header_normalized` observation in
`source.import_diagnostics`. It explains that no DTD was loaded or validated and
that external entities, DTD defaults and attribute-type normalization are not
applied. Recompilation labels it as a retained observation; canonical JSON and
library backups preserve it without accumulating duplicate copies.

This is header compatibility within the existing importer, not complete
MusicXML validation. DTD/ISO Latin named entities such as `&eacute;` and `&nbsp;`
still fail; Unicode text, XML's predefined references and numeric character
references remain usable. The importer explicitly supplies its existing
barline-location default of `right`; it does not derive defaults from a DTD.
Beam, slur, tremolo and other unsupported notation details remain in the source
with source-only warnings, not new canonical or playback semantics. Existing
musical, external-resource, size and source-retention restrictions still apply.

## Other paths remain separate

- MXL `container.xml` still rejects all DTD/entity declarations. The selected
  MusicXML uses the policy above, while the complete original ZIP and exact
  selected XML remain in the MXL source envelope
- The Audiveris 5.11 review bridge retains its existing exact ProxyMusic 4.0.3
  normalization policy and then uses the headerless parser policy. Generic 3.1
  or 4.0 header acceptance does not broaden that bridge. Generic import still
  rejects the 4.0.3 header, and recognized engine drafts remain unplayable until
  explicit manual review
- Browser engraving still rejects DTD declarations. Its input is generated
  headerless MusicXML from the canonical Rust exporter, not retained raw XML
- Existing curated import copies, edition IDs, conversion records, checksums
  and provenance remain unchanged. Newly importing the raw converter file has
  different source-derived IDs from importing its historical headerless copy

## Regression evidence

Rust tests compare the licensed D768 raw converter XML (139,136 bytes) with its
existing import copy (139,014 bytes): all 334 written events and 321 sounding
events agree after explicitly mapping source-derived IDs. The complete canonical
comparison includes spelling, multiplicity, rests, exact rational onset/duration,
voice, staff, velocity, ties, maps, measures and repeats. Original duet fixtures
exercise 4.0, BOM/CRLF, tabs, multiline/single-quoted declarations, MXL retention,
JSON/recompile observations and headerless export/reimport behavior. Small
parser-conformance cases keep the declaration grammar and version requirements
narrow.

The real Rust-backed full-app browser suite registers upload, exact retained
source download, generated notation export/reimport, canonical JSON and library
backup/restore cases for both standard versions and the header-bearing MXL.
Browser acceptance requires that hosted suite to pass for the implementation's
exact commit; unit tests alone do not establish browser behavior.

Primary references: [MusicXML 4.0 hello-world declaration](https://www.w3.org/2021/06/musicxml40/tutorial/hello-world/),
[official MusicXML catalog](https://www.w3.org/2021/06/musicxml40/listings/catalog.xml/),
[MusicXML 3.1 partwise DTD](https://raw.githubusercontent.com/w3c/musicxml/v3.1/schema/partwise.dtd),
[MusicXML 4.0 partwise DTD](https://raw.githubusercontent.com/w3c/musicxml/v4.0/schema/partwise.dtd),
and [XML 1.0 document types and non-validating processors](https://www.w3.org/TR/REC-xml/).
