// Reads a real PONS launch on Robinhood Chain. Skipped unless PONS_TOKEN is set:
//   PONS_TOKEN=0x… npx vitest run src/chain/__tests__/pons.mainnet.test.ts
import { describe, expect, it } from 'vitest';
import { createPublicClient, formatEther, http, type Address } from 'viem';
import { robinhood } from '../chains';
import { parseAbi } from 'viem';
import { PONS_FACTORY, PonsPhase, emptyHistory, findLaunchBlock, ponsFactoryAbi, readPonsSnapshot, scanFees } from '../pons';

const hookLaunchesAbi = parseAbi([
  'function launches(bytes32 poolId) view returns (bool registered, bool memecoinIsCurrency0, address memecoin, address quoteToken, address creator, address buybackCreatorRecipient, address protocolFeeRecipient, uint16 creatorTaxBps, uint16 protocolFeeShareBps, uint16 buybackBurnBps, uint16 hookFeeBps, uint16 maxInternalPriceImpactBps, bool buybackEnabled)',
]);

const token = process.env.PONS_TOKEN as Address | undefined;

describe.skipIf(!token)('pons mainnet read', () => {
  it('reads a consistent snapshot and fee history', async () => {
    const client = createPublicClient({ chain: robinhood, transport: http(process.env.PONS_RPC) });
    const s = await readPonsSnapshot(client, token!);
    console.log(`${s.name} (${s.symbol}) phase=${PonsPhase[s.phase]} block=${s.blockNumber} quote=${s.quoteSymbol} (${s.quote}, ${s.quoteDecimals} dec)`);
    console.log(`price ${formatEther(s.weiPerToken)} ETH/token, mcap ${formatEther(s.marketCapWei)} ETH, curve ${formatEther(s.realQuoteReserve)}/${formatEther(s.graduationThreshold)} ETH`);
    console.log(`creator: escrow ${formatEther(s.escrowClaimable)} + curve ${formatEther(s.creatorOnCurveWei)} + hook ${formatEther(s.creatorInHookWei)} ETH (+${formatEther(s.creatorInHookTokenWei)} tokens) = ${formatEther(s.creatorTotalWei)} ETH`);
    expect(s.totalSupply).toBe(10n ** 27n);
    expect(s.creatorTotalWei).toBeGreaterThanOrEqual(s.escrowClaimable);
    expect(s.weiPerToken).toBeGreaterThan(0n);
    if (s.poolId) {
      const launch = await client.readContract({ address: await client.readContract({ address: PONS_FACTORY, abi: ponsFactoryAbi, functionName: 'memeHook' }), abi: hookLaunchesAbi, functionName: 'launches', args: [s.poolId] });
      expect(launch[0]).toBe(true); // registered
    }

    const hook = await client.readContract({ address: PONS_FACTORY, abi: ponsFactoryAbi, functionName: 'memeHook' });
    const launchBlock = await findLaunchBlock(client, token!, s.blockNumber);
    const history = await scanFees(client, s, hook, emptyHistory(launchBlock), s.blockNumber);
    console.log(
      `since block ${launchBlock}: ${history.trades} trades, curve volume ${formatEther(history.curveVolumeWei)} ETH, fees ${formatEther(history.curveFeeWei)} + tax ${formatEther(history.curveTaxWei)} ETH; hook eth fee ${formatEther(history.hookFeeEth)} tax ${formatEther(history.hookTaxEth)}`,
    );
    expect(history.scannedTo).toBe(s.blockNumber);
    expect(launchBlock).toBeLessThanOrEqual(s.blockNumber);
  }, 120_000);
});
