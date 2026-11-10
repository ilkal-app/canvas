import { describe, expect, it } from 'vitest';

import type { ParagraphStyle } from '../fields/paragraph-style.js';
import { sampleObject, SAMPLE_STYLE } from '../objects/__fixtures__/object-samples.js';

import { exportBoard } from './export-board.js';
import { importBoard } from './import-board.js';
import { PORTABLE_BOARD_FORMAT } from './portable-board.js';

describe('text lists portable board', () => {
  it('round-trips decorated runs and paragraph lists on text and sticky', () => {
    const text = 'one\ntwo\nthree\nfour';
    const rich = {
      text,
      runs: [
        { length: 4, style: { ...SAMPLE_STYLE, underline: true } },
        { length: text.length - 4, style: { ...SAMPLE_STYLE, strikethrough: true } },
      ],
      paragraphs: [
        {},
        { list: 'bullet', level: 0 },
        { list: 'bullet', level: 2 },
        { list: 'numbered', level: 1 },
      ] satisfies ParagraphStyle[],
    };
    const objects = [
      sampleObject('text', 'text-list', rich),
      sampleObject('sticky', 'sticky-list', rich),
    ];
    const board = importBoard({ format: PORTABLE_BOARD_FORMAT, schemaVersion: 38, objects });
    const output = exportBoard(board);
    for (const object of output.objects) {
      expect(object).toMatchObject(rich);
    }
    expect(exportBoard(importBoard(JSON.parse(JSON.stringify(output))))).toEqual(output);
  });
});
