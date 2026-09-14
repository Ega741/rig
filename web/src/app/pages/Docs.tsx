import type { UiConfig } from '../config';

export function Docs({ config }: { config: UiConfig }) {
  return (
    <article className="prose">
      <h1>How it works</h1>
      <p className="lead">
        Your browser hashes <code>keccak256(your address ‖ round challenge ‖ nonce)</code> until the result starts with enough zero bits. Each such
        hash is a share. Shares go to the HashMine contract in batches of up to 64, and the contract recomputes every hash before it counts.
      </p>
      <h2>Rounds</h2>
      <p>
        A round lasts {config.chain.id === 31337 ? '30 seconds on this local chain' : '10 minutes'}. When a round with at least one share ends, the
        contract releases 0.48% of its token balance and splits it between everyone who sent shares, in proportion to work. A share of difficulty D
        counts as 2<sup>D</sup> work. Empty rounds release nothing and never catch up.
      </p>
      <h2>Difficulty</h2>
      <p>
        The contract sets a minimum difficulty from the work of the last active round, aiming at about 4 096 shares per round, and lowers it one bit
        for every empty round. Your miner picks its own difficulty above that minimum so that it finds about 32 shares per round and each share is
        worth at least twice the gas it costs to send.
      </p>
      <h2>Where the tokens come from</h2>
      <p>
        Trading the token pays a 3% fee. The part that reaches the project is spent buying the token back on the market and sending it to the mining
        pool. Nothing is minted, nothing is reserved for the team: the pool is exactly what buybacks and donations put there.
      </p>
      <h2>Keys</h2>
      <p>
        The session key in this browser only pays gas. Rewards go to the beneficiary address bound inside every hash, so a stolen share is worthless to
        anyone else, and anyone can call <code>claim</code> on your behalf without being able to redirect it.
      </p>
      <h2>Contracts</h2>
      <dl className="kv">
        <dt>Network</dt>
        <dd>
          {config.chain.name} (chain id {config.chain.id})
        </dd>
        <dt>HashMine</dt>
        <dd>{config.hashMine}</dd>
        {config.treasury && (
          <>
            <dt>Treasury</dt>
            <dd>{config.treasury}</dd>
          </>
        )}
        <dt>RPC</dt>
        <dd>{config.rpcUrl}</dd>
      </dl>
    </article>
  );
}
