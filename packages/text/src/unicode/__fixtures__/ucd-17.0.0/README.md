# Unicode Character Database 17.0.0

Files from <https://www.unicode.org/Public/17.0.0/ucd/>, gzipped (`gzip -9n`), unchanged otherwise:

- `LineBreak.txt.gz`, `EastAsianWidth.txt.gz`, `UnicodeData.txt.gz` and `emoji-data.txt.gz` (from `emoji/`): the sources of the generated line-break table (Line_Break, East_Asian_Width, General_Category and Extended_Pictographic), which `line-break-table.test.ts` checks against them.
- `LineBreakTest.txt.gz` (from `auxiliary/`): Unicode's conformance test for the line breaking algorithm (UAX #14).
- `DerivedBidiClass.txt.gz` (from `extracted/`), `BidiBrackets.txt.gz` and `BidiMirroring.txt.gz`: the sources of the generated bidi tables (Bidi_Class with its defaults, paired brackets, mirrored glyphs).
- `BidiTest.txt.gz` and `BidiCharacterTest.txt.gz`: Unicode's conformance tests for the bidirectional algorithm (UAX #9).
- `Scripts.txt.gz`, `ScriptExtensions.txt.gz` and `PropertyValueAliases.txt.gz`: the Script and Script_Extensions properties and the scripts' names, the sources of the generated script table that picks a fallback face, which its test checks against them.
- `emoji-sequences.txt.gz` and `emoji-zwj-sequences.txt.gz` (from <https://www.unicode.org/Public/17.0.0/emoji/>, Emoji 17.0, dated 2025-07-25): every RGI emoji sequence (basic emoji, keycaps, flags, tag and modifier sequences, and ZWJ sequences), which the emoji-presentation step's test checks it routes to the emoji face.

Copyright © Unicode, Inc. Distributed under the Unicode License v3, in [LICENSE.txt](LICENSE.txt).
