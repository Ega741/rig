// Read-only view of a PONS V2 launch on Robinhood Chain: where the creator's fees sit right now
// (fee escrow, the bonding curve, the Uniswap v4 hook) and what the market looks like.
// Contract shapes follow github.com/ponsdotdev/ponsfamily contractsV2 and were checked on mainnet.
import {
  encodeAbiParameters,
  getAddress,
  keccak256,
  parseAbi,
  parseAbiItem,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem';

export const PONS_FACTORY: Address = '0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e';
export const ROBINHOOD_RPC = 'https://rpc.mainnet.chain.robinhood.com';
const ETH: Address = '0x0000000000000000000000000000000000000000';
const BPS = 10_000n;
const Q192 = 1n << 192n;
/** Uniswap v4 PoolManager: `pools` mapping lives in slot 6; slot0 is the first word of a pool's state. */
const POOLS_SLOT = 6n;

export const ponsFactoryAbi = parseAbi([
  'struct LaunchedToken { address token; address curve; address deployer; address creatorFeeRecipient; address pairToken; uint256 graduationThreshold; uint24 poolFee; int24 tickSpacing; uint16 creatorTaxBps; bool buybackEnabled; uint8 phase; uint256 sweptQuote; uint256 sweptTokens; uint256 sweptAt; bool exists; }',
  'struct FeePolicySnapshot { address protocolFeeRecipient; uint16 protocolFeeShareBps; uint16 buybackBurnBps; uint16 hookFeeBps; uint16 maxInternalPriceImpactBps; }',
  'function getLaunchedToken(address token) view returns (LaunchedToken)',
  'function getLaunchFeePolicy(address token) view returns (FeePolicySnapshot)',
  'function memeHook() view returns (address)',
  'function feeEscrow() view returns (address)',
  'function poolManager() view returns (address)',
]);

export const ponsCurveAbi = parseAbi([
  'function getReserves() view returns (uint256 quoteReserve, uint256 tokenReserve)',
  'function realQuoteReserve() view returns (uint256)',
  'function phantomQuote() view returns (uint256)',
  'function graduationThreshold() view returns (uint256)',
  'function quoteFeeBalance() view returns (uint256)',
  'function creatorTaxBalance() view returns (uint256)',
  'function feeBps() view returns (uint256)',
  'function creatorTaxBps() view returns (uint256)',
  'function protocolFeeShareBps() view returns (uint16)',
  'function graduated() view returns (bool)',
]);

export const ponsHookAbi = parseAbi([
  'function pendingFees(bytes32 poolId, address currency) view returns (uint256)',
  'function pendingCreatorTax(bytes32 poolId, address currency) view returns (uint256)',
]);

export const ponsEscrowViewAbi = parseAbi([
  'function balanceOf(address recipient) view returns (uint256)',
  'function balanceOfToken(address recipient, address token) view returns (uint256)',
]);
export const poolManagerAbi = parseAbi(['function extsload(bytes32 slot) view returns (bytes32)']);
export const erc20MetaAbi = parseAbi([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function totalSupply() view returns (uint256)',
  'function decimals() view returns (uint8)',
]);

export const tokenLaunchedEvent = parseAbiItem(
  'event TokenLaunched(address indexed token, address indexed curve, address indexed deployer, address pairToken, uint256 launchConfigId, uint256 graduationThreshold)',
);
export const curveBuyEvent = parseAbiItem(
  'event CurveBuy(address indexed buyer, address indexed recipient, uint256 quoteIn, uint256 tokensOut, uint256 fee, uint256 tax)',
);
export const curveSellEvent = parseAbiItem(
  'event CurveSell(address indexed seller, address indexed recipient, uint256 tokensIn, uint256 quoteOut, uint256 fee, uint256 tax)',
);
export const hookFeeCollectedEvent = parseAbiItem(
  'event HookFeeCollected(bytes32 indexed poolId, address currency, uint256 feeAmount, uint256 taxAmount)',
);

export enum PonsPhase {
  NotGraduated = 0,
  Swept = 1,
  PoolCreated = 2,
  Rescued = 3,
}

/** Currency order of the graduated pool, as PonsV2LaunchFactory._sortCurrencies does it. */
export function sortCurrencies(token: Address, quote: Address): { currency0: Address; currency1: Address; tokenIsCurrency0: boolean } {
  const tokenIsCurrency0 = BigInt(quote) >= BigInt(token);
  return tokenIsCurrency0 ? { currency0: token, currency1: quote, tokenIsCurrency0 } : { currency0: quote, currency1: token, tokenIsCurrency0 };
}

/** PoolId = keccak256(abi.encode(PoolKey)); the quote is native ETH (address 0) or the launch's pairToken. */
export function computePoolId(token: Address, quote: Address, poolFee: number, tickSpacing: number, hook: Address): Hex {
  const { currency0, currency1 } = sortCurrencies(token, quote);
  return keccak256(
    encodeAbiParameters(
      [{ type: 'address' }, { type: 'address' }, { type: 'uint24' }, { type: 'int24' }, { type: 'address' }],
      [currency0, currency1, poolFee, tickSpacing, hook],
    ),
  );
}

/** Storage slot of a pool's slot0 inside the PoolManager (StateLibrary._getPoolStateSlot). */
export function poolStateSlot(poolId: Hex): Hex {
  return keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'uint256' }], [poolId, POOLS_SLOT]));
}

