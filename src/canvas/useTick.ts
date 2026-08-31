import { useEffect, useState } from 'react';

/**
 * Shared clock so provenance highlights fade without a timer per note.
 * Pass 0 to stop ticking entirely — an idle board should cost nothing.
 */
export const useTick = (ms: number): number => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (ms <= 0) return;
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
};
