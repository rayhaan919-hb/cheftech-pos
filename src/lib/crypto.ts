const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim();
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function sha256(str: string): Promise<string> {
  const buf = new TextEncoder().encode(str);
  const hashBuf = await crypto.subtle.digest('SHA-256', buf);
  return bytesToHex(new Uint8Array(hashBuf));
}

export async function hashPassword(
  password: string,
  iterations: number = PBKDF2_ITERATIONS
): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt as unknown as BufferSource,
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );
  const hashHex = bytesToHex(new Uint8Array(derivedBits));
  const saltHex = bytesToHex(salt);
  return `pbkdf2:${iterations}:${saltHex}:${hashHex}`;
}

export async function verifyPassword(
  password: string,
  storedHash: string
): Promise<{ valid: boolean; needsRehash: boolean }> {
  if (!storedHash || typeof storedHash !== 'string') {
    return { valid: false, needsRehash: false };
  }

  if (storedHash.startsWith('pbkdf2:')) {
    const parts = storedHash.split(':');
    if (parts.length !== 4) {
      return { valid: false, needsRehash: false };
    }
    const iterations = parseInt(parts[1], 10);
    const saltHex = parts[2];
    const expectedHex = parts[3];
    if (!Number.isFinite(iterations) || iterations < 1000 || !saltHex || !expectedHex) {
      return { valid: false, needsRehash: false };
    }
    const salt = hexToBytes(saltHex);
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      enc.encode(password),
      { name: 'PBKDF2' },
      false,
      ['deriveBits']
    );
    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: salt as unknown as BufferSource,
        iterations,
        hash: 'SHA-256',
      },
      keyMaterial,
      256
    );
    const actualHex = bytesToHex(new Uint8Array(derivedBits));
    const valid = timingSafeEqualHex(actualHex, expectedHex);
    return { valid, needsRehash: valid && iterations < PBKDF2_ITERATIONS };
  }

  // Legacy unsalted SHA-256 fallback (auto-upgrades to PBKDF2 on successful login)
  if (/^[a-f0-9]{64}$/i.test(storedHash)) {
    const legacyHex = await sha256(password);
    const valid = timingSafeEqualHex(legacyHex.toLowerCase(), storedHash.toLowerCase());
    return { valid, needsRehash: valid };
  }

  return { valid: false, needsRehash: false };
}

export async function hmacSign(secret: string, payload: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return bytesToHex(new Uint8Array(sig));
}