/**
 * Quote units per whole token (1e18 token-wei) from a v4 sqrtPriceX96. price1/0 = (sqrtP / 2^96)^2 is
 * currency1 per currency0; which side the token sits on decides the direction.
 */
export function quotePerTokenFromSqrtPrice(sqrtPriceX96: bigint, tokenIsCurrency0: boolean): bigint {
  if (sqrtPriceX96 === 0n) return 0n;
  const sq = sqrtPriceX96 * sqrtPriceX96;
  return tokenIsCurrency0 ? (sq * 10n ** 18n) / Q192 : (Q192 * 10n ** 18n) / sq;
}

/** Kept for callers that know the quote is currency0 (native ETH against any token). */
export function weiPerTokenFromSqrtPrice(sqrtPriceX96: bigint): bigint {
  return quotePerTokenFromSqrtPrice(sqrtPriceX96, false);
}

/** Quote units per whole token on a constant-product curve. */
export function weiPerTokenFromReserves(quoteReserve: bigint, tokenReserve: bigint): bigint {
  if (tokenReserve === 0n) return 0n;
  return (quoteReserve * 10n ** 18n) / tokenReserve;
}

/** The creator's part of a base fee amount: everything except the protocol share (buyback assumed off). */
export function creatorShareOfFee(fee: bigint, protocolFeeShareBps: number, buybackEnabled: boolean, buybackBurnBps: number): bigint {
  const afterProtocol = fee - (fee * BigInt(protocolFeeShareBps)) / BPS;
  if (!buybackEnabled) return afterProtocol;
  return afterProtocol - (afterProtocol * BigInt(buybackBurnBps)) / BPS;
}

export interface PonsSnapshot {
  blockNumber: bigint;
  token: Address;
  name: string;
  symbol: string;
  totalSupply: bigint;
  /** Quote asset: address 0 for native ETH, otherwise the launch's pairToken. All amounts below are in its units. */
  quote: Address;
  quoteSymbol: string;
  quoteDecimals: number;
  curve: Address;
  deployer: Address;
  creatorFeeRecipient: Address;
  creatorTaxBps: number;
  baseFeeBps: number;
  protocolFeeShareBps: number;
  buybackEnabled: boolean;
  phase: PonsPhase;
  /** Bonding curve (meaningful before graduation). */
  quoteReserve: bigint;
  realQuoteReserve: bigint;
  tokenReserve: bigint;
  graduationThreshold: bigint;
  curveFeePending: bigint;
  curveTaxPending: bigint;
  /** Fee escrow: ETH the recipient can claim right now. */
  escrowClaimable: bigint;
  /** Uniswap v4 hook (after graduation). */
  poolId: Hex | null;
  hookFeeEth: bigint;
  hookTaxEth: bigint;
  hookFeeToken: bigint;
  hookTaxToken: bigint;
  /** Derived. */
  weiPerToken: bigint;
  marketCapWei: bigint;
  creatorOnCurveWei: bigint;
  creatorInHookWei: bigint;
  creatorInHookTokenWei: bigint;
  creatorTotalWei: bigint;
}

