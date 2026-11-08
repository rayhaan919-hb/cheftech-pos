import { db } from './db';
import {
  authBaseUrl,
  configManager,
  functionsBaseUrl,
  getSyncConfig,
  isConfigured,
  restBaseUrl,
  supabaseHeaders,
} from './config';
import {
  cloudCategoryToLocal,
  cloudInventoryToLocal,
  cloudMenuToLocal,
  cloudOrderToLocal,
  cloudSaleToLocal,
  localCategoryToCloud,
  localInventoryToCloud,
  localMenuToCloud,
  localOrderPatch,
} from './syncMap';
import type { OnlineOrder } from './db/types';

const TOKEN_KEY = 'hb.syncToken';
const SNAPSHOT_KEY = 'sync.snapshot';
const POLL_MS = 20_000;
const MAX_SYNCED_IMAGE_BYTES = 700 * 1024;

export type SyncState = 'off' | 'idle' | 'syncing' | 'error';
export interface SyncStatus {
  state: SyncState;
  lastSync: number | null;
  error?: string;
}

let status: SyncStatus = { state: 'off', lastSync: null };
const listeners = new Set<() => void>();

function setStatus(patch: Partial<SyncStatus>): void {
  status = { ...status, ...patch };
  for (const listener of listeners) listener();
}

export function subscribeToSync(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSyncStatus(): SyncStatus {
  return status;
}

export function isSyncEnabled(): boolean {
  return Boolean(localStorage.getItem(TOKEN_KEY)) && configManager.isConfigured();
}

interface Token {
  idToken: string;
  refreshToken: string;
  expiresAt: number;
}

export function rememberToken(idToken: string, refreshToken?: string, expiresIn?: number): void {
  if (!refreshToken) return;
  const token: Token = {
    idToken,
    refreshToken,
    expiresAt: Date.now() + (Number(expiresIn) || 3600) * 1000,
  };
  try {
    localStorage.setItem(TOKEN_KEY, JSON.stringify(token));
  } catch {
    // ignore storage errors
  }
}

export function forgetToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore
  }
  setStatus({ state: 'off', error: undefined });
}

