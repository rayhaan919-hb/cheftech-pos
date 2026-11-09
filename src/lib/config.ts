import { db } from './db';

export interface CloudConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
}

const LOCAL_CONFIG_KEY = 'cheftech_supabase_config';
const SETTINGS_KEY = 'supabaseConfig';

function readEnvConfig(): CloudConfig {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  if (env.MODE === 'test' || env.VITEST) {
    return { supabaseUrl: '', supabaseAnonKey: '' };
  }
  return {
    supabaseUrl: String(env.VITE_SUPABASE_URL || '').trim().replace(/\/+$/, ''),
    supabaseAnonKey: String(env.VITE_SUPABASE_ANON_KEY || '').trim(),
  };
}

let cachedConfig: CloudConfig | null = null;

export function isConfigured(cfg?: CloudConfig | null): boolean {
  const target = cfg ?? getSyncConfig();
  return Boolean(
    target &&
      target.supabaseUrl &&
      target.supabaseAnonKey &&
      /^https?:\/\/.+/i.test(target.supabaseUrl) &&
      target.supabaseAnonKey.length >= 20
  );
}

export function getSyncConfig(): CloudConfig {
  if (cachedConfig && isConfigured(cachedConfig)) return cachedConfig;
  const envCfg = readEnvConfig();
  if (isConfigured(envCfg)) {
    cachedConfig = envCfg;
    return envCfg;
  }
  try {
    const raw = localStorage.getItem(LOCAL_CONFIG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<CloudConfig>;
      const cfg: CloudConfig = {
        supabaseUrl: String(parsed.supabaseUrl || '').trim().replace(/\/+$/, ''),
        supabaseAnonKey: String(parsed.supabaseAnonKey || '').trim(),
      };
      if (isConfigured(cfg)) {
        cachedConfig = cfg;
        return cfg;
      }
    }
  } catch {
    // ignore storage errors
  }
  return { supabaseUrl: '', supabaseAnonKey: '' };
}

export async function loadConfig(): Promise<CloudConfig | null> {
  const envCfg = readEnvConfig();
  if (isConfigured(envCfg)) {
    cachedConfig = envCfg;
    return envCfg;
  }
  try {
    const row = await db.settings.get(SETTINGS_KEY);
    const val = (typeof row?.value === 'string' ? JSON.parse(row.value) : row?.value) as
      | Partial<CloudConfig>
      | undefined;
    if (val) {
      const cfg: CloudConfig = {
        supabaseUrl: String(val.supabaseUrl || '').trim().replace(/\/+$/, ''),
        supabaseAnonKey: String(val.supabaseAnonKey || '').trim(),
      };
      if (isConfigured(cfg)) {
        cachedConfig = cfg;
        try {
          localStorage.setItem(LOCAL_CONFIG_KEY, JSON.stringify(cfg));
        } catch {
          // ignore
        }
        return cfg;
      }
    }
  } catch {
    // ignore dexie read error
  }
  const syncCfg = getSyncConfig();
  return isConfigured(syncCfg) ? syncCfg : null;
}

export async function saveConfig(supabaseUrl: string, supabaseAnonKey: string): Promise<void> {
  const normalized: CloudConfig = {
    supabaseUrl: String(supabaseUrl || '').trim().replace(/\/+$/, ''),
    supabaseAnonKey: String(supabaseAnonKey || '').trim(),
  };
  cachedConfig = normalized;
  await db.settings.put({ key: SETTINGS_KEY, value: normalized });
  try {
    if (isConfigured(normalized)) {
      localStorage.setItem(LOCAL_CONFIG_KEY, JSON.stringify(normalized));
    } else {
      localStorage.removeItem(LOCAL_CONFIG_KEY);
    }
  } catch {
    // ignore
  }
}

export async function clearConfig(): Promise<void> {
  cachedConfig = null;
  await db.settings.delete(SETTINGS_KEY);
  try {
    localStorage.removeItem(LOCAL_CONFIG_KEY);
  } catch {
    // ignore
  }
}

export const configManager = {
  getConfig: loadConfig,
  setConfig: saveConfig,
  clearConfig,
  isConfigured: () => isConfigured(getSyncConfig()),
};

export function restBaseUrl(cfg: CloudConfig): string {
  return `${cfg.supabaseUrl.replace(/\/+$/, '')}/rest/v1`;
}

export function authBaseUrl(cfg: CloudConfig): string {
  return `${cfg.supabaseUrl.replace(/\/+$/, '')}/auth/v1`;
}

export function functionsBaseUrl(cfg: CloudConfig): string {
  return `${cfg.supabaseUrl.replace(/\/+$/, '')}/functions/v1`;
}

export function supabaseHeaders(
  cfg: CloudConfig,
  accessToken?: string | null,
  extra?: Record<string, string>
): Record<string, string> {
  const token = accessToken || cfg.supabaseAnonKey;
  return {
    apikey: cfg.supabaseAnonKey,
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}