/** One consistent read of everything the fees page shows. Multicall where the chain has it, parallel calls otherwise. */
export async function readPonsSnapshot(client: PublicClient, token: Address): Promise<PonsSnapshot> {
  const factory = { address: PONS_FACTORY, abi: ponsFactoryAbi } as const;
  const [launched, policy, hook, escrow, poolManager, blockNumber] = await Promise.all([
    client.readContract({ ...factory, functionName: 'getLaunchedToken', args: [token] }),
    client.readContract({ ...factory, functionName: 'getLaunchFeePolicy', args: [token] }),
    client.readContract({ ...factory, functionName: 'memeHook' }),
    client.readContract({ ...factory, functionName: 'feeEscrow' }),
    client.readContract({ ...factory, functionName: 'poolManager' }),
    client.getBlockNumber(),
  ]);
  if (!launched.exists) throw new Error(`${token} is not a PONS launch`);
  const curve = { address: launched.curve, abi: ponsCurveAbi } as const;
  const meta = { address: token, abi: erc20MetaAbi } as const;
  const quote = launched.pairToken;
  const quoteIsEth = quote.toLowerCase() === ETH;
  const [quoteSymbol, quoteDecimals] = quoteIsEth
    ? ['ETH', 18]
    : await Promise.all([
        client.readContract({ address: quote, abi: erc20MetaAbi, functionName: 'symbol' }),
        client.readContract({ address: quote, abi: erc20MetaAbi, functionName: 'decimals' }),
      ]);
  const [name, symbol, totalSupply, reserves, realQuote, graduationThreshold, curveFeePending, curveTaxPending, baseFeeBps, escrowClaimable] =
    await Promise.all([
      client.readContract({ ...meta, functionName: 'name' }),
      client.readContract({ ...meta, functionName: 'symbol' }),
      client.readContract({ ...meta, functionName: 'totalSupply' }),
      client.readContract({ ...curve, functionName: 'getReserves' }),
      client.readContract({ ...curve, functionName: 'realQuoteReserve' }),
      client.readContract({ ...curve, functionName: 'graduationThreshold' }),
      client.readContract({ ...curve, functionName: 'quoteFeeBalance' }),
      client.readContract({ ...curve, functionName: 'creatorTaxBalance' }),
      client.readContract({ ...curve, functionName: 'feeBps' }),
      quoteIsEth
        ? client.readContract({ address: escrow, abi: ponsEscrowViewAbi, functionName: 'balanceOf', args: [launched.creatorFeeRecipient] })
        : client.readContract({ address: escrow, abi: ponsEscrowViewAbi, functionName: 'balanceOfToken', args: [launched.creatorFeeRecipient, quote] }),
    ]);

  const phase = launched.phase as PonsPhase;
  let poolId: Hex | null = null;
  let hookFeeEth = 0n;
  let hookTaxEth = 0n;
  let hookFeeToken = 0n;
  let hookTaxToken = 0n;
  let weiPerToken = weiPerTokenFromReserves(reserves[0], reserves[1]);
  if (phase === PonsPhase.PoolCreated) {
    poolId = computePoolId(token, quote, launched.poolFee, launched.tickSpacing, hook);
    const hookContract = { address: hook, abi: ponsHookAbi } as const;
    const [fe, te, ft, tt, slot0] = await Promise.all([
      client.readContract({ ...hookContract, functionName: 'pendingFees', args: [poolId, quote] }),
      client.readContract({ ...hookContract, functionName: 'pendingCreatorTax', args: [poolId, quote] }),
      client.readContract({ ...hookContract, functionName: 'pendingFees', args: [poolId, token] }),
      client.readContract({ ...hookContract, functionName: 'pendingCreatorTax', args: [poolId, token] }),
      client.readContract({ address: poolManager, abi: poolManagerAbi, functionName: 'extsload', args: [poolStateSlot(poolId)] }),
    ]);
    hookFeeEth = fe;
    hookTaxEth = te;
    hookFeeToken = ft;
    hookTaxToken = tt;
    const sqrtPriceX96 = BigInt(slot0) & ((1n << 160n) - 1n);
    weiPerToken = quotePerTokenFromSqrtPrice(sqrtPriceX96, sortCurrencies(token, quote).tokenIsCurrency0);
  }

  const share = (fee: bigint) => creatorShareOfFee(fee, policy.protocolFeeShareBps, launched.buybackEnabled, policy.buybackBurnBps);
  const creatorOnCurveWei = phase === PonsPhase.NotGraduated ? curveTaxPending + share(curveFeePending) : 0n;
  const creatorInHookWei = hookTaxEth + share(hookFeeEth);
  const creatorInHookTokenWei = hookTaxToken + share(hookFeeToken);
  const creatorTotalWei = escrowClaimable + creatorOnCurveWei + creatorInHookWei + (creatorInHookTokenWei * weiPerToken) / 10n ** 18n;

  return {
    blockNumber,
    token: getAddress(token),
    name,
    symbol,
    totalSupply,
    quote,
    quoteSymbol,
    quoteDecimals,
    curve: launched.curve,
    deployer: launched.deployer,
    creatorFeeRecipient: launched.creatorFeeRecipient,
    creatorTaxBps: launched.creatorTaxBps,
    baseFeeBps: Number(baseFeeBps),
    protocolFeeShareBps: policy.protocolFeeShareBps,
    buybackEnabled: launched.buybackEnabled,
    phase,
    quoteReserve: reserves[0],
    realQuoteReserve: realQuote,
    tokenReserve: reserves[1],
    graduationThreshold,
    curveFeePending,
    curveTaxPending,
    escrowClaimable,
    poolId,
    hookFeeEth,
    hookTaxEth,
    hookFeeToken,
    hookTaxToken,
    weiPerToken,
    marketCapWei: (weiPerToken * totalSupply) / 10n ** 18n,
    creatorOnCurveWei,
    creatorInHookWei,
    creatorInHookTokenWei,
    creatorTotalWei,
  };
}

