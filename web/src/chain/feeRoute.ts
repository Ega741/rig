import { encodeFunctionData, isAddressEqual, type Address, type Hex } from 'viem';
import { ponsFactoryAbi } from './pons';

/** Calldata for `factory.transferCreatorFeeRecipient(token, treasury)` — the launching wallet signs it. */
export function feeRouteCalldata(token: Address, treasury: Address): Hex {
  return encodeFunctionData({ abi: ponsFactoryAbi, functionName: 'transferCreatorFeeRecipient', args: [token, treasury] });
}

export type FeeRoute = 'routed' | 'wallet' | 'unknown';

/** Where the creator fees go today: to the treasury, to some wallet, or the launch is unknown. */
export function feeRouteStatus(exists: boolean, recipient: Address, treasury: Address): FeeRoute {
  if (!exists) return 'unknown';
  return isAddressEqual(recipient, treasury) ? 'routed' : 'wallet';
}
