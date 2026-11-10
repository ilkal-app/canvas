import { describe, expect, it } from 'vitest';

import type { ParagraphStyle } from '@canvas/schema';

import { createEditorState, selectedContent } from '../editor-state.js';
import { insertStyled } from '../editor.js';

import { BASE, runsOf } from './__fixtures__/text-styles.js';
import { parseRunsPayload, serializeRunsPayload } from './runs-payload.js';

describe('the runs flavour with lists and decorations', () => {
  it('round-trips paragraph styles and decoration flags', () => {
    const payload = {
      text: 'ab\ncd',
      runs: runsOf([2, { ...BASE, underline: true }], [3, { ...BASE, strikethrough: true }]),
      paragraphs: [{ list: 'bullet' }, { list: 'numbered', level: 1 }] as ParagraphStyle[],
    };
    expect(parseRunsPayload(serializeRunsPayload(payload))).toEqual(payload);
  });

  it('drops paragraph styles that do not match the text, and writes none when all are plain', () => {
    const json = JSON.stringify({
      text: 'ab',
      runs: runsOf([2, BASE]),
      paragraphs: [{ list: 'bullet' }, {}],
    });
    expect(parseRunsPayload(json)).not.toHaveProperty('paragraphs');
    const bad = JSON.stringify({ text: 'ab', runs: runsOf([2, BASE]), paragraphs: [{ level: 2 }] });
    expect(parseRunsPayload(bad)).not.toHaveProperty('paragraphs');
    const plain = { text: 'a\nb', runs: runsOf([3, BASE]), paragraphs: [{}, {}] };
    expect(JSON.parse(serializeRunsPayload(plain))).not.toHaveProperty('paragraphs');
  });

  it('copies the selected paragraphs’ styles and pastes them onto new paragraphs', () => {
    const source = {
      ...createEditorState('a\nb\nc', runsOf([5, BASE]), 0, [
        {},
        { list: 'bullet' },
        { list: 'numbered' },
      ]),
      anchor: 2,
      caret: 5,
    };
    const copied = selectedContent(source);
    expect(copied?.paragraphs).toEqual([{ list: 'bullet' }, { list: 'numbered' }]);
    // Pasted at the start of a plain empty line: both pasted styles land.
    const target = createEditorState('', runsOf([0, BASE]), 0);
    const pasted = copied === undefined ? target : insertStyled(target, copied);
    expect(pasted.text).toBe('b\nc');
    expect(pasted.paragraphs).toEqual([{ list: 'bullet' }, { list: 'numbered' }]);
    // Pasted inside a line: that line keeps its style, the new one takes the pasted.
    const inside = createEditorState('xy', runsOf([2, BASE]), 1);
    const into = copied === undefined ? inside : insertStyled(inside, copied);
    expect(into.paragraphs).toEqual([{}, { list: 'numbered' }]);
  });
});