export interface FeeHistory {
  launchBlock: bigint;
  scannedTo: bigint;
  /** Base fee + creator tax charged on the curve and in the hook (ETH side), in wei. */
  curveFeeWei: bigint;
  curveTaxWei: bigint;
  hookFeeEth: bigint;
  hookTaxEth: bigint;
  hookFeeToken: bigint;
  hookTaxToken: bigint;
  /** Quote volume on the curve (buys + sells), in wei. */
  curveVolumeWei: bigint;
  trades: number;
}

const CHUNK = 200_000n;

/** Block of the TokenLaunched event, searched backwards from the tip in chunks the public RPC accepts. */
export async function findLaunchBlock(client: PublicClient, token: Address, latest: bigint): Promise<bigint> {
  let to = latest;
  while (to > 0n) {
    const from = to > CHUNK ? to - CHUNK + 1n : 0n;
    const logs = await client.getLogs({ address: PONS_FACTORY, event: tokenLaunchedEvent, args: { token }, fromBlock: from, toBlock: to });
    if (logs.length > 0) return logs[0]!.blockNumber;
    if (from === 0n) break;
    to = from - 1n;
  }
  throw new Error('TokenLaunched not found');
}

/** Sums fee events from `from` to `to` (inclusive) into `history`; call again with a later range to extend it. */
export async function scanFees(
  client: PublicClient,
  snapshot: Pick<PonsSnapshot, 'curve' | 'poolId' | 'quote'>,
  hook: Address,
  history: FeeHistory,
  to: bigint,
): Promise<FeeHistory> {
  let from = history.scannedTo + 1n;
  const next = { ...history };
  while (from <= to) {
    const end = from + CHUNK - 1n < to ? from + CHUNK - 1n : to;
    const [buys, sells, hooked] = await Promise.all([
      client.getLogs({ address: snapshot.curve, event: curveBuyEvent, fromBlock: from, toBlock: end }),
      client.getLogs({ address: snapshot.curve, event: curveSellEvent, fromBlock: from, toBlock: end }),
      snapshot.poolId
        ? client.getLogs({ address: hook, event: hookFeeCollectedEvent, args: { poolId: snapshot.poolId }, fromBlock: from, toBlock: end })
        : Promise.resolve([]),
    ]);
    for (const b of buys) {
      next.curveFeeWei += b.args.fee!;
      next.curveTaxWei += b.args.tax!;
      next.curveVolumeWei += b.args.quoteIn!;
      next.trades += 1;
    }
    for (const s of sells) {
      next.curveFeeWei += s.args.fee!;
      next.curveTaxWei += s.args.tax!;
      next.curveVolumeWei += s.args.quoteOut!;
      next.trades += 1;
    }
    for (const h of hooked) {
      const isQuote = h.args.currency!.toLowerCase() === snapshot.quote.toLowerCase();
      if (isQuote) {
        next.hookFeeEth += h.args.feeAmount!;
        next.hookTaxEth += h.args.taxAmount!;
      } else {
        next.hookFeeToken += h.args.feeAmount!;
        next.hookTaxToken += h.args.taxAmount!;
      }
      next.trades += 1;
    }
    next.scannedTo = end;
    from = end + 1n;
  }
  return next;
}

export function emptyHistory(launchBlock: bigint): FeeHistory {
  return {
    launchBlock,
    scannedTo: launchBlock - 1n,
    curveFeeWei: 0n,
    curveTaxWei: 0n,
    hookFeeEth: 0n,
    hookTaxEth: 0n,
    hookFeeToken: 0n,
    hookTaxToken: 0n,
    curveVolumeWei: 0n,
    trades: 0,
  };
}
