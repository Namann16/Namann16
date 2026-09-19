import { useEffect, useRef, useState } from 'react';

/**
 * Motion helpers.
 *
 * Two rules govern everything here. Motion must carry meaning — where something came from, what
 * changed — and it must be removable without losing information, because Reduce Motion has to be
 * honoured properly rather than merely shortened.
 */

/** Whether the viewer has asked the system to reduce motion. */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Live version of the above, for components that must re-render when the setting changes. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

/**
 * Ease a number towards a new value.
 *
 * Used for the headline figures, where a value rolling from the old number to the new one answers
 * "what moved?" at a glance after a recalculation.
 *
 * Three things keep this honest in a financial tool:
 *   - it runs only when the value actually changes, and only for a few hundred milliseconds;
 *   - the accessible name always carries the FINAL value, so assistive technology never reads an
 *     intermediate figure;
 *   - with Reduce Motion on, or for a value that is null, it returns the target immediately.
 *
 * The intermediate frames are a visual transition, never data. Nothing reads them back.
 */
export function useAnimatedNumber(target: number | null, durationMs = 420): number | null {
  const reduced = useReducedMotion();
  const [display, setDisplay] = useState<number | null>(target);
  const frame = useRef<number | null>(null);
  const from = useRef<number | null>(target);

  useEffect(() => {
    if (target === null || reduced) {
      setDisplay(target);
      from.current = target;
      return;
    }
    const start = from.current;
    // Nothing to travel from: show the figure rather than counting up from an invented zero.
    if (start === null || start === target) {
      setDisplay(target);
      from.current = target;
      return;
    }

    const began = performance.now();
    const step = (now: number) => {
      const t = Math.min((now - began) / durationMs, 1);
      // The same decelerating curve the CSS uses, so movement on screen feels like one system.
      const eased = 1 - (1 - t) ** 3;
      setDisplay(start + (target - start) * eased);
      if (t < 1) {
        frame.current = requestAnimationFrame(step);
      } else {
        from.current = target;
      }
    };
    frame.current = requestAnimationFrame(step);
    return () => { if (frame.current !== null) cancelAnimationFrame(frame.current); };
  }, [target, durationMs, reduced]);

  return display;
}

/**
 * True for a moment after `value` changes, so a figure can be highlighted once when it moves.
 *
 * This is what makes a recalculation legible: rather than asking the reader to diff two screens,
 * the figures that actually changed announce themselves.
 */
export function useChangedFlash(value: unknown, holdMs = 420): boolean {
  const [flash, setFlash] = useState(false);
  const previous = useRef(value);
  useEffect(() => {
    if (previous.current === value) return;
    previous.current = value;
    if (prefersReducedMotion()) return;
    setFlash(true);
    const timer = setTimeout(() => setFlash(false), holdMs);
    return () => clearTimeout(timer);
  }, [value, holdMs]);
  return flash;
}

/**
 * Run a DOM update inside a View Transition when the browser supports one.
 *
 * The API cross-fades the old frame against the new one. Where it is unavailable — or the viewer
 * has asked for reduced motion — the update is applied directly, so behaviour never depends on it.
 */
export function withViewTransition(update: () => void): void {
  const doc = document as Document & {
    startViewTransition?: (callback: () => void) => { finished: Promise<void> };
  };
  if (typeof doc.startViewTransition !== 'function' || prefersReducedMotion()) {
    update();
    return;
  }
  doc.startViewTransition(update);
}
