import { useCallback, useEffect, useRef } from 'react';

/** Stable debounced callback — waits `delayMs` after the last invoke. */
export function useDebouncedCallback(fn, delayMs = 400) {
  const fnRef = useRef(fn);
  const timerRef = useRef(null);
  fnRef.current = fn;

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  return useCallback((...args) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      fnRef.current(...args);
    }, delayMs);
  }, [delayMs]);
}
