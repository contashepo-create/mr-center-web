'use client';

import type { Session } from '@supabase/supabase-js';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getSupabase, initSupabase, isSupabaseReady } from '@/lib/supabase';
import type { MySubscription, Profile, Role } from '@/lib/types';

interface SessionState {
  ready: boolean;
  configured: boolean;
  session: Session | null;
  profile: Profile | null;
  role: Role | null;
  subscription: MySubscription | null;
  refresh: () => Promise<void>;
  reinitConnection: () => Promise<'ready' | 'missing'>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [subscription, setSubscription] = useState<MySubscription | null>(null);

  const loadProfile = useCallback(async (sess: Session | null) => {
    if (!sess || !isSupabaseReady()) {
      setProfile(null);
      setSubscription(null);
      return;
    }

    try {
      const sb = getSupabase();
      const { data: prof, error } = await sb
        .from('profiles')
        .select('*')
        .eq('id', sess.user.id)
        .maybeSingle();
      if (error) throw error;
      setProfile((prof as Profile) ?? null);

      if (prof) {
        const { data: sub } = await sb.rpc('get_my_subscription');
        setSubscription((sub as MySubscription) ?? null);
      } else {
        setSubscription(null);
      }
    } catch {
      setProfile(null);
      setSubscription(null);
    }
  }, []);

  const bootstrap = useCallback(async () => {
    setReady(false);
    const status = await initSupabase();
    setConfigured(status === 'ready');
    if (status === 'ready') {
      const sb = getSupabase();
      const { data } = await sb.auth.getSession();
      setSession(data.session ?? null);
      await loadProfile(data.session ?? null);
    }
    setReady(true);
  }, [loadProfile]);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      const status = await initSupabase();
      if (cancelled) return;
      setConfigured(status === 'ready');

      if (status === 'ready') {
        const sb = getSupabase();
        const { data } = await sb.auth.getSession();
        if (cancelled) return;
        setSession(data.session ?? null);
        await loadProfile(data.session ?? null);

        const { data: listener } = sb.auth.onAuthStateChange((_event, newSession) => {
          setSession(newSession);
          setTimeout(() => { void loadProfile(newSession); }, 0);
        });
        unsubscribe = () => listener.subscription.unsubscribe();
      }

      if (!cancelled) setReady(true);
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [loadProfile]);

  const refresh = useCallback(async () => {
    if (!isSupabaseReady()) return;
    const { data } = await getSupabase().auth.getSession();
    setSession(data.session ?? null);
    await loadProfile(data.session ?? null);
  }, [loadProfile]);

  const reinitConnection = useCallback(async (): Promise<'ready' | 'missing'> => {
    await bootstrap();
    return isSupabaseReady() ? 'ready' : 'missing';
  }, [bootstrap]);

  const signOut = useCallback(async () => {
    if (isSupabaseReady()) {
      try { await getSupabase().auth.signOut(); } catch { /* ignore */ }
    }
    setSession(null);
    setProfile(null);
    setSubscription(null);
  }, []);

  const value = useMemo<SessionState>(() => ({
    ready,
    configured,
    session,
    profile,
    role: profile?.role ?? null,
    subscription,
    refresh,
    reinitConnection,
    signOut,
  }), [ready, configured, session, profile, subscription, refresh, reinitConnection, signOut]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside SessionProvider');
  return ctx;
}
