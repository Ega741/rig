import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type WalletClient,
} from 'viem';
import type { PrivateKeyAccount } from 'viem/accounts';
import type { ChainReader, PriceSource, RoundState, Submitter } from '../miner/controller';
import { hashMineAbi } from './abi/hashMine';
import { rpcTransport } from './transport';
import { ponsEscrowAbi } from './abi/ponsEscrow';
import { ponsTreasuryAbi } from './abi/ponsTreasury';

export interface ChainClients {
  publicClient: PublicClient;
  walletClient: WalletClient;
}

export function createClients(chain: Chain, rpcUrl: string, account: PrivateKeyAccount): ChainClients {
  const transport = rpcTransport(chain.id, rpcUrl);
  return {
    publicClient: createPublicClient({ chain, transport }),
    walletClient: createWalletClient({ chain, transport, account }),
  };
}

type Call = { address: Address; abi: typeof hashMineAbi; functionName: string; args?: readonly unknown[] };

/** Reads HashMine state; one multicall where the chain has Multicall3, parallel calls otherwise. */
export class ViemChainReader implements ChainReader {
  constructor(private readonly client: PublicClient, private readonly hashMine: Address) {}

  async roundState(beneficiary: Address): Promise<RoundState> {
    const c = (functionName: string, args?: readonly unknown[]): Call => ({ address: this.hashMine, abi: hashMineAbi, functionName, args });
    const [genesis, roundLength, releaseBps, round] = await this.readMany([
      c('genesis'),
      c('roundLength'),
      c('releaseBps'),
      c('currentRound'),
    ]);
    const [challenge, minDifficulty, roundWork, lastActiveRound, rewardPool, pending] = await this.readMany([
      c('challenge', [round]),
      c('minDifficulty', [round]),
      c('roundWork', [round]),
      c('lastActiveRound'),
      c('rewardPool'),
      c('pending', [beneficiary]),
    ]);
    const anchorWork = (lastActiveRound as bigint) === 0n ? 0n : ((await this.readMany([c('roundWork', [lastActiveRound])]))[0] as bigint);
    return {
      round: round as bigint,
      genesis: Number(genesis as bigint),
      roundLength: Number(roundLength as bigint),
      challenge: challenge as Hex,
      minDifficulty: Number(minDifficulty as number),
      roundWork: roundWork as bigint,
      anchorWork,
      rewardPool: rewardPool as bigint,
      releaseBps: Number(releaseBps as bigint),
      pending: pending as bigint,
    };
  }

  async gasPriceWei(): Promise<bigint> {
    return this.client.getGasPrice();
  }

  private async readMany(calls: Call[]): Promise<unknown[]> {
    if (this.client.chain?.contracts?.multicall3) {
      return this.client.multicall({ contracts: calls as never, allowFailure: false }) as Promise<unknown[]>;
    }
    return Promise.all(calls.map((call) => this.client.readContract(call as never) as Promise<unknown>));
  }
}

/** Sends submit/claim from the session key. */
export class ViemSubmitter implements Submitter {
  constructor(
    private readonly clients: ChainClients,
    private readonly hashMine: Address,
    private readonly account: PrivateKeyAccount,
  ) {}

  async submit(beneficiary: Address, round: bigint, difficulty: number, nonces: bigint[]): Promise<Hex> {
    const hash = await this.clients.walletClient.writeContract({
      address: this.hashMine,
      abi: hashMineAbi,
      functionName: 'submit',
      args: [beneficiary, round, difficulty, nonces],
      account: this.account,
      chain: this.clients.walletClient.chain,
    });
    await this.clients.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  async claim(beneficiary: Address): Promise<Hex> {
    const hash = await this.clients.walletClient.writeContract({
      address: this.hashMine,
      abi: hashMineAbi,
      functionName: 'claim',
      args: [beneficiary],
      account: this.account,
      chain: this.clients.walletClient.chain,
    });
    await this.clients.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }
}

/** Spec 6.4: call harvest() when >= 0.005 ETH waits and >= 60 s passed, after a random 0-30 s delay. */
export class ViemHarvester {
  static readonly MIN_ETH = 5n * 10n ** 15n;
  static readonly MIN_INTERVAL_SEC = 60;
  private scheduled = false;

  constructor(
    private readonly clients: ChainClients,
    private readonly treasury: Address,
    private readonly feeEscrow: Address,
    private readonly account: PrivateKeyAccount,
    private readonly random: () => number = Math.random,
  ) {}

  async maybeHarvest(nowSec: number): Promise<void> {
    if (this.scheduled) return;
    const [escrow, balance, lastHarvestAt] = await Promise.all([
      this.clients.publicClient.readContract({ address: this.feeEscrow, abi: ponsEscrowAbi, functionName: 'balanceOf', args: [this.treasury] }),
      this.clients.publicClient.getBalance({ address: this.treasury }),
      this.clients.publicClient.readContract({ address: this.treasury, abi: ponsTreasuryAbi, functionName: 'lastHarvestAt' }),
    ]);
    if (escrow + balance < ViemHarvester.MIN_ETH) return;
    if (nowSec < Number(lastHarvestAt) + ViemHarvester.MIN_INTERVAL_SEC) return;
    this.scheduled = true;
    setTimeout(() => void this.harvest(), this.random() * 30_000);
  }

  private async harvest(): Promise<void> {
    try {
      const hash = await this.clients.walletClient.writeContract({
        address: this.treasury,
        abi: ponsTreasuryAbi,
        functionName: 'harvest',
        account: this.account,
        chain: this.clients.walletClient.chain,
      });
      await this.clients.publicClient.waitForTransactionReceipt({ hash });
    } finally {
      this.scheduled = false;
    }
  }
}

/** Until the PONS price reader lands (plan 05), the price is unknown and batches are always sent. */
/** Rewards are ETH: one reward-wei is worth exactly one wei, so the gas check needs no market price. */
export const ethReward: PriceSource = { weiPerToken: async () => 10n ** 18n };
