// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import type { Camera } from '@canvas/engine';
import type { ObjectId, PrincipalId } from '@canvas/schema';

import type { PlacedTraceSheet } from './trace-sheet-bounds.js';
import { DOCKED_TAB_TOP_PX, placeTabs } from './trace-sheet-placement.js';

/**
 * A layer with one tab per agent, as `TraceSheets` renders it.
 *
 * @param agents - The agents whose sheets are open.
 * @returns The layer and its tabs.
 */
function layerWith(agents: readonly string[]): { root: HTMLElement; tabs: HTMLElement[] } {
  const root = document.createElement('div');
  const tabs = agents.map((agent) => {
    const tab = document.createElement('section');
    tab.dataset.traceSheet = agent;
    tab.dataset.placed = 'false';
    root.append(tab);
    return tab;
  });
  return { root, tabs };
}

const ENGINE = { camera: () => ({ x: 0, y: 0, zoom: 1 }) as unknown as Camera };

/**
 * A sheet with bounds.
 *
 * @param agent - Its agent.
 * @returns The placed sheet.
 */
function placed(agent: string): PlacedTraceSheet {
  return {
    agentId: agent as PrincipalId,
    memberIds: ['a' as ObjectId],
    bounds: { minX: 200, minY: 300, maxX: 400, maxY: 500 },
  };
}

describe('placeTabs', () => {
  it('places a tab whose sheet has bounds at its corner', () => {
    const { root, tabs } = layerWith(['agent:helper']);
    placeTabs(root, ENGINE, [placed('agent:helper')]);
    expect(tabs[0]?.dataset.placed).toBe('true');
    expect(tabs[0]?.style.transform).toMatch(/^translate\(/);
  });

  it('docks a tab whose sheet has nothing with bounds, so Keep and Lift off stay reachable', () => {
    // An agent that made only an object-anchored comment, or an empty group.
    const { root, tabs } = layerWith(['agent:helper', 'agent:commenter', 'agent:grouper']);
    placeTabs(root, ENGINE, [placed('agent:helper')]);
    expect(tabs.map((tab) => tab.dataset.placed)).toEqual(['true', 'docked', 'docked']);
    expect(tabs[1]?.style.transform).toBe(`translate(10px, ${String(DOCKED_TAB_TOP_PX)}px)`);
    // jsdom lays nothing out (offsetHeight 0), so the second docked tab sits one gap lower.
    expect(tabs[2]?.style.transform).toBe(`translate(10px, ${String(DOCKED_TAB_TOP_PX + 8)}px)`);
  });

  it('keeps room inside the canvas for a stopped agent’s notice above its tab', () => {
    const { root, tabs } = layerWith(['agent:near-top', 'agent:docked', 'agent:working']);
    Object.defineProperty(root, 'clientWidth', { value: 800 });
    Object.defineProperty(root, 'clientHeight', { value: 600 });
    for (const tab of tabs.slice(0, 2)) {
      const notice = document.createElement('div');
      notice.dataset.traceNotice = '';
      Object.defineProperty(notice, 'offsetHeight', { value: 32 });
      tab.append(notice);
    }
    const nearTop: PlacedTraceSheet = {
      ...placed('agent:near-top'),
      bounds: { minX: 200, minY: 0, maxX: 400, maxY: 100 },
    };
    placeTabs(root, ENGINE, [nearTop, { ...nearTop, agentId: 'agent:working' as PrincipalId }]);
    // The notice (32 px) and its gap (24 px) stay inside the canvas, above the inset (10 px).
    expect(tabs[0]?.style.transform).toMatch(/^translate\(\d+px, 66px\)$/);
    expect(tabs[1]?.style.transform).toBe(
      `translate(10px, ${String(DOCKED_TAB_TOP_PX + 32 + 24)}px)`,
    );
    expect(tabs[2]?.style.transform).toMatch(/^translate\(\d+px, 10px\)$/);
  });
});
