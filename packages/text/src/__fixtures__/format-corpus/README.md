# Font-format corpus

Test faces in every format the text stack must read, all derived from bundled OFL fonts by
`tooling/fonts/build-format-corpus.py` (fontTools 4.61 with brotli; rerunning it changes no file):

| Face                             | Source              | Files                                              |
| -------------------------------- | ------------------- | -------------------------------------------------- |
| `corpus-sans-regular`            | Oswald 400          | `.ttf`, `.cff.otf`, `.cff2.otf`, `.woff`, `.woff2` |
| `corpus-sans-bold`               | Oswald 700          | the same                                           |
| `corpus-serif-regular`           | Lora 400            | the same                                           |
| `corpus-sans.ttc`                | the two Corpus Sans | a collection: face 0 regular, face 1 bold          |
| `corpus-sans-regular.hmtx.woff2` | Corpus Sans 400     | WOFF2 with `hmtx` transformed too (WOFF2 §5.4)     |
| `corpus-sans-variable`           | the two Corpus Sans | `.ttf`: a variable font, wght 400–700              |

Each face is subset to Latin-1 and renamed (Corpus Sans, Corpus Serif): the OFL lets anyone modify
and redistribute the fonts, but not under a Reserved Font Name (Lora has one). The licences are
`OFL-oswald.txt` and `OFL-lora.txt`. `<face>.reference.json` holds what fontTools reads from the
TrueType face: units per em, ascent and descent (hhea), and the glyph id, advance and outline
(a decomposing RecordingPen) of sample characters, the reference every format must match.

`corpus-sans-variable.ttf` uses the two Corpus Sans faces as its masters (both are Oswald instances,
so their outlines are compatible). It has a `wght` axis from 400 to 700, with an `avar` bend that puts
550 where 600 would be, `gvar` outlines, `HVAR` advances and three named instances: Regular 400,
Medium 550 and Bold 700. `corpus-sans-variable.reference.json` lists its axes and instances, and,
under `at`, the same reference as the other faces at wght 400, 550 and 700, from fontTools'
instancer. Nothing in it is downloaded: it is built from the corpus's own OFL faces.
