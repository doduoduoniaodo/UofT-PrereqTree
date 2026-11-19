import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'prereqtree:completed';

function readInitial(): Set<string> {
  const shared = new URLSearchParams(window.location.search).get('done');
  if (shared !== null) return new Set(shared.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean));
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return new Set(JSON.parse(saved) as string[]);
  } catch {
    /* storage unavailable */
  }
  return new Set();
}

/** Completed courses, persisted to localStorage and shareable via ?done=. */
export function useProgress() {
  const [done, setDone] = useState<Set<string>>(readInitial);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...done]));
    } catch {
      /* storage unavailable */
    }
  }, [done]);

  const toggle = useCallback((code: string) => {
    setDone((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }, []);

  const clear = useCallback(() => setDone(new Set()), []);

  return { done, toggle, clear };
}

export function readTargetsFromUrl(): string[] {
  const raw = new URLSearchParams(window.location.search).get('course') || '';
  return [...new Set(raw.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean))];
}

export function writeUrl(targets: string[], done?: Set<string>) {
  const params = new URLSearchParams();
  if (targets.length) params.set('course', targets.join(','));
  if (done && done.size) params.set('done', [...done].sort().join(','));
  const qs = params.toString();
  return `${window.location.origin}${window.location.pathname}${qs ? `?${qs}` : ''}`;
}
