import { useEffect, useState } from 'react';
import { liveQuery } from 'dexie';

/** Subscribes a component to a Dexie live query. */
export function useLive<T>(querier: () => Promise<T>, deps: unknown[] = []): T | undefined {
  const [value, setValue] = useState<T | undefined>(undefined);

  useEffect(() => {
    const subscription = liveQuery(querier).subscribe({
      next: setValue,
      error: (err) => console.error('Live query failed:', err),
    });
    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return value;
}
