# Noto Color Emoji (COLRv1)

- `400.ttf`: `Noto-COLRv1.ttf` from [googlefonts/noto-emoji](https://github.com/googlefonts/noto-emoji) at commit `1ffdd21391dd1f25c081fa93a9dea0c7c029442b` (path `2D/fonts/Noto-COLRv1.ttf`), unchanged. It is Noto Color Emoji Version 2.057 (`noto-emoji:20260911`), 5,038,236 bytes, sha256 `b8e25ea68db82f9e4d0aee921f4420be2be39887bd5c893a2ad98710531f9d0c`. This is the face the app and the render service draw emoji with.
- `LICENSE.txt`: `2D/fonts/LICENSE` from the same commit (SIL Open Font License 1.1), sha256 `6a73f9541c2de74158c0e7cf6b0a58ef774f5a780bf191f2d7ec9cc53efe2bf2`.
- `400-metrics.ttf`: the same font without its colour paint, for measuring.
  - It was made with fontTools 4.61.1: delete `COLR` and `CPAL`, then subset to every codepoint with every layout feature and all names, keeping the `.notdef` outline, every glyph id (`retain_gids`) and no hinting. Then copy the original `cmap` table back, since the subsetter drops its format 14 subtable, and with it the variation sequences (VS16) that HarfBuzz forms from it.
  - Glyphs that only the colour paint used (its layers) are emptied, with zero advance.
  - The 4,052 glyphs shaping can reach keep their ids, outlines and advances, along with the cmap, GSUB and vertical metrics. It therefore shapes to the same glyph ids and measures exactly as `400.ttf` does, which the acceptance test beside the bundled font files checks.
  - Size: 385,760 bytes, sha256 `5c4cceff049a81c9007df9ee25710cc06bf38f3cbd0101f348e85a9227ee0eba`.
  - The MCP server measures with it (the catalogue face's `metricsUrl`), so its image never carries the 5 MB colour font. It is a modified version under the same OFL-1.1, which the licence allows; Noto declares no Reserved Font Name.