export async function getAccessToken(): Promise<string | null> {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  let token: Token;
  try {
    token = JSON.parse(raw);
  } catch {
    forgetToken();
    return null;
  }
  if (token.expiresAt - 60_000 > Date.now()) return token.idToken;

  const config = await configManager.getConfig();
  if (!config || !isConfigured(config)) return null;

  const res = await fetch(`${authBaseUrl(config)}/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: supabaseHeaders(config),
    body: JSON.stringify({ refresh_token: token.refreshToken }),
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);

  if (!res?.ok) {
    forgetToken();
    return null;
  }
  const next = await res.json();
  rememberToken(next.access_token, next.refresh_token || token.refreshToken, next.expires_in);
  return next.access_token as string;
}

async function rest(
  method: string,
  pathWithQuery: string,
  body?: unknown,
  extraHeaders?: Record<string, string>
): Promise<any | null> {
  const token = await getAccessToken();
  const config = getSyncConfig();
  if (!token || !isConfigured(config)) return null;

  const target = pathWithQuery.startsWith('http')
    ? pathWithQuery
    : `${restBaseUrl(config)}/${pathWithQuery.replace(/^\/+/, '')}`;

  try {
    const res = await fetch(target, {
      method,
      headers: supabaseHeaders(config, token, extraHeaders),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) {
      if (res.status === 401) forgetToken();
      setStatus({ state: 'error', error: `Cloud ${res.status}` });
      return null;
    }
    if (res.status === 204) return {};
    const text = await res.text();
    return text ? JSON.parse(text) : {};
  } catch (err) {
    setStatus({ state: 'error', error: err instanceof Error ? err.message : 'network error' });
    return null;
  }
}

export function restWrite(
  method: string,
  target: string,
  body?: unknown,
  extraHeaders?: Record<string, string>
): Promise<any | null> {
  return rest(method, target, body, extraHeaders);
}

type Snapshot = Record<string, Record<string, string>>;

async function readSnapshot(): Promise<Snapshot> {
  const setting = await db.settings.get(SNAPSHOT_KEY);
  if (!setting) return {};
  try {
    return typeof setting.value === 'string' ? JSON.parse(setting.value) : (setting.value as Snapshot);
  } catch {
    return {};
  }
}

async function writeSnapshot(snap: Snapshot): Promise<void> {
  await db.settings.put({ key: SNAPSHOT_KEY, value: JSON.stringify(snap) });
}

let snapshot: Snapshot | null = null;

async function getSnapshot(): Promise<Snapshot> {
  snapshot ??= await readSnapshot();
  return snapshot;
}

async function pullMenu(snap: Snapshot): Promise<boolean> {
  const rows: any[] | null = await rest('GET', 'menu_items?select=*');
  if (!Array.isArray(rows)) return false;

  const seen = snap.menu ?? {};
  const remote: Record<string, string> = {};
  let changed = false;

  for (const row of rows) {
    const id = String(row.id);
    const stamp = String(row.updated_at || '');
    remote[id] = stamp;
    if (seen[id] !== stamp) {
      const { item, recipes } = cloudMenuToLocal(row);
      await db.menu.put(item);
      await db.recipes.where('menuItemId').equals(id).delete();
      for (const r of recipes) {
        if (!r.inventoryId) continue;
        await db.recipes.add({
          menuItemId: id,
          inventoryId: r.inventoryId,
          qtyRequired: r.qtyRequired,
        });
      }
      changed = true;
    }
  }

  for (const oldId of Object.keys(seen)) {
    if (!(oldId in remote)) {
      await db.menu.delete(oldId);
      await db.recipes.where('menuItemId').equals(oldId).delete();
      changed = true;
    }
  }

  snap.menu = remote;
  return changed;
}

async function pullCategories(snap: Snapshot): Promise<boolean> {
  const rows: any[] | null = await rest('GET', 'categories?select=*');
  if (!Array.isArray(rows)) return false;

  const seen = snap.categories ?? {};
  const remote: Record<string, string> = {};
  let changed = false;

  for (const row of rows) {
    const id = String(row.id);
    const stamp = String(row.updated_at || '');
    remote[id] = stamp;
    if (seen[id] !== stamp) {
      await db.categories.put(cloudCategoryToLocal(row));
      changed = true;
    }
  }

  for (const oldId of Object.keys(seen)) {
    if (!(oldId in remote)) {
      await db.categories.delete(oldId);
      changed = true;
    }
  }

  snap.categories = remote;
  return changed;
}

async function pullInventory(snap: Snapshot): Promise<boolean> {
  const rows: any[] | null = await rest('GET', 'inventory?select=*');
  if (!Array.isArray(rows)) return false;

  const seen = snap.inventory ?? {};
  const remote: Record<string, string> = {};
  let changed = false;

  for (const row of rows) {
    const id = String(row.id);
    const stamp = String(row.updated_at || '');
    remote[id] = stamp;
    if (seen[id] !== stamp) {
      await db.inventory.put(cloudInventoryToLocal(row));
      changed = true;
    }
  }

  for (const oldId of Object.keys(seen)) {
    if (!(oldId in remote)) {
      await db.inventory.delete(oldId);
      changed = true;
    }
  }

  snap.inventory = remote;
  return changed;
}

async function pullSales(snap: Snapshot): Promise<boolean> {
  const rows: any[] | null = await rest('GET', 'sales?select=*&order=date.desc&limit=500');
  if (!Array.isArray(rows)) return false;

  const seen = snap.sales ?? {};
  const remote: Record<string, string> = { ...seen };
  let changed = false;

  for (const row of rows) {
    const cloudId = String(row.id);
    const stamp = String(row.updated_at || row.date || '');
    if (seen[cloudId] === stamp) continue;
    remote[cloudId] = stamp;

    const existingByCloud = await db.sales.where('cloudId').equals(cloudId).first();
    if (existingByCloud) continue;

    const known = Number(row.id) ? await db.sales.get(Number(row.id)) : undefined;
    if (known?.id && Number(known.total) === Number(row.total ?? known.total)) {
      if (!known.cloudId) await db.sales.update(known.id, { cloudId });
      continue;
    }

    await db.sales.add(cloudSaleToLocal(cloudId, row));
    changed = true;
  }

  snap.sales = remote;
  return changed;
}

async function pullOnlineOrders(snap: Snapshot): Promise<boolean> {
  const rows: any[] | null = await rest('GET', 'online_orders?select=*&order=created_at.desc&limit=200');
  if (!Array.isArray(rows)) return false;

  const seen = snap.onlineOrders ?? {};
  const remote: Record<string, string> = {};
  let changed = false;

  for (const row of rows) {
    const cloudId = String(row.id);
    const stamp = String(row.updated_at || row.created_at || '');
    remote[cloudId] = stamp;
    if (seen[cloudId] === stamp) continue;

    const order = cloudOrderToLocal(cloudId, row);
    const local = await db.onlineOrders.where('cloudId').equals(cloudId).first();
    if (local?.id) {
      await db.onlineOrders.put({ ...order, id: local.id });
    } else {
      await db.onlineOrders.add(order);
    }
    changed = true;
  }

  snap.onlineOrders = remote;
  return changed;
}

let inFlight: Promise<boolean> | null = null;

export function syncNow(): Promise<boolean> {
  inFlight ??= (async () => {
    if (!isSyncEnabled()) {
      setStatus({ state: 'off' });
      return false;
    }
    setStatus({ state: 'syncing', error: undefined });
    const snap = await getSnapshot();
    let changed = false;
    try {
      if (await pullCategories(snap)) changed = true;
      if (await pullMenu(snap)) changed = true;
      if (await pullInventory(snap)) changed = true;
      if (await pullSales(snap)) changed = true;
      if (await pullOnlineOrders(snap)) changed = true;
      if (changed) await writeSnapshot(snap);
      setStatus({ state: 'idle', lastSync: Date.now() });
    } catch (err) {
      setStatus({ state: 'error', error: err instanceof Error ? err.message : 'sync failed' });
    }
    return changed;
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startSync(): void {
  if (timer) return;
  if (!isSyncEnabled()) {
    setStatus({ state: 'off' });
    return;
  }
  void syncNow();
  timer = setInterval(() => void syncNow(), POLL_MS);
  window.addEventListener('online', wake);
}

export function stopSync(): void {
  if (timer) clearInterval(timer);
  timer = null;
  window.removeEventListener('online', wake);
}

function wake(): void {
  void syncNow();
}

const pushes = new Map<string, Promise<void>>();

function enqueue(key: string, task: () => Promise<void>): void {
  const previous = pushes.get(key) ?? Promise.resolve();
  const next = previous.then(task).catch(() => undefined);
  pushes.set(key, next);
  void next.finally(() => {
    if (pushes.get(key) === next) pushes.delete(key);
  });
}

export function pushMenu(id: string): void {
  enqueue(`menu/${id}`, async () => {
    const item = await db.menu.get(id);
    if (!item) {
      await rest('DELETE', `menu_items?id=eq.${encodeURIComponent(id)}`);
      return;
    }
    const recipes = await db.recipes.where('menuItemId').equals(id).toArray();
    const payload = localMenuToCloud(
      item,
      recipes.map((row) => ({ inventoryId: row.inventoryId, qtyRequired: row.qtyRequired }))
    );
    if (typeof payload.image_url === 'string' && payload.image_url.length > MAX_SYNCED_IMAGE_BYTES) {
      payload.image_url = '';
    }
    await rest('POST', 'menu_items', payload, {
      Prefer: 'resolution=merge-duplicates,return=representation',
    });
  });
}

export function pushCategory(id: string): void {
  enqueue(`categories/${id}`, async () => {
    const category = await db.categories.get(id);
    if (!category) {
      await rest('DELETE', `categories?id=eq.${encodeURIComponent(id)}`);
      return;
    }
    await rest('POST', 'categories', localCategoryToCloud(category), {
      Prefer: 'resolution=merge-duplicates,return=representation',
    });
  });
}

export function pushInventory(id: string): void {
  enqueue(`inventory/${id}`, async () => {
    const item = await db.inventory.get(id);
    if (!item) {
      await rest('DELETE', `inventory?id=eq.${encodeURIComponent(id)}`);
      return;
    }
    await rest('POST', 'inventory', localInventoryToCloud(item), {
      Prefer: 'resolution=merge-duplicates,return=representation',
    });
  });
}

export function pushSale(localId: number): void {
  enqueue(`sales/${localId}`, async () => {
    const sale = await db.sales.get(localId);
    if (!sale || sale.cloudId) return;

    const payload = {
      id: sale.id ?? Date.now(),
      date: sale.timestamp,
      items: sale.items,
      total: sale.total,
      subtotal: sale.subtotal,
      discount: sale.discountAmount,
      discount_type: 'PERCENT',
      discount_val: sale.discountPercent,
      loyalty_redeem_amt: sale.loyaltyDiscount ?? 0,
      loyalty_redeem_pts: sale.loyaltyRedeemPoints ?? 0,
      payment_method: sale.payments?.[0]?.method || 'Cash',
      order_type: sale.orderType,
      customer_name: sale.customer?.name || null,
      customer_phone: sale.customer?.phone || null,
      customer_address: sale.customer?.address || null,
      cashier: sale.serverUser,
      updated_at: new Date().toISOString(),
    };

    const res = await rest('POST', 'sales', payload, {
      Prefer: 'resolution=merge-duplicates,return=representation',
    });
    if (res) {
      await db.sales.update(localId, { cloudId: String(payload.id) });
    }
  });
}

export function pushOrder(order: OnlineOrder): void {
  if (!order.cloudId) return;
  enqueue(`onlineOrders/${order.cloudId}`, async () => {
    const current = order.id ? await db.onlineOrders.get(order.id) : order;
    if (!current?.cloudId) return;
    const patch = localOrderPatch(current);
    await rest('PATCH', `online_orders?id=eq.${encodeURIComponent(current.cloudId)}`, patch);

    // S-05 & M-01 Option B: When order reaches COMPLETED, invoke issue-loyalty Edge Function
    if (current.status === 'COMPLETED') {
      const token = await getAccessToken();
      const cfg = getSyncConfig();
      if (token && isConfigured(cfg)) {
        await fetch(`${functionsBaseUrl(cfg)}/issue-loyalty`, {
          method: 'POST',
          headers: supabaseHeaders(cfg, token),
          body: JSON.stringify({ orderId: current.cloudId }),
        }).catch(() => undefined);
      }
    }
  });
}

export function deleteSale(cloudId: string): void {
  enqueue(`sales/${cloudId}`, async () => {
    await rest('DELETE', `sales?id=eq.${encodeURIComponent(cloudId)}`);
  });
}

export function pushStock(ids: Iterable<string>): void {
  for (const id of ids) pushInventory(id);
}
