import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { PublicConfig } from './types';
import { dbConfigFromRemote, isValidSupabaseUrl } from './utils';

export interface SupabaseConfig {
  url: string;
  anonKey: string;
  source: 'env' | 'cloudflare' | 'override' | 'cache';
}

export interface RemoteConfig {
  database?: {
    provider?: string;
    url?: string;
    anon_key?: string;
  };
  update?: {
    latest_version?: string;
    version_code?: number;
    apk_url?: string;
    force_update?: boolean;
    changelog?: string;
  };
}

const KEY_OVERRIDE = 'mrcenter.web.cfg.override';
const KEY_CACHE = 'mrcenter.web.cfg.cache';
const KEY_REMOTE = 'mrcenter.web.remote.config';

let client: SupabaseClient | null = null;
let activeConfig: SupabaseConfig | null = null;
let initPromise: Promise<'ready' | 'missing'> | null = null;

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function readJson<T>(key: string): T | null {
  if (!canUseStorage()) return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // تجاهل امتلاء التخزين أو منعه
  }
}

function envConfig(): SupabaseConfig | null {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim();
  const anonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '').trim();
  if (url && anonKey && isValidSupabaseUrl(url)) return { url, anonKey, source: 'env' };
  return null;
}

function applyConfig(cfg: SupabaseConfig): 'ready' {
  activeConfig = cfg;
  client = createClient(cfg.url, cfg.anonKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
      storageKey: 'mrcenter-web-auth',
    },
  });
  return 'ready';
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (value) => { window.clearTimeout(timer); resolve(value); },
      (error) => { window.clearTimeout(timer); reject(error); },
    );
  });
}

async function fetchRemoteConfig(): Promise<RemoteConfig | null> {
  const configUrl = (process.env.NEXT_PUBLIC_CONFIG_URL ?? '').trim();
  if (!configUrl) return readJson<RemoteConfig>(KEY_REMOTE);
  try {
    const res = await withTimeout(fetch(configUrl, { headers: { Accept: 'application/json' } }), 9000);
    if (!res.ok) throw new Error(`http_${res.status}`);
    const remote = (await res.json()) as RemoteConfig;
    writeJson(KEY_REMOTE, remote);
    return remote;
  } catch {
    return readJson<RemoteConfig>(KEY_REMOTE);
  }
}

export function getActiveConfig(): SupabaseConfig | null {
  return activeConfig;
}

export function isSupabaseReady(): boolean {
  return client !== null;
}

export function getSupabase(): SupabaseClient {
  if (!client) {
    throw new Error('لم يتم ضبط اتصال Supabase بعد. أضف NEXT_PUBLIC_SUPABASE_URL و NEXT_PUBLIC_SUPABASE_ANON_KEY في Vercel أو .env.local');
  }
  return client;
}

export async function initSupabase(): Promise<'ready' | 'missing'> {
  if (client) return 'ready';
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const override = readJson<SupabaseConfig>(KEY_OVERRIDE);
    if (override?.url && override.anonKey && isValidSupabaseUrl(override.url)) {
      return applyConfig({ ...override, source: 'override' });
    }

    const env = envConfig();
    if (env) return applyConfig(env);

    const remote = await fetchRemoteConfig();
    const db = dbConfigFromRemote(remote);
    if (db) {
      const cfg: SupabaseConfig = { url: db.url, anonKey: db.anonKey, source: 'cloudflare' };
      writeJson(KEY_CACHE, cfg);
      return applyConfig(cfg);
    }

    const cached = readJson<SupabaseConfig>(KEY_CACHE);
    if (cached?.url && cached.anonKey && isValidSupabaseUrl(cached.url)) {
      return applyConfig({ ...cached, source: 'cache' });
    }

    return 'missing';
  })();

  const result = await initPromise;
  initPromise = null;
  return result;
}

export async function saveOverrideConfig(url: string, anonKey: string): Promise<void> {
  const cfg: SupabaseConfig = { url: url.trim(), anonKey: anonKey.trim(), source: 'override' };
  if (!isValidSupabaseUrl(cfg.url) || !cfg.anonKey) throw new Error('بيانات الاتصال غير صحيحة');
  writeJson(KEY_OVERRIDE, cfg);
  client = null;
  activeConfig = null;
  await initSupabase();
}

export async function clearOverrideConfig(): Promise<void> {
  if (canUseStorage()) window.localStorage.removeItem(KEY_OVERRIDE);
  client = null;
  activeConfig = null;
  await initSupabase();
}

export async function fetchPublicConfig(): Promise<PublicConfig> {
  try {
    const { data, error } = await getSupabase()
      .from('app_config')
      .select('value')
      .eq('key', 'public_config')
      .maybeSingle();
    if (error) return {};
    return (data?.value ?? {}) as PublicConfig;
  } catch {
    return {};
  }
}
