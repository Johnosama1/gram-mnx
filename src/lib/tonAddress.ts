/**
 * Browser-safe TON address helpers (no Buffer / @ton/core dependency).
 * Converts any TON address form (raw `0:abc…`, bounceable `EQ…`) into the
 * user-friendly non-bounceable form (`UQ…`) that wallets display.
 */

const NON_BOUNCEABLE_TAG = 0x51;

function crc16(data: Uint8Array): number {
  let crc = 0;
  for (const byte of data) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc & 0xffff;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_');
}

function base64UrlDecode(value: string): Uint8Array | null {
  try {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** Extracts { workchain, hash } from raw (`0:hex`) or friendly (`EQ…`) forms. */
function parseParts(addr: string): { workchain: number; hash: Uint8Array } | null {
  if (addr.includes(':')) {
    const [wc, hex] = addr.split(':');
    if (!/^-?\d+$/.test(wc) || !/^[0-9a-fA-F]{64}$/.test(hex ?? '')) return null;
    const hash = new Uint8Array(32);
    for (let i = 0; i < 32; i++) hash[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return { workchain: Number(wc), hash };
  }

  const bytes = base64UrlDecode(addr);
  if (!bytes || bytes.length !== 36) return null;
  const wcByte = bytes[1];
  return {
    workchain: wcByte === 0xff ? -1 : wcByte,
    hash: bytes.slice(2, 34),
  };
}

export function toFriendlyAddress(addr?: string | null): string {
  if (!addr) return '';
  const parts = parseParts(addr.trim());
  if (!parts) return addr;

  const body = new Uint8Array(34);
  body[0] = NON_BOUNCEABLE_TAG;
  body[1] = parts.workchain === -1 ? 0xff : parts.workchain & 0xff;
  body.set(parts.hash, 2);

  const checksum = crc16(body);
  const full = new Uint8Array(36);
  full.set(body, 0);
  full[34] = (checksum >> 8) & 0xff;
  full[35] = checksum & 0xff;

  return base64UrlEncode(full);
}

/** Short display form: first 4 + … + last 4 chars of the friendly address. */
export function shortFriendlyAddress(addr?: string | null): string {
  const friendly = toFriendlyAddress(addr);
  if (!friendly) return '';
  return `${friendly.slice(0, 4)}...${friendly.slice(-4)}`;
}
