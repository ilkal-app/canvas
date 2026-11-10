import { describe, expect, it } from 'vitest';

import {
  frameObject as frameObjectOf,
  shapeObject,
} from '../../scene/__fixtures__/scene-objects.js';
import {
  stickyObject,
  textObject,
} from '../../scene/segments/__fixtures__/note-and-text-passes.js';
import { connectorObject } from '../../spatial/__fixtures__/spatial-objects.js';

import { isSameTextSize, TEXT_LEVEL_OF_DETAIL, textLineHeightOf } from './text-detail.js';

describe('textLineHeightOf', () => {
  it("is a note's or a text object's tallest line: its largest font size × 1.25", () => {
    // 16-unit text has 20-unit lines: greek under 0.2 device px per unit, hidden under 0.125.
    expect(textLineHeightOf(stickyObject('note', { text: 'ab' }))).toBeCloseTo(20, 12);
    expect(textLineHeightOf(textObject('label', { text: 'ab' }))).toBeCloseTo(20, 12);
  });

  it('follows the largest run, so no line greys while a larger one would show', () => {
    const note = stickyObject('note', { text: 'abcd' });
    const [run] = note.runs;
    if (run === undefined) throw new Error('the fixture note has a run');
    const runs = [
      { length: 2, style: { ...run.style, fontSize: 8 } },
      { length: 2, style: { ...run.style, fontSize: 40 } },
    ];
    expect(textLineHeightOf({ ...note, runs })).toBeCloseTo(50, 12);
  });

  it('measures nothing for an object without text or without runs, which stays in full', () => {
    expect(textLineHeightOf(shapeObject('r'))).toBe(0);
    expect(textLineHeightOf({ ...stickyObject('note'), runs: [] })).toBe(0);
    expect(TEXT_LEVEL_OF_DETAIL.rule.kind).toBe('text');
    expect(TEXT_LEVEL_OF_DETAIL.sizeOf(stickyObject('note', { text: 'ab' }))).toBeCloseTo(20, 12);
  });
});

describe('isSameTextSize of connectors', () => {
  it("measures a connector's label by its largest font size, as a shape's", () => {
    const [run] = stickyObject('note', { text: 'ab' }).runs;
    if (run === undefined) throw new Error('the fixture note has a run');
    const connector = { ...connectorObject('c'), label: { text: 'ab', runs: [run] } };
    expect(isSameTextSize(connector, { ...connector, x: 40 })).toBe(true);
    const larger = { ...run, style: { ...run.style, fontSize: run.style.fontSize + 10 } };
    expect(isSameTextSize(connector, { ...connector, label: { text: 'ab', runs: [larger] } })).toBe(
      false,
    );
    expect(isSameTextSize(connector, { ...connectorObject('c'), label: null })).toBe(false);
  });
});

describe('isSameTextSize', () => {
  it('tells a moved or recoloured text apart from one whose largest font size changed', () => {
    const note = stickyObject('note', { text: 'ab' });
    const [run] = note.runs;
    if (run === undefined) throw new Error('the fixture note has a run');
    const moved = structuredClone({ ...note, x: 50, y: 20, text: 'abc' });
    expect(isSameTextSize(note, moved)).toBe(true);
    const larger = { ...note, runs: [{ ...run, style: { ...run.style, fontSize: 30 } }] };
    expect(isSameTextSize(note, larger)).toBe(false);
    const text = textObject('label', { text: 'ab' });
    expect(isSameTextSize(text, { ...text, x: 9 })).toBe(true);
    expect(isSameTextSize(text, note)).toBe(false);
    // A shape's label by its largest font size; a shape without one measures 0.
    const [labelRun] = note.runs;
    if (labelRun === undefined) throw new Error('the fixture note has a run');
    const label = { text: 'ab', runs: [labelRun] };
    const labelled = shapeObject('r', { label });
    expect(isSameTextSize(labelled, { ...labelled, x: 30, width: 400 })).toBe(true);
    const largerLabel = {
      ...labelled,
      label: { ...label, runs: [{ ...labelRun, style: { ...labelRun.style, fontSize: 60 } }] },
    };
    expect(isSameTextSize(labelled, largerLabel)).toBe(false);
    expect(isSameTextSize(shapeObject('r'), shapeObject('r'))).toBe(true);
    expect(isSameTextSize(shapeObject('r'), labelled)).toBe(false);
    // Any other type is measured again, whatever changed.
    expect(isSameTextSize(frameObjectOf('f'), frameObjectOf('f'))).toBe(false);
    expect(TEXT_LEVEL_OF_DETAIL).toMatchObject({ isSameSize: isSameTextSize });
  });
});
