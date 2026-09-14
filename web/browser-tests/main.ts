import { getAddress, type Address, type Hex } from 'viem';
import vectors from '../../contracts/vectors/share-vectors.json';
import { CpuEngine } from '../src/engine/cpuEngine';
import { GpuEngine } from '../src/engine/gpuEngine';
import { bytesToHashHex, headerBytes, isValidShare, makeNonce, splitNonce } from '../src/engine/share';
import type { Engine, Hit } from '../src/engine/types';

interface SearchReport {
  hits: number;
  verified: number;
  invalid: string[];
  rate: number;
  seconds: number;
}

const SEARCH_DIFFICULTY = 16;

async function runSearch(engine: Engine, seconds: number): Promise<SearchReport> {
  const v = vectors[0]!;
  const beneficiary = getAddress(v.beneficiary) as Address;
  const challenge = v.challenge as Hex;
  const hits: Hit[] = [];
  engine.onHit = (hit) => hits.push(hit);
  engine.start({ header: headerBytes(beneficiary, challenge), segment: 42n, difficulty: SEARCH_DIFFICULTY });
  await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  const rate = engine.hashRate();
  engine.stop();
  const invalid: string[] = [];
  let verified = 0;
  const seen = new Set<string>();
  for (const hit of hits) {
    const nonce = makeNonce(hit.segment, hit.worker, hit.counter);
    const key = nonce.toString();
    if (seen.has(key)) invalid.push(`duplicate ${key}`);
    seen.add(key);
    if (isValidShare(beneficiary, challenge, nonce, hit.difficulty)) verified++;
    else invalid.push(`bad ${key}`);
  }
  return { hits: hits.length, verified, invalid, rate, seconds };
}

async function gpu(): Promise<{ available: boolean; adapter?: unknown; vectorsOk?: number; vectorsTotal?: number; search?: SearchReport }> {
  const engine = await GpuEngine.create();
  if (!engine) return { available: false };
  let vectorsOk = 0;
  for (const v of vectors) {
    const { segment, worker, counter } = splitNonce(BigInt(v.nonce));
    const hash = await engine.hashOne(headerBytes(getAddress(v.beneficiary) as Address, v.challenge as Hex), segment, worker, counter);
    if (bytesToHashHex(hash) === v.hash) vectorsOk++;
  }
  const search = await runSearch(engine, 3);
  return { available: true, adapter: engine.adapterInfo, vectorsOk, vectorsTotal: vectors.length, search };
}

async function cpu(cores: number): Promise<{ search: SearchReport; errors: string[] }> {
  const engine = new CpuEngine(cores);
  const errors: string[] = [];
  engine.onError = (worker, message) => errors.push(`worker ${worker}: ${message}`);
  const search = await runSearch(engine, 4);
  return { search, errors };
}

declare global {
  interface Window {
    hashmineTest: { gpu: typeof gpu; cpu: typeof cpu };
  }
}
window.hashmineTest = { gpu, cpu };
