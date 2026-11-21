import { useEffect, useRef, useState } from "react";
import { settlePromise } from "@t3tools/client-runtime/state/runtime";
import { useStableCallback } from "../../../../hooks/useStableCallback";
export type SearchPage<T> = { results: readonly T[]; total?: number; nextCursor: string | null };
type Snapshot<T> = {
  query: string | null;
  items: readonly T[];
  total: number | undefined;
  cursor: string | null;
  pending: boolean;
  failed: string | null;
};
/** Source createRemoteSearch: 150ms debounce, cursor-preserving retry, stale-reply fence and ID deduplication. */
export function useSearchPages<T>(
  query: string | null,
  search: (query: string, cursor?: string) => Promise<SearchPage<T>>,
  key: (item: T) => string,
) {
  const fetch = useStableCallback(search),
    identity = useStableCallback(key);
  const generation = useRef(0),
    lock = useRef(false);
  const [snapshot, setSnapshot] = useState<Snapshot<T>>({
    query: null,
    items: [],
    total: undefined,
    cursor: null,
    pending: false,
    failed: null,
  });
  const failedCursor = useRef<string | undefined>(undefined);
  const perform = useStableCallback(
    async (value: string, cursor: string | undefined, request: number) => {
      if (lock.current || request !== generation.current) return;
      lock.current = true;
      failedCursor.current = cursor;
      setSnapshot((old) => ({ ...old, pending: true, failed: null }));
      const settled = await settlePromise(async () => {
        const page = await fetch(value, cursor);
        if (request !== generation.current) return;
        setSnapshot((old) => {
          const items = cursor === undefined ? [] : [...old.items],
            ids = new Set(items.map(identity));
          for (const item of page.results)
            if (!ids.has(identity(item))) {
              items.push(item);
              ids.add(identity(item));
            }
          return {
            query: value,
            items,
            total: page.total,
            cursor: page.nextCursor,
            pending: false,
            failed: null,
          };
        });
      });
      if (settled._tag === "Failure" && request === generation.current)
        setSnapshot((old) => ({
          ...old,
          pending: false,
          failed: "Search could not be completed.",
        }));
      if (request === generation.current) lock.current = false;
    },
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Remote search follows an external query with the exact source debounce and invalidates responses after query/scope change or unmount.
  useEffect(() => {
    const request = ++generation.current;
    lock.current = false;
    // oxlint-disable-next-line react/set-state-in-effect -- Changing the remote query discards its previous page and starts the debounce.
    setSnapshot({
      query,
      items: [],
      total: undefined,
      cursor: null,
      pending: query !== null,
      failed: null,
    });
    if (query === null) return;
    const timer = setTimeout(() => void perform(query, undefined, request), 150);
    return () => {
      clearTimeout(timer);
      ++generation.current;
      lock.current = false;
    };
  }, [query, perform]);
  const current =
    snapshot.query === query
      ? snapshot
      : { query, items: [], total: undefined, cursor: null, pending: query !== null, failed: null };
  return {
    ...current,
    loadMore: () => {
      if (query !== null && current.cursor && !current.pending && !current.failed)
        void perform(query, current.cursor, generation.current);
    },
    retry: () => {
      if (query !== null) void perform(query, failedCursor.current, generation.current);
    },
  };
}
