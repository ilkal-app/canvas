// @vitest-environment jsdom
import { expect, it } from 'vitest';

it('reports the original error through the browser error event', () => {
  const failure = new Error('Backend unavailable.');
  const events: ErrorEvent[] = [];
  const receive = (event: ErrorEvent): void => {
    events.push(event);
    event.preventDefault(); // Only this deliberately reported error is expected.
  };
  window.addEventListener('error', receive);
  try {
    reportError(failure);
    expect(events).toHaveLength(1);
    expect(events[0]?.error).toBe(failure);
    expect(events[0]?.message).toBe('Backend unavailable.');
  } finally {
    window.removeEventListener('error', receive);
  }
});
