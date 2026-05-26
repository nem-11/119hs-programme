import { useEffect, useRef } from 'react';

/** Re-run callback when the tab/window regains focus (§4.5 — connected programme views). */
export function useRefreshOnFocus(onRefresh) {
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  useEffect(() => {
    const run = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      onRefreshRef.current?.();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') run();
    };
    window.addEventListener('focus', run);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', run);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);
}

/** Poll while the document is visible; pauses when hidden. */
export function usePollingWhenVisible(onRefresh, intervalMs) {
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  useEffect(() => {
    let id = null;
    const stop = () => {
      if (id != null) {
        clearInterval(id);
        id = null;
      }
    };
    const start = () => {
      if (id != null || document.visibilityState === 'hidden') return;
      id = setInterval(() => {
        if (document.visibilityState === 'visible') onRefreshRef.current?.();
      }, intervalMs);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') start();
      else stop();
    };
    onVisibility();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [intervalMs]);
}

export function formatLastRefreshed(at) {
  if (!at || !(at instanceof Date) || Number.isNaN(at.getTime())) return '';
  const sec = Math.floor((Date.now() - at.getTime()) / 1000);
  if (sec < 15) return 'Updated just now';
  if (sec < 60) return `Updated ${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `Updated ${min} min ago`;
  return `Updated at ${at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}
