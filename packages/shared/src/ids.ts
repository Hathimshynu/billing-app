/**
 * Identifier helpers. Offline-created records always get a UUIDv7 generated on the device so they
 * never collide with records created on other devices or on the server, and they sort by creation
 * time (good index locality on the server).
 */

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

let lastTimestamp = 0;
let sequenceCounter = 0;

/** RFC 9562 UUID version 7 with a monotonic counter for ids generated within the same millisecond. */
export function uuidv7(now: number = Date.now()): string {
  const bytes = randomBytes(16);
  let ts = now;
  if (ts <= lastTimestamp) {
    ts = lastTimestamp;
    sequenceCounter = (sequenceCounter + 1) & 0xfff;
    if (sequenceCounter === 0) ts = ++lastTimestamp;
  } else {
    sequenceCounter = (bytes[6]! & 0x0f) << 8 | bytes[7]!;
    sequenceCounter &= 0x7ff; // leave headroom for increments
  }
  lastTimestamp = ts;
  // 48-bit big-endian timestamp
  bytes[0] = Math.floor(ts / 2 ** 40) & 0xff;
  bytes[1] = Math.floor(ts / 2 ** 32) & 0xff;
  bytes[2] = Math.floor(ts / 2 ** 24) & 0xff;
  bytes[3] = Math.floor(ts / 2 ** 16) & 0xff;
  bytes[4] = Math.floor(ts / 2 ** 8) & 0xff;
  bytes[5] = ts & 0xff;
  // version 7 + 12-bit sequence
  bytes[6] = 0x70 | ((sequenceCounter >> 8) & 0x0f);
  bytes[7] = sequenceCounter & 0xff;
  // RFC 4122 variant
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/** Composite key used for store/product/variant/batch stock rows (same format on the server). */
export function stockKey(storeId: string, productId: string, variantId?: string | null, batchId?: string | null): string {
  return `${storeId}|${productId}|${variantId ?? ''}|${batchId ?? ''}`;
}
