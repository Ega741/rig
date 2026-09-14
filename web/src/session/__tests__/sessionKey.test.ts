import { describe, expect, it } from 'vitest';
import { isAddress } from 'viem';
import { SESSION_KEY_STORAGE_KEY, SessionKey, type KeyStorage } from '../sessionKey';

class MemoryStorage implements KeyStorage {
  private readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

describe('SessionKey', () => {
  it('is absent until created, then persists', () => {
    const storage = new MemoryStorage();
    expect(SessionKey.load(storage)).toBeNull();
    const created = SessionKey.loadOrCreate(storage);
    expect(isAddress(created.address)).toBe(true);
    expect(storage.getItem(SESSION_KEY_STORAGE_KEY)).toMatch(/^0x[0-9a-f]{64}$/);
    expect(SessionKey.load(storage)?.address).toBe(created.address);
  });

  it('exports the private key and can be forgotten', () => {
    const storage = new MemoryStorage();
    const key = SessionKey.loadOrCreate(storage);
    expect(key.exportPrivateKey()).toBe(storage.getItem(SESSION_KEY_STORAGE_KEY));
    SessionKey.forget(storage);
    expect(SessionKey.load(storage)).toBeNull();
  });

  it('rejects a corrupted stored key', () => {
    const storage = new MemoryStorage();
    storage.setItem(SESSION_KEY_STORAGE_KEY, 'not-a-key');
    expect(() => SessionKey.load(storage)).toThrow();
  });
});
