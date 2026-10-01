import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import { isAuthConfigured } from '../lib/supabase';
import type { FeatureFlags } from '../lib/types';

interface FeaturesValue {
  flags: FeatureFlags | null;
  loading: boolean;
  /** True when the server has Supabase credentials and the browser has its keys. */
  authConfigured: boolean;
  assistantConfigured: boolean;
  voiceConfigured: boolean;
  emailConfigured: boolean;
}

const FeaturesContext = createContext<FeaturesValue | null>(null);

/**
 * The backend reports which integrations actually have credentials. The UI uses
 * this to explain missing setup instead of showing a control that cannot work.
 */
export function FeaturesProvider({ children }: { children: ReactNode }) {
  const [flags, setFlags] = useState<FeatureFlags | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api.health
      .features()
      .then((result) => {
        if (!cancelled) setFlags(result);
      })
      .catch(() => {
        if (!cancelled) setFlags(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const authConfigured = Boolean(flags?.supabaseAuth) && isAuthConfigured;

  return (
    <FeaturesContext.Provider
      value={{
        flags,
        loading,
        authConfigured,
        assistantConfigured: Boolean(flags?.assistant),
        voiceConfigured: Boolean(flags?.speechToText),
        emailConfigured: Boolean(flags?.email),
      }}
    >
      {children}
    </FeaturesContext.Provider>
  );
}

export function useFeatures(): FeaturesValue {
  const context = useContext(FeaturesContext);
  if (!context) throw new Error('useFeatures must be used inside <FeaturesProvider>');
  return context;
}
