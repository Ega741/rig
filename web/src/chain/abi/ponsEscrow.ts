/** The part of PONS's fee escrow the client reads (IPonsFeeEscrow.balanceOf). */
export const ponsEscrowAbi = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'recipient', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;
