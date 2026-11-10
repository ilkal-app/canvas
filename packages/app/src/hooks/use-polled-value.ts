import { useEffect, useRef, useState } from 'react';

function isPromiseLike<T>(value: T | PromiseLike<T>): value is PromiseLike<T> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

/**
 * Reads a value now and then every `intervalMs`, re-rendering with each reading: how the
 * developer overlay follows the engine's frame statistics at 4 Hz rather than every frame, so
 * that watching the frame rate cannot cost frames. A reader may answer at once or with a
 * promise (the engine in a worker answers a message later); while a promise is pending no new
 * read starts (a slow engine is not sent a queue of reads), a promise that rejects leaves the
 * last reading in place, and one that settles after the reader went away is ignored. The
 * latest `read` is always used; a reader that appears is read at once, then the interval
 * starts; it stops when the reader goes away or the component unmounts.
 *
 * @param read - Produces the current value, or a promise of it; `undefined` when there is
 *   nothing to read.
 * @param intervalMs - Time between readings, in ms.
 * @returns The latest reading, or `undefined` without a reader or before the first answer.
 */
export function usePolledValue<T>(
  read: (() => T | PromiseLike<T>) | undefined,
  intervalMs: number,
): T | undefined {
  const readRef = useRef(read);
  useEffect(() => {
    readRef.current = read;
  }, [read]);
  const [value, setValue] = useState<T | undefined>(undefined);
  const hasReader = read !== undefined;
  useEffect(() => {
    if (!hasReader) return undefined;
    let isPolling = true;
    let isReading = false;
    const poll = (): void => {
      if (isReading) return;
      const result = readRef.current?.();
      if (result === undefined) return;
      if (!isPromiseLike(result)) {
        setValue(result);
        return;
      }
      isReading = true;
      result.then(
        (reading) => {
          isReading = false;
          if (isPolling) setValue(reading);
        },
        () => {
          isReading = false;
        },
      );
    };
    poll();
    const timer = setInterval(poll, intervalMs);
    return () => {
      isPolling = false;
      clearInterval(timer);
      setValue(undefined);
    };
  }, [hasReader, intervalMs]);
  return hasReader ? value : undefined;
}
