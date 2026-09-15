import { useState } from 'react';
import { createPublicClient, isAddress, getAddress, type Address } from 'viem';
import type { UiConfig } from '../config';
import { robinhood } from '../../chain/chains';
import { rpcTransport } from '../../chain/transport';
import { feeRouteCalldata, feeRouteStatus, type FeeRoute } from '../../chain/feeRoute';
import { PONS_FACTORY, ponsFactoryAbi } from '../../chain/pons';
import { connectWallet, ensureChain, injectedProvider, sendCall } from '../wallet';
import { shortAddress } from '../format';

interface Launch {
  deployer: Address;
  recipient: Address;
  creatorTaxBps: number;
  pairToken: Address;
  route: FeeRoute;
}

/** Launch day, hidden route #/launch: point the token's creator fees at the treasury from the launching wallet. */
export function Launch({ config }: { config: UiConfig }) {
  const treasury = config.treasury;
  const [token, setToken] = useState(config.ponsToken ?? '');
  const [launch, setLaunch] = useState<Launch | null>(null);
  const [status, setStatus] = useState('');
  const provider = injectedProvider();
  const client = createPublicClient({ chain: robinhood, transport: rpcTransport(robinhood.id, config.ponsRpcUrl) });

  const read = async (): Promise<Launch | null> => {
    if (!treasury || !isAddress(token)) return null;
    const info = await client.readContract({ address: PONS_FACTORY, abi: ponsFactoryAbi, functionName: 'getLaunchedToken', args: [getAddress(token)] });
    const next: Launch = {
      deployer: info.deployer,
      recipient: info.creatorFeeRecipient,
      creatorTaxBps: info.creatorTaxBps,
      pairToken: info.pairToken,
      route: feeRouteStatus(info.exists, info.creatorFeeRecipient, treasury),
    };
    setLaunch(next);
    return next;
  };

  const check = async () => {
    setStatus('');
    try {
      const next = await read();
      if (!next) setStatus('Enter the token address.');
      else if (next.route === 'unknown') setStatus('PONS does not know this token on Robinhood Chain mainnet.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const route = async () => {
    if (!provider || !treasury || !isAddress(token)) return;
    try {
      setStatus('Switching the wallet to Robinhood Chain…');
      await ensureChain(provider, robinhood, config.ponsRpcUrl);
      const account = await connectWallet(provider);
      setStatus(`Confirm in the wallet (${shortAddress(account)}): route fees of ${shortAddress(token)} to the treasury…`);
      const tx = await sendCall(provider, account, PONS_FACTORY, feeRouteCalldata(getAddress(token), treasury));
      setStatus(`Sent ${tx}. Waiting for the receipt…`);
      const receipt = await client.waitForTransactionReceipt({ hash: tx });
      const next = await read();
      setStatus(receipt.status === 'success' && next?.route === 'routed' ? `Done. Fees now go to the treasury (tx ${tx}).` : `Transaction ${receipt.status}: ${tx}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <>
      <h1>Launch</h1>
      <p className="lead">
        After the token is launched on PONS, its creator fees go to the launching wallet. This page moves them to the treasury, which forwards
        every wei to the mining pool. Only the wallet that currently receives the fees can do this.
      </p>
      <section className="panel frame frame--night" aria-label="Fee routing">
        <div className="panel__title">
          <span>Creator fees</span>
          <span>{treasury ? `treasury ${shortAddress(treasury)}` : 'no treasury configured'}</span>
        </div>
        <div className="panel__body">
          {!treasury && <p className="status">Set VITE_TREASURY_ADDRESS (mainnet build) first.</p>}
          <div className="field">
            <label className="label" htmlFor="launch-token">
              Token (CA)
            </label>
            <input id="launch-token" type="text" placeholder="0x…" value={token} onChange={(e) => setToken(e.target.value.trim())} spellCheck={false} />
          </div>
          <div className="actions">
            <button type="button" className="btn btn--ghost frame frame--ghost" onClick={() => void check()} disabled={!treasury || !isAddress(token)}>
              Check
            </button>
            <button
              type="button"
              className="btn frame frame--green"
              onClick={() => void route()}
              disabled={!provider || !treasury || !launch || launch.route !== 'wallet'}
              title={provider ? '' : 'No wallet in this browser'}
            >
              Route fees to the treasury
            </button>
          </div>
          {launch && launch.route !== 'unknown' && (
            <dl className="kv">
              <dt>Fees go to</dt>
              <dd data-testid="fee-route">{launch.route === 'routed' ? `treasury ${shortAddress(launch.recipient)} ✓` : `wallet ${launch.recipient}`}</dd>
              <dt>Launched by</dt>
              <dd>{launch.deployer}</dd>
              <dt>Creator tax</dt>
              <dd>{(launch.creatorTaxBps / 100).toFixed(2)}% {launch.creatorTaxBps === 300 ? '✓' : '— expected 3.00%'}</dd>
              <dt>Quote</dt>
              <dd>{launch.pairToken === '0x0000000000000000000000000000000000000000' ? 'ETH' : `${launch.pairToken} (not ETH — the treasury will refuse to adopt)`}</dd>
            </dl>
          )}
          {status && <p className="status">{status}</p>}
        </div>
      </section>
    </>
  );
}
