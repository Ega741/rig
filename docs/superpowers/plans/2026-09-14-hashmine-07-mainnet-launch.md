# Rig — launch-day runbook (mainnet 4663)

Order matters: the treasury must exist before the fee recipient can point at it. Everything here except the
wallet transactions is one command.

## Before launch (needs the user once)

1. **Fund the mainnet deployer** `0x97D3dA2Df311a429954c2661B754dfC500F82B7C` with ~0.002 ETH on Robinhood Chain
   (gas ≈ 0.07 gwei; two contracts ≈ 0.0003 ETH). Key: `contracts/.env` → `MAINNET_DEPLOYER_KEY`.
2. **Deploy** (`TREASURY_OWNER` = the deployer unless the user names a wallet; the owner can only `adopt` and
   propose a 7-day-timelocked migration, it cannot withdraw). `TEAM_WALLET` receives `TEAM_BPS` (6000 = 60 %) of
   every harvest, the rest goes to HashMine; both are immutable. `HASHMINE_ADDRESS` reuses a deployed HashMine:
   ```bash
   cd contracts && set -a && . ./.env && set +a && TREASURY_OWNER=$MAINNET_DEPLOYER_ADDRESS TEAM_WALLET=0x… TEAM_BPS=6000 \
     forge script script/DeployMainnet.s.sol:DeployMainnet --rpc-url robinhood_public --broadcast
   ```
   Record `HASHMINE`, `TREASURY` in `contracts/deployments-mainnet.json`.
3. **Switch the site to mainnet**: fill `web/.env.mainnet` (`VITE_HASHMINE_ADDRESS`, `VITE_TREASURY_ADDRESS`),
   set `vercel.json` `buildCommand` to `npm run build:mainnet`, `cd web && npx vercel --prod --yes`.
   Check: Docs page shows "Robinhood Chain (chain id 4663)" and the new HashMine address.

## Launch (user, on the PONS site, from their wallet)

- Pair: **ETH**. Creator tax: **3 %** (`creatorTaxBps = 300`) — total 4 % with the PONS base fee. Buyback: **off**.
- If the PONS form has a "creator fee recipient" field: put the **TREASURY** address there and skip step "transfer".

## Right after launch

1. User sends the CA.
2. **Transfer the fee stream** — only the current recipient (the launching wallet) can do this
   (fork test `PonsFactoryAccess.t.sol`: deployer-but-not-recipient and strangers are refused).
   Easiest: open **https://rig.fan/#/launch** in the browser with the launching wallet, paste the CA, **Check**
   (shows "fees go to wallet …"), **Route fees to the treasury** → one wallet popup
   (`factory.transferCreatorFeeRecipient(CA, TREASURY)`); the page re-reads and shows "treasury … ✓".
   Fallback: Blockscout write tab
   https://robinhoodchain.blockscout.com/address/0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e?tab=write_contract.
   Fees earned before this call sit in the PONS escrow for the wallet; claim them and send the ETH to HashMine by a
   plain transfer if they should reach the miners.
3. **Adopt** (treasury owner): `cast send $TREASURY 'adopt(address)' $CA --rpc-url robinhood_public --private-key $MAINNET_DEPLOYER_KEY`.
   Check: `cast call $TREASURY 'token()(address)'` == CA.
4. **CA on the site**: `cd web && scripts/set-token.sh $CA .env.mainnet` — verifies the launch exists on PONS,
   writes `VITE_PONS_TOKEN`, builds, deploys, checks the live bundle. Token page shows fees/price/graduation.
5. First `harvest()` after the first trades: the site calls it from session keys when ≥ 0.005 ETH waits
   (`ViemHarvester`), or manually: `cast send $TREASURY 'harvest()' ...`. Check `cast balance $HASHMINE`.

## Post

- CA post (text ready in chat), pinned; CA in the X bio.
- Round-1 image: `web/brand/round1-top3.html` → `node scripts/render-post.mjs …`; real numbers from
  `RoundClosed`/`Claimed` events once round 1 closes.
