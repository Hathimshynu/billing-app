import { config } from '../config';
import type { OfflineVerifier } from '../db/global';

/**
 * Offline sign-in support. After a successful online sign-in the device stores a PBKDF2-SHA256
 * verifier of the password (never the password and never the server's hash). A user who signed in
 * on this device before can then sign in while the internet is down.
 */

const toHex = (bytes: ArrayBuffer | Uint8Array) =>
  Array.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');

const fromHex = (hex: string) => new Uint8Array((hex.match(/.{2}/g) ?? []).map((h) => parseInt(h, 16)));

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, key, 256);
  return toHex(bits);
}

export async function createVerifier(password: string, iterations: number = config.pbkdf2Iterations): Promise<OfflineVerifier> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { salt: toHex(salt), hash: await derive(password, salt, iterations), iterations };
}

export async function verifyPassword(password: string, verifier: OfflineVerifier): Promise<boolean> {
  const hash = await derive(password, fromHex(verifier.salt), verifier.iterations);
  if (hash.length !== verifier.hash.length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i++) diff |= hash.charCodeAt(i) ^ verifier.hash.charCodeAt(i);
  return diff === 0;
}
