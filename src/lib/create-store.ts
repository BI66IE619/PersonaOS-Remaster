type Listener = () => void;

/**
 * localStorage is an external store as far as React is concerned, so it needs a
 * subscription and a snapshot whose identity is stable between renders. The
 * `cache` string is what provides that: getSnapshot only re-parses when the
 * serialized value actually changed, so useSyncExternalStore never loops.
 *
 * `fallback` is returned during SSR. The client re-reads after hydration, which
 * is the documented behaviour for external stores.
 */
export function createStore<T>(key: string, fallback: T, revive: (raw: unknown) => T) {
  let cache: string | null = null;
  let value: T = fallback;
  const listeners = new Set<Listener>();

  const getSnapshot = (): T => {
    if (cache === null) {
      if (typeof window === "undefined") return fallback;
      try {
        const raw = localStorage.getItem(key);
        value = raw ? revive(JSON.parse(raw)) : fallback;
      } catch {
        /* malformed local state is not worth crashing over */
        value = fallback;
      }
      cache = JSON.stringify(value);
    }
    return value;
  };

  const set = (next: T) => {
    value = next;
    cache = JSON.stringify(next);
    try {
      localStorage.setItem(key, cache);
    } catch {
      /* private mode / quota — the session still works, it just won't persist */
    }
    for (const l of listeners) l();
  };

  const update = (fn: (current: T) => T) => set(fn(getSnapshot()));

  const subscribe = (onChange: Listener) => {
    listeners.add(onChange);
    const onStorage = (e: StorageEvent) => {
      if (e.key !== null && e.key !== key) return;
      cache = null;
      onChange();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(onChange);
      window.removeEventListener("storage", onStorage);
    };
  };

  return { getSnapshot, set, update, subscribe };
}
