'use client';

import type { Session } from '@supabase/supabase-js';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getSupabase, initSupabase, isSupabaseReady } from '@/lib/supabase';
import { fetchMyFeatures, type MyFeatures } from '@/lib/features';
import { claimMySession, isMySessionCurrent, registerMyStudentDevice } from '@/lib/sessionGuard';
import { clearLocalAccessSession, refreshAccessToken } from '@/lib/auth/clientSession';
import { ACCESS_REFRESH_MARGIN_MS } from '@/lib/auth/constants';
import type { MySubscription, Profile, Role } from '@/lib/types';

interface SessionState {
  ready: boolean;
  configured: boolean;
  session: Session | null;
  profile: Profile | null;
  role: Role | null;
  subscription: MySubscription | null;
  features: MyFeatures | null;
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
  const [features, setFeatures] = useState<MyFeatures | null>(null);

  const loadProfile = useCallback(async (sess: Session | null) => {
    if (!sess || !isSupabaseReady()) {
      setProfile(null);
      setSubscription(null);
      setFeatures(null);
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
      // الجلسة المستعادة لا تمر دائماً بحدث SIGNED_IN؛ سجّل جهاز الطالب
      // دون إعادة مطالبة الجلسة حتى لا تستحوذ جلسة قديمة على جلسة أحدث.
      if (prof?.role === 'student') void registerMyStudentDevice();

      if (prof) {
        const [sub, feat] = await Promise.all([
          sb.rpc('get_my_subscription'),
          fetchMyFeatures().catch(() => null),
        ]);
        setSubscription((sub.data as MySubscription) ?? null);
        setFeatures(feat);
      } else {
        setSubscription(null);
        setFeatures(null);
      }
    } catch {
      setProfile(null);
      setSubscription(null);
      setFeatures(null);
    }
  }, []);

  // يقرأ الجلسة، وإن غابت (مثلاً مسح التخزين المحلي) يحاول استردادها
  // عبر كوكيز التجديد HttpOnly قبل اعتبار المستخدم غير مسجل.
  // لا نسمح لأي خطأ في جلسة قديمة أن يمنع اكتمال شاشة التحميل.
  const loadInitialSession = useCallback(async (): Promise<Session | null> => {
    const readSession = async (): Promise<Session | null> => {
      try {
        const { data, error } = await getSupabase().auth.getSession();
        return error ? null : data.session ?? null;
      } catch {
        return null;
      }
    };

    const current = await readSession();
    if (current) return current;

    const refreshed = await refreshAccessToken();
    if (!refreshed) {
      // الجلسة المحلية لا يمكن تجديدها؛ لا نتركها لتفشل في كل زيارة لاحقة.
      clearLocalAccessSession();
      return null;
    }

    const restored = await readSession();
    if (!restored) clearLocalAccessSession();
    return restored;
  }, []);

  const bootstrap = useCallback(async () => {
    setReady(false);
    try {
      const status = await initSupabase();
      setConfigured(status === 'ready');
      if (status !== 'ready') {
        setSession(null);
        await loadProfile(null);
        return;
      }
      const sess = await loadInitialSession();
      setSession(sess);
      await loadProfile(sess);
    } catch {
      setConfigured(false);
      setSession(null);
      await loadProfile(null);
    } finally {
      setReady(true);
    }
  }, [loadProfile, loadInitialSession]);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    const initialise = async () => {
      setReady(false);
      try {
        const status = await initSupabase();
        if (cancelled) return;
        setConfigured(status === 'ready');

        if (status !== 'ready') {
          setSession(null);
          await loadProfile(null);
          return;
        }

        const sb = getSupabase();
        const sess = await loadInitialSession();
        if (cancelled) return;
        setSession(sess);
        await loadProfile(sess);
        if (cancelled) return;

        const { data: listener } = sb.auth.onAuthStateChange((_event, newSession) => {
          if (_event === 'SIGNED_IN') {
            // جلسة واحدة لكل حساب: آخر جهاز يدخل يستحوذ على الجلسة
            void claimMySession();
          }
          setSession(newSession);
          setTimeout(() => { void loadProfile(newSession); }, 0);
        });
        unsubscribe = () => listener.subscription.unsubscribe();
      } catch {
        // فشل شبكة/جلسة قديمة لا يجب أن يحبس الزائر في شاشة التحميل.
        setConfigured(false);
        setSession(null);
        await loadProfile(null);
      } finally {
        if (!cancelled) setReady(true);
      }
    };

    void initialise();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [loadProfile, loadInitialSession]);

  const refresh = useCallback(async () => {
    if (!isSupabaseReady()) return;
    const sess = await loadInitialSession();
    setSession(sess);
    await loadProfile(sess);
  }, [loadInitialSession, loadProfile]);

  const reinitConnection = useCallback(async (): Promise<'ready' | 'missing'> => {
    await bootstrap();
    return isSupabaseReady() ? 'ready' : 'missing';
  }, [bootstrap]);

  const signOut = useCallback(async () => {
    if (isSupabaseReady()) {
      try { await getSupabase().auth.signOut(); } catch { /* ignore */ }
    }
    // حتى إذا كانت الجلسة منتهية ولا يستطيع SDK قراءتها، نمسح رمز الوصول.
    clearLocalAccessSession();
    setSession(null);
    setProfile(null);
    setSubscription(null);
    setFeatures(null);
  }, []);

  // فحص دوري: (1) تجديد رمز الوصول استباقياً قبل انتهائه عبر كوكيز HttpOnly،
  // و(2) فرض جلسة واحدة لكل حساب — إن دخل الجهاز نفسه من جهاز آخر يُطرد فوراً.
  useEffect(() => {
    if (!session || !configured) return;
    let cancelled = false;

    const check = async () => {
      if (cancelled) return;
      // لا نقرأ getSession هنا: قرب انتهاء الرمز يخفيه التخزين الهجين عن SDK
      // كي لا يحاول استخدام refresh_token فارغ. نستند إلى حالة React الحالية.
      if (session.expires_at && session.expires_at * 1000 - Date.now() < ACCESS_REFRESH_MARGIN_MS) {
        const ok = await refreshAccessToken();
        if (!ok) {
          if (!cancelled) await signOut();
          return;
        }
        if (!cancelled) await refresh();
      }
      if (cancelled) return;
      const current = await isMySessionCurrent();
      if (cancelled || current) return;
      // فقد هذا الجهاز جلسته: تسجيل خروج فوري
      await signOut();
    };

    void check();
    const timer = setInterval(() => { void check(); }, 30000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [session, configured, signOut, refresh]);

  const value = useMemo<SessionState>(() => ({
    ready,
    configured,
    session,
    profile,
    role: profile?.role ?? null,
    subscription,
    features,
    refresh,
    reinitConnection,
    signOut,
  }), [ready, configured, session, profile, subscription, features, refresh, reinitConnection, signOut]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside SessionProvider');
  return ctx;
}
