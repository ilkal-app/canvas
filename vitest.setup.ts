// Every project's setup: after each test, the worker gives its event loop a turn, so it reads
// what Vitest's main process has answered it.
//
// A worker reports each test to the main process over RPC and fails the run if no answer comes
// within 60 s ("Timeout calling onTaskUpdate"). Between tests the runner moves on through
// promises alone, so a file of synchronous tests never lets the worker read its I/O: the answer
// waits until the file ends. engine's admission acceptance file is 19 s of such tests on a laptop
// and passed 60 s on a 4-vCPU GitHub runner, failing a run in which every test had passed. Two
// immediates put a poll phase between them, where an answer that has arrived is read, so the
// longest wait is one test or hook, not one file: a single test of over 60 s still fails.
import { afterEach } from 'vitest';

// The platform's own, taken before any test can fake it (`vi.useFakeTimers` replaces the global
// for as long as a test keeps fake timers, which may outlast the test).
const { setImmediate } = globalThis;

afterEach(async () => {
  await new Promise<void>((resolve) => {
    setImmediate(() => {
      setImmediate(resolve);
    });
  });
});
