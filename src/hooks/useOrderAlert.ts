import { useEffect, useRef } from 'react';
import { db } from '../lib/db';
import { useLive } from '../lib/useLive';

let audioCtx: AudioContext | null = null;

function getAudio(): AudioContext | null {
  try {
    audioCtx ??= new (window.AudioContext || (window as any).webkitAudioContext)();
    return audioCtx;
  } catch {
    return null;
  }
}

// Browsers keep audio suspended until a user gesture; unlock it on the first one.
for (const evt of ['pointerdown', 'keydown'] as const)
  window.addEventListener(evt, () => void getAudio()?.resume(), { once: true });

// Web Audio (not an external mp3) so Vercel's default-src 'self' CSP doesn't block it.
function playBeep() {
  const ctx = getAudio();
  if (!ctx) return;
  void ctx.resume();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = 880;
  osc.connect(gain);
  gain.connect(ctx.destination);
  gain.gain.setValueAtTime(0.3, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
  osc.start();
  osc.stop(ctx.currentTime + 0.3);
}

/**
 * Plays an alert sound and fires a toast when a new order arrives
 * in the POS inbox — but only when the OnlineOrdersModal is not already open,
 * so accepting orders doesn't produce a cascade of alerts.
 */
export function useOrderAlert(notify: (message: string) => void, ordersModalOpen: boolean) {
  const pendingCount = useLive(() => db.onlineOrders.where('status').equals('PENDING').count(), []);

  // null until the first real count arrives, so existing orders don't alert on load.
  const prevCountRef = useRef<number | null>(null);

  useEffect(() => {
    if (pendingCount === undefined) return;
    const prev = prevCountRef.current;
    prevCountRef.current = pendingCount;

    if (prev !== null && pendingCount > prev && !ordersModalOpen) {
      const newOrders = pendingCount - prev;
      playBeep();
      notify(
        newOrders === 1
          ? '🔔 New website order received!'
          : `🔔 ${newOrders} new website orders received!`,
      );
    }
  }, [pendingCount, notify, ordersModalOpen]);
}
