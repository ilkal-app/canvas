import { describe, expect, it } from 'vitest';

import type { ConnectorObject, ObjectId } from '@canvas/schema';

import { shapeObject } from '../scene/__fixtures__/scene-objects.js';
import { connectorObject } from '../spatial/__fixtures__/spatial-objects.js';

import { ConnectorLinks } from './connector-links.js';

const id = (value: string): ObjectId => value as ObjectId;

function attached(connectorId: string, from: string, to: string | null): ConnectorObject {
  return {
    ...connectorObject(connectorId),
    from: { kind: 'object', objectId: id(from), anchor: null },
    to:
      to === null
        ? { kind: 'point', x: 0, y: 0 }
        : { kind: 'object', objectId: id(to), anchor: null },
  };
}

describe('ConnectorLinks', () => {
  it('finds the connectors on each target', () => {
    const links = new ConnectorLinks();
    links.observe(id('c1'), attached('c1', 'a', 'b'));
    links.observe(id('c2'), attached('c2', 'a', null));
    expect([...links.connectorsOn(id('a'))].sort()).toEqual(['c1', 'c2']);
    expect([...links.connectorsOn(id('b'))]).toEqual(['c1']);
    expect([...links.connectorsOn(id('z'))]).toEqual([]);
    expect(links.size).toBe(2);
  });

  it('keeps what it recorded when a connector changes but its targets do not', () => {
    const links = new ConnectorLinks();
    links.observe(id('c'), attached('c', 'a', 'b'));
    links.observe(id('c'), { ...attached('c', 'a', 'b'), route: 'curved' });
    expect([...links.connectorsOn(id('a'))]).toEqual(['c']);
    expect(links.size).toBe(1);
  });

  it('moves a connector between targets as its ends change', () => {
    const links = new ConnectorLinks();
    links.observe(id('c'), attached('c', 'a', 'b'));
    links.observe(id('c'), attached('c', 'a', 'd'));
    expect([...links.connectorsOn(id('b'))]).toEqual([]);
    expect([...links.connectorsOn(id('d'))]).toEqual(['c']);
  });

  it('forgets a connector that is removed, detached or no longer a connector', () => {
    const links = new ConnectorLinks();
    links.observe(id('c1'), attached('c1', 'a', 'b'));
    links.observe(id('c2'), attached('c2', 'a', 'b'));
    links.observe(id('c3'), attached('c3', 'a', 'b'));
    links.observe(id('c1'), undefined);
    links.observe(id('c2'), { ...connectorObject('c2') });
    links.observe(id('c3'), shapeObject('c3'));
    expect([...links.connectorsOn(id('a'))]).toEqual([]);
    expect(links.size).toBe(0);
  });
});
