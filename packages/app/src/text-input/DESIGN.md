---
name: Canvas font picker
description: Scoped reference for font browsing and explicit font replacement.
typography:
  caption:
    fontFamily: '"Rand", system-ui, sans-serif'
    fontSize: '11px'
    fontWeight: 400
    lineHeight: '14px'
  body:
    fontSize: '13px'
    fontWeight: 400
    lineHeight: '18px'
rounded:
  control: '4px'
spacing:
  space-1: '4px'
  space-2: '8px'
  space-4: '16px'
  space-5: '24px'
---

# Design System: Canvas font picker

## Overview

This reference covers `font-picker.tsx`, `local-font-picker.tsx`,
`font-replacement-dialog.tsx` and their styles. The existing Canvas inspector, shared
dialog and `../theme/` tokens remain authoritative. The browser extends the native family
field with compact search and previews; replacement reuses it inside the shared dialog.

## Colors

Use the active theme's semantic CSS properties: `--color-surface-sheet` for controls,
`--color-surface-raised` for hover, `--color-surface-pressed` for the selected source,
`--color-line-control` for borders, and `--color-focus-ring` for keyboard focus.
Primary labels use `--color-ink-primary`; categories, messages and the search placeholder
use `--color-ink-secondary`. The placeholder has full opacity so its theme contrast is retained.

## Typography

Controls and metadata use `--text-caption`. Previews use `--text-body` metrics with each
row's loaded preview family and `--font-ui` fallback. Preview text stays on one line and
ellipsizes; the family name and category remain separate from the sample.

## Layout

The field and browser use a single column with `--space-2` gaps. The browse trigger aligns
to the end. Source buttons wrap with `--space-1` gaps; search and category fields fill the
available width. Results scroll within a maximum height of 260px and use `--space-1` gaps.
Controls have a minimum height of 28px, increasing to 44px for a coarse pointer.

Replacement uses the centered narrow dialog (maximum width 560px). Below 768px, it becomes
a full-width bottom sheet with a maximum height of 90% of its container. Its scrollable
body uses `--space-5` padding and `--space-4` gaps; explanatory paragraphs wrap long family
names. The Cancel action aligns to the end. The shared dialog owns the header and close control.

## Elevation & Depth

The browser stays in the inspector flow. Tonal control states provide separation; the
font browser adds no shadow or floating overlay.
The replacement dialog inherits the shared backdrop and `--shadow-float` elevation.

## Shapes

Controls use `--radius-control`, a one-pixel control border and `--space-2` padding.
Keyboard focus uses a two-pixel outline with a two-pixel offset.

## Components

- **Family field:** retain the existing native `SelectControl` and its mixed-value behavior.
- **Source buttons:** Library, All fonts and On this computer expose selection through
  `aria-pressed`.
- **Local fonts:** the Allow local fonts button explicitly requests permission. Before
  access, explain that font files stay on this computer and others need the same font to
  edit its text. Unsupported browsers show an availability message; denied access offers
  another attempt or a library font. After access, installed families have searchable,
  bounded previews. Checking and unavailable rows are disabled; unsupported font data is
  identified as requiring static TrueType or CFF. Selecting stores the family, not the font bytes.
- **Search and category:** filtering does not commit a family choice. Search receives focus
  when the browser opens. Filtering resets the visible result count to eight.
- **Font choice:** a button pairs the family and category with a preview. Choosing closes
  the browser and commits the family. Show more adds eight results.
- **Status and dismissal:** retain loading, empty and catalogue retry states. Escape and
  Close font browser dismiss the browser and restore focus to its trigger.
- **Font replacement:** identify missing families and explain that choosing a replacement
  changes the text's font for everyone while preserving its words. A failed application
  keeps the dialog open with a status message. Cancel or closing the dialog leaves words
  and runs untouched.

## Do's and Don'ts

- **Do** reuse Canvas theme variables so each supported theme retains its intended contrast.
- **Do** preserve bounded results, wrapping source controls and coarse-pointer targets.
- **Don't** turn this scoped browser reference into a replacement for the inspector system.
- **Don't** use a font preview family for the browser's controls or metadata.
