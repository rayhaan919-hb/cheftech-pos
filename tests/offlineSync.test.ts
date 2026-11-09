import { beforeEach, describe, expect, it, vi } from 'vitest';

const memSales: any[] = [];
let networkCallCount = 0;

vi.mock('../src/lib/db', () => {
  return {
    db: {
      sales: {
        get: async (id: number) => memSales.find((s) => s.id === id),
        filter: (fn: (s: any) => boolean) => ({
          toArray: async () => memSales.filter(fn),
          count: async () => memSales.filter(fn).length,
        }),
        update: async (id: number, patch: any) => {
          const idx = memSales.findIndex((s) => s.id === id);
          if (idx >= 0) memSales[idx] = { ...memSales[idx], ...patch };
          return 1;
        },
        toArray: async () => [...memSales],
        clear: async () => {
          memSales.length = 0;
        },
      },
      settings: {
        get: async () => null,
        put: async () => '',
      },
    },
  };
});

vi.mock('../src/lib/config', () => {
  return {
    configManager: {
      isConfigured: () => true,
      getConfig: async () => ({ supabaseUrl: 'https://test.supabase.co', supabaseAnonKey: 'mock-key' }),
    },
    getSyncConfig: () => ({ supabaseUrl: 'https://test.supabase.co', supabaseAnonKey: 'mock-key' }),
    isConfigured: () => true,
    authBaseUrl: () => 'https://test.supabase.co/auth/v1',
    restBaseUrl: () => 'https://test.supabase.co/rest/v1',
    functionsBaseUrl: () => 'https://test.supabase.co/functions/v1',
    supabaseHeaders: () => ({ 'Content-Type': 'application/json' }),
  };
});

// Mock fetch for REST endpoints
globalThis.fetch = vi.fn(async (url: any) => {
  networkCallCount++;
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify([{ id: 101 }]),
    json: async () => [{ id: 101 }],
  } as any;
}) as any;

function createStorageMock(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    removeItem: (k: string) => {
      store.delete(k);
    },
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
  };
}

if (typeof globalThis.localStorage === 'undefined') {
  Object.defineProperty(globalThis, 'localStorage', { value: createStorageMock(), writable: true });
}

import { db } from '../src/lib/db';
import { getPendingSyncCount, pushPendingSales } from '../src/lib/sync';

describe('Offline Synchronization & Data Integrity', () => {
  beforeEach(async () => {
    await (db.sales as any).clear();
    networkCallCount = 0;
    localStorage.setItem(
      'hb.syncToken',
      JSON.stringify({
        idToken: 'mock-token',
        refreshToken: 'mock-refresh',
        expiresAt: Date.now() + 3600000,
      })
    );
  });

  it('tracks pending unsynced sales stored locally in offline mode', async () => {
    memSales.push(
      { id: 1, total: 500, timestamp: new Date().toISOString(), cloudId: undefined },
      { id: 2, total: 750, timestamp: new Date().toISOString(), cloudId: undefined },
      { id: 3, total: 1200, timestamp: new Date().toISOString(), cloudId: '3' } // already synced
    );

    const pending = await getPendingSyncCount();
    expect(pending.sales).toBe(2);
  });

  it('uploads pending offline sales when connectivity is restored and stamps cloudId', async () => {
    memSales.push(
      { id: 10, total: 800, timestamp: new Date().toISOString(), cloudId: undefined },
      { id: 11, total: 1500, timestamp: new Date().toISOString(), cloudId: undefined }
    );

    const pushedCount = await pushPendingSales();
    expect(pushedCount).toBe(2);

    // Both sales now have cloudId stamped
    const sale10 = await db.sales.get(10);
    const sale11 = await db.sales.get(11);
    expect(sale10?.cloudId).toBe('10');
    expect(sale11?.cloudId).toBe('11');

    // Re-checking pending count returns 0
    const pendingAfter = await getPendingSyncCount();
    expect(pendingAfter.sales).toBe(0);

    // Retrying pushPendingSales does nothing and does not make redundant network calls
    const retryCallsBefore = networkCallCount;
    const retryCount = await pushPendingSales();
    expect(retryCount).toBe(0);
    expect(networkCallCount).toBe(retryCallsBefore);
  });
});
