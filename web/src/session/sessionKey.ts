import { isHex, type Address, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';

export const SESSION_KEY_STORAGE_KEY = 'hashmine.sessionKey';

/** The subset of Storage the session key needs; localStorage in the browser, a Map in tests. */
export interface KeyStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Browser-local key that only pays gas for submit/harvest. Rewards never go to it: work is credited to
 * the beneficiary bound inside every share hash.
 */
export class SessionKey {
  readonly account: PrivateKeyAccount;

  private constructor(private readonly privateKey: Hex) {
    this.account = privateKeyToAccount(privateKey);
  }

  get address(): Address {
    return this.account.address;
  }

  static load(storage: KeyStorage): SessionKey | null {
    const stored = storage.getItem(SESSION_KEY_STORAGE_KEY);
    if (stored === null) return null;
    if (!isHex(stored) || stored.length !== 66) throw new Error('stored session key is corrupted');
    return new SessionKey(stored);
  }

  static loadOrCreate(storage: KeyStorage): SessionKey {
    const existing = SessionKey.load(storage);
    if (existing) return existing;
    const privateKey = generatePrivateKey();
    storage.setItem(SESSION_KEY_STORAGE_KEY, privateKey);
    return new SessionKey(privateKey);
  }

  static forget(storage: KeyStorage): void {
    storage.removeItem(SESSION_KEY_STORAGE_KEY);
  }

  exportPrivateKey(): Hex {
    return this.privateKey;
  }
}
