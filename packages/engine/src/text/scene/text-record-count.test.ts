import { describe, expect, it, vi } from 'vitest';

import * as codepoints from '@canvas/text';

import { shapeObject } from '../../scene/__fixtures__/scene-objects.js';

import { textObject } from './__fixtures__/text-objects.js';
import { TextRecordCounts, textRecordCount } from './text-record-count.js';

describe('text record counts', () => {
  it('preserves Unicode and whitespace semantics without placement geometry', () => {
    expect(textRecordCount(textObject('t', 'a 😀\n\t\r\u00a0\ud800'))).toBe(6);
    expect(textRecordCount(textObject('t', ' \n'))).toBe(0);
    expect(textRecordCount(shapeObject('s'))).toBe(0);
  });

  it('reuses only the exact text for an ID across position and style changes', () => {
    const scan = vi.spyOn(codepoints, 'codepointAt');
    const counts = new TextRecordCounts();
    const object = textObject('t', 'abc');
    expect(counts.read(object)).toBe(3);
    const calls = scan.mock.calls.length;
    expect(counts.read({ ...object, x: 20, width: 800 })).toBe(3);
    expect(scan).toHaveBeenCalledTimes(calls);
    expect(counts.read({ ...object, text: '😀 x' })).toBe(2);
    expect(counts.read(object)).toBe(3);
    scan.mockRestore();
  });

  it('forgets removed IDs and clears the renderer lifetime', () => {
    const scan = vi.spyOn(codepoints, 'codepointAt');
    const counts = new TextRecordCounts();
    const object = textObject('t', 'abc');
    counts.read(object);
    counts.forget(object.id);
    counts.read(object);
    counts.clear();
    counts.read(object);
    expect(scan).toHaveBeenCalledTimes(9);
    scan.mockRestore();
  });

  it('does not retain zero-record objects, which have no pass slots to forget', () => {
    const scan = vi.spyOn(codepoints, 'codepointAt');
    const counts = new TextRecordCounts();
    const object = textObject('t', ' ');
    counts.read(object);
    counts.read(object);
    expect(scan).toHaveBeenCalledTimes(2);
    scan.mockRestore();
  });
});
