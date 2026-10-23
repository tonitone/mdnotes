/**
 * Calls `onChange(true)` when the inline size of `target` drops below
 * `thresholdRem` and `onChange(false)` when it grows beyond it. The initial
 * state is reported once. Returns a function that stops observing.
 * Observe a stable container, not the element whose content you change,
 * otherwise the change can trigger the observer again.
 */
export function observeCompact(target: HTMLElement, thresholdRem: number, onChange: (compact: boolean) => void): () => void {
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  let last: boolean | null = null;
  const observer = new ResizeObserver((entries) => {
    const width = entries[0]?.contentRect.width ?? target.clientWidth;
    const compact = width < thresholdRem * rem;
    if (compact !== last) {
      last = compact;
      onChange(compact);
    }
  });
  observer.observe(target);
  return () => observer.disconnect();
}
