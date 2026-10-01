import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { PublicBusiness } from '../lib/types';

const GUEST_KEY = 'dukaansaathi.recentBusinesses';
const MAX_RECENT = 12;

function readGuestIds(): string[] {
  try {
    const raw = window.localStorage.getItem(GUEST_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string').slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

function writeGuestIds(ids: string[]) {
  try {
    window.localStorage.setItem(GUEST_KEY, JSON.stringify(ids.slice(0, MAX_RECENT)));
  } catch {
    // Storage can be unavailable; the list is a convenience, not data.
  }
}

export interface RecentBusinesses {
  ids: string[];
  businesses: PublicBusiness[];
  loading: boolean;
  record: (businessId: string) => void;
}

/**
 * Guest recently-accessed shops live in browser storage only. Signed-in
 * customers get the list from the account so it follows them across devices.
 * Browser storage is never treated as authoritative business data.
 */
export function useRecentBusinesses(options: { signedIn: boolean }): RecentBusinesses {
  const [ids, setIds] = useState<string[]>(() => (options.signedIn ? [] : readGuestIds()));
  const [businesses, setBusinesses] = useState<PublicBusiness[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    if (options.signedIn) {
      setLoading(true);
      api.account
        .recent()
        .then((result) => {
          if (cancelled) return;
          setBusinesses(result.businesses);
          setIds(result.businesses.map((business) => business.id));
        })
        .catch(() => {
          if (!cancelled) setBusinesses([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    } else {
      const guestIds = readGuestIds();
      setIds(guestIds);
      if (guestIds.length === 0) {
        setBusinesses([]);
        return;
      }
      setLoading(true);
      api.businesses
        .recent(guestIds)
        .then((result) => {
          if (!cancelled) setBusinesses(result.businesses);
        })
        .catch(() => {
          if (!cancelled) setBusinesses([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }

    return () => {
      cancelled = true;
    };
  }, [options.signedIn]);

  const record = useCallback(
    (businessId: string) => {
      setIds((current) => {
        const next = [businessId, ...current.filter((id) => id !== businessId)].slice(0, MAX_RECENT);
        if (!options.signedIn) writeGuestIds(next);
        return next;
      });
      if (options.signedIn) {
        // Sync to the account; failures are harmless for browsing.
        void api.account.recordRecent(businessId).catch(() => undefined);
      }
    },
    [options.signedIn],
  );

  return { ids, businesses, loading, record };
}
