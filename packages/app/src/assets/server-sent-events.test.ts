import { describe, expect, it } from 'vitest';

import { EventStreamParser } from './server-sent-events.js';

describe('EventStreamParser', () => {
  it('reads the service’s events: id, name and data, dispatched by a blank line', () => {
    const parser = new EventStreamParser();
    expect(parser.push('id: 3\nevent: asset\ndata: {"a":1}\n\n')).toEqual([
      { id: '3', event: 'asset', data: '{"a":1}' },
    ]);
    expect(parser.lastEventId).toBe('3');
  });

  it('joins events split across chunks anywhere, CRLF included', () => {
    const parser = new EventStreamParser();
    const chunks = ['id: 1\r', '\nevent: as', 'set\r\ndata: x\r', '\n\r', '\n'];
    const events = chunks.flatMap((chunk) => parser.push(chunk));
    expect(events).toEqual([{ id: '1', event: 'asset', data: 'x' }]);
  });

  it('skips comments, empty events and unknown fields, and joins data lines', () => {
    const parser = new EventStreamParser();
    const text = ': keepalive\n\nretry: 5\nfoo\n\ndata: a\ndata:b\ndata\n\r';
    expect(parser.push(text)).toEqual([{ id: undefined, event: 'message', data: 'a\nb\n' }]);
  });

  it('keeps the last id for later events, and ignores an id with a null character', () => {
    const parser = new EventStreamParser();
    parser.push('id: 7\ndata: a\n\n');
    expect(parser.push('id: 8\0\ndata: b\n\n')).toEqual([{ id: '7', event: 'message', data: 'b' }]);
  });
});
