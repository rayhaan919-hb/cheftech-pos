import { useEffect, useState } from 'react';
import { Modal } from './Modal';
import { configManager, restBaseUrl, supabaseHeaders } from '../lib/config';
import { logAudit } from '../lib/audit';

export function CloudSetupModal({ username, notify, onClose }: {
  username: string;
  notify: (message: string) => void;
  onClose: () => void;
}) {
  const [supabaseUrl, setSupabaseUrl] = useState('');
  const [supabaseAnonKey, setSupabaseAnonKey] = useState('');
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    void configManager.getConfig().then((cfg) => {
      if (cfg) {
        setSupabaseUrl(cfg.supabaseUrl);
        setSupabaseAnonKey(cfg.supabaseAnonKey);
      }
    });
  }, []);

  async function testConnection() {
    const cleanUrl = supabaseUrl.trim().replace(/\/+$/, '');
    const cleanKey = supabaseAnonKey.trim();
    if (!cleanUrl || !cleanKey) {
      notify('Please enter both Supabase Project URL and Anon Key.');
      return;
    }
    setTesting(true);
    try {
      const cfg = { supabaseUrl: cleanUrl, supabaseAnonKey: cleanKey };
      const res = await fetch(`${restBaseUrl(cfg)}/categories?select=id&limit=1`, {
        headers: supabaseHeaders(cfg),
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) throw new Error(`Connection failed (HTTP ${res.status})`);
      notify('Supabase connection verified!');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not connect to Supabase.');
    } finally {
      setTesting(false);
    }
  }

  async function save() {
    const cleanUrl = supabaseUrl.trim().replace(/\/+$/, '');
    const cleanKey = supabaseAnonKey.trim();
    if (!cleanUrl || !cleanKey) {
      notify('Please enter both Supabase Project URL and Anon Key.');
      return;
    }
    await configManager.setConfig(cleanUrl, cleanKey);
    await logAudit('CLOUD_CONFIG_UPDATED', `Supabase URL: ${cleanUrl}`, username);
    notify('Supabase configuration saved.');
    onClose();
  }

  async function disconnect() {
    await configManager.clearConfig();
    setSupabaseUrl('');
    setSupabaseAnonKey('');
    await logAudit('CLOUD_CONFIG_CLEARED', 'Supabase cloud configuration cleared', username);
    notify('Cloud sync disconnected (running in local-only mode).');
    onClose();
  }

  return (
    <Modal
      title="Supabase Cloud Setup"
      onClose={onClose}
      footer={
        <div className="flex justify-between gap-2 w-full">
          <button
            type="button"
            onClick={disconnect}
            className="px-3 py-2 rounded-xl text-xs font-bold bg-red-50 text-red-600 hover:bg-red-100"
          >
            Disconnect
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-bold bg-gray-100 text-gray-700 hover:bg-gray-200"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={testConnection}
              disabled={testing}
              className="px-4 py-2 rounded-xl text-xs font-bold bg-gray-200 text-gray-700 hover:bg-gray-300 disabled:opacity-50"
            >
              {testing ? 'Testing...' : 'Test Connection'}
            </button>
            <button
              type="button"
              onClick={save}
              disabled={testing}
              className="px-4 py-2 rounded-xl text-xs font-bold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Save Config
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-4 py-2">
        <p className="text-xs text-gray-500">
          Enter your Supabase project credentials (or configure <code className="font-mono">VITE_SUPABASE_URL</code> and{' '}
          <code className="font-mono">VITE_SUPABASE_ANON_KEY</code> in <code className="font-mono">.env</code>) to enable
          multi-device synchronization and online website orders. Only enter your public <code className="font-mono">anon</code> key here.
        </p>
        <div className="space-y-3">
          <label className="block">
            <span className="block text-[10px] font-bold uppercase tracking-wide text-gray-600 mb-1">
              Supabase Project URL
            </span>
            <input
              type="url"
              value={supabaseUrl}
              onChange={(e) => setSupabaseUrl(e.target.value)}
              placeholder="https://your-project-ref.supabase.co"
              className="w-full p-2.5 text-xs ring-1 ring-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>
          <label className="block">
            <span className="block text-[10px] font-bold uppercase tracking-wide text-gray-600 mb-1">
              Supabase Anon Public Key
            </span>
            <input
              type="text"
              value={supabaseAnonKey}
              onChange={(e) => setSupabaseAnonKey(e.target.value)}
              placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
              className="w-full p-2.5 text-xs ring-1 ring-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>
        </div>
      </div>
    </Modal>
  );
}
