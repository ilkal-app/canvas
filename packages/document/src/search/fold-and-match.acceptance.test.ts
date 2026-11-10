// Unicode folding and per-word prefix matching are pure search rules.
import { describe, expect, it } from 'vitest';

import { foldForSearch, matchesQuery } from './fold-and-match.js';

describe('foldForSearch', () => {
  it.each([
    ['Café', 'cafe'],
    ['ÉCOLE', 'ecole'],
    ['Ångström', 'angstrom'],
    ['Ｆｕｌｌ', 'full'],
    ['مَرْحَبًا', 'مرحبا'],
    ['שָׁלוֹם', 'שלום'],
    ['会议记录', '会议记录'],
    ['こんにちは', 'こんにちは'],
    ['한글', '한글'],
  ])('folds %s to %s', (source, expected) => {
    expect(foldForSearch(source)).toBe(expected);
  });
});

describe('matchesQuery', () => {
  it.each([
    ['Bug triage at 10:00', 'tri', true],
    ['Bug triage', 'riage', false],
    ['Café crème', 'cafe cre', true],
    ['会议记录', '记录', true],
    ['مرحبا بالعالم', 'بالع', true],
    ['Move triage to 10:00', 'triage 10', true],
    ['Move triage', 'triage zzz', false],
    ['bug-triage', 'tri', true],
    ['שלום עולם', 'עו', true],
    ['Alpha', '', false],
    ['Alpha', ' \n\t ', false],
  ] as const)('matches %j against %j as %j', (source, query, shouldMatch) => {
    expect(matchesQuery(source, query)).toBe(shouldMatch);
  });

  it('folds both the content and the query and requires every query word', () => {
    expect(matchesQuery('ÉCOLE — Café', 'eco CAF')).toBe(true);
    expect(matchesQuery('Café crème', 'cre cafe')).toBe(true);
    expect(matchesQuery('Café crème', 'cafe absent')).toBe(false);
    expect(matchesQuery('会议记录', '议记')).toBe(true);
  });
});
