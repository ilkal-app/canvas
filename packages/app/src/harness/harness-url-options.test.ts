import { describe, expect, it } from 'vitest';

import { parseHarnessUrlOptions } from './harness-url-options.js';

describe('parseHarnessUrlOptions', () => {
  it('reads the keyboard platform and the theme preference from the query string', () => {
    expect(parseHarnessUrlOptions('?platform=other&theme=dark')).toEqual({
      platform: 'other',
      initialThemePreference: 'dark',
    });
  });

  it('leaves out what the query string does not set', () => {
    expect(parseHarnessUrlOptions('')).toEqual({});
    expect(parseHarnessUrlOptions('?platform=mac')).toEqual({ platform: 'mac' });
  });

  it('rejects an unknown platform or theme instead of silently using the default', () => {
    expect(() => parseHarnessUrlOptions('?platform=windows')).toThrow(/platform "windows"/);
    expect(() => parseHarnessUrlOptions('?theme=sepia')).toThrow(/theme "sepia"/);
  });

  it('reads which engine host to mount, and rejects one it does not know', () => {
    expect(parseHarnessUrlOptions('?engine=worker')).toEqual({ engine: 'worker' });
    expect(parseHarnessUrlOptions('?engine=main')).toEqual({ engine: 'main' });
    expect(() => parseHarnessUrlOptions('?engine=gpu')).toThrow(/engine host "gpu"/);
  });

  it('reads which board the engine starts with, and rejects one it does not know', () => {
    expect(parseHarnessUrlOptions('?engine=worker&content=empty')).toEqual({
      engine: 'worker',
      board: 'empty',
    });
    expect(parseHarnessUrlOptions('?content=demo')).toEqual({ board: 'demo' });
    expect(parseHarnessUrlOptions('?content=selection-cap')).toEqual({ board: 'selection-cap' });
    expect(() => parseHarnessUrlOptions('?content=large')).toThrow(/content "large"/);
    expect(parseHarnessUrlOptions('?board=team-plan')).toEqual({});
  });

  it('reads the GPU backend to try first, and rejects one it does not know', () => {
    expect(parseHarnessUrlOptions('?engine=worker&backend=webgl2')).toEqual({
      engine: 'worker',
      backend: 'webgl2',
    });
    expect(() => parseHarnessUrlOptions('?backend=metal')).toThrow(/backend "metal"/);
  });

  it('reads the worker probe the default shell should see fail, and rejects anything else', () => {
    expect(parseHarnessUrlOptions('?workerProbe=fail')).toEqual({ workerProbe: 'fail' });
    expect(() => parseHarnessUrlOptions('?workerProbe=pass')).toThrow(/worker probe "pass"/);
  });

  it('reads the token sheet view, and rejects a view it does not know', () => {
    expect(parseHarnessUrlOptions('?view=tokens&theme=light')).toEqual({
      view: 'tokens',
      initialThemePreference: 'light',
    });
    expect(() => parseHarnessUrlOptions('?view=home')).toThrow(/view "home"/);
  });

  it('reads the field states view', () => {
    expect(parseHarnessUrlOptions('?view=fields&theme=dark')).toEqual({
      view: 'fields',
      initialThemePreference: 'dark',
    });
  });

  it('reads the loading shell, and rejects any other value', () => {
    expect(parseHarnessUrlOptions('?loading=1')).toEqual({ isLoading: true });
    expect(() => parseHarnessUrlOptions('?loading=yes')).toThrow(/loading "yes"/);
  });

  it('reads the engine churn budget, and rejects any other value', () => {
    expect(parseHarnessUrlOptions('?churnBudget=on')).toEqual({ isChurnBudgeted: true });
    expect(() => parseHarnessUrlOptions('?churnBudget=off')).toThrow(/churnBudget "off"/);
  });

  it('reads the shell chrome, and rejects one it does not know', () => {
    expect(parseHarnessUrlOptions('?chrome=floating')).toEqual({ whiteboardChrome: 'floating' });
    expect(parseHarnessUrlOptions('?chrome=classic')).toEqual({ whiteboardChrome: 'classic' });
    expect(() => parseHarnessUrlOptions('?chrome=docked')).toThrow(/chrome "docked"/);
  });

  it('reads the board mode, and rejects one it does not know', () => {
    expect(parseHarnessUrlOptions('?mode=uiux')).toEqual({ mode: 'uiux' });
    expect(parseHarnessUrlOptions('?mode=slides')).toEqual({ mode: 'slides' });
    expect(() => parseHarnessUrlOptions('?mode=design')).toThrow(/mode "design"/);
  });

  it("reads the shell's own fonts, and rejects any other set", () => {
    expect(parseHarnessUrlOptions('?fonts=neutral')).toEqual({ fonts: 'neutral' });
    expect(() => parseHarnessUrlOptions('?fonts=rand')).toThrow(/fonts "rand"/);
  });
});
