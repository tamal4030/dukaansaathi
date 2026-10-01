import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { api, setTokenGetter } from '../lib/api';
import { isAuthConfigured, supabase } from '../lib/supabase';
import type { AuthUser, LanguageCode } from '../lib/types';

export interface AuthValue {
  session: Session | null;
  profile: AuthUser | null;
  loading: boolean;
  signedIn: boolean;
  /** True when signed in through Google (required before submitting an order). */
  isGoogleUser: boolean;
  isBusinessUser: boolean;
  configured: boolean;
  signUpBusiness: (email: string, password: string, ownerName: string) => Promise<{ needsConfirmation: boolean }>;
  signInBusiness: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  updateProfile: (body: { fullName?: string; phone?: string; locale?: LanguageCode; emailNotificationsOptIn?: boolean }) => Promise<AuthUser>;
}

const AuthContext = createContext<AuthValue | null>(null);

const NOT_CONFIGURED_MESSAGE =
  'Sign-in is not configured for this deployment. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to the frontend, and SUPABASE_URL plus SUPABASE_ANON_KEY to the backend.';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  // The API client asks for the token lazily: nothing is stored by the client.
  useEffect(() => {
    setTokenGetter(async () => {
      if (!supabase) return null;
      const { data } = await supabase.auth.getSession();
      return data.session?.access_token ?? null;
    });
  }, []);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!cancelled) setSession(data.session ?? null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
    };
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!supabase) {
      setProfile(null);
      return;
    }
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      setProfile(null);
      return;
    }
    try {
      const result = await api.account.profile();
      setProfile(result.profile);
    } catch {
      // The backend may not know this user yet (or the token is stale).
      setProfile(null);
    }
  }, []);

  useEffect(() => {
    if (loading) return;
    if (!session) {
      setProfile(null);
      return;
    }
    void refreshProfile();
  }, [session, loading, refreshProfile]);

  const signUpBusiness = useCallback(async (email: string, password: string, ownerName: string) => {
    if (!supabase) throw new Error(NOT_CONFIGURED_MESSAGE);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: ownerName, account_type: 'business' } },
    });
    if (error) throw new Error(error.message);
    // With email confirmation enabled Supabase returns no session.
    return { needsConfirmation: !data.session };
  }, []);

  const signInBusiness = useCallback(async (email: string, password: string) => {
    if (!supabase) throw new Error(NOT_CONFIGURED_MESSAGE);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
  }, []);

  const signInWithGoogle = useCallback(async () => {
    if (!supabase) throw new Error(NOT_CONFIGURED_MESSAGE);
    const redirect = `${window.location.origin}/auth/customer`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: redirect, queryParams: { prompt: 'select_account' } },
    });
    if (error) throw new Error(error.message);
  }, []);

  const signOut = useCallback(async () => {
    if (supabase) await supabase.auth.signOut();
    setProfile(null);
    setSession(null);
  }, []);

  const updateProfile = useCallback<AuthValue['updateProfile']>(async (body) => {
    const result = await api.account.update(body);
    setProfile(result.profile);
    return result.profile;
  }, []);

  const value = useMemo<AuthValue>(() => {
    const provider = session?.user?.app_metadata?.provider as string | undefined;
    return {
      session,
      profile,
      loading,
      signedIn: Boolean(session),
      isGoogleUser: provider === 'google',
      isBusinessUser: profile?.role === 'BUSINESS_OWNER' || profile?.role === 'ADMIN',
      configured: isAuthConfigured,
      signUpBusiness,
      signInBusiness,
      signInWithGoogle,
      signOut,
      refreshProfile,
      updateProfile,
    };
  }, [session, profile, loading, signUpBusiness, signInBusiness, signInWithGoogle, signOut, refreshProfile, updateProfile]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
