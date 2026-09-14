#!/usr/bin/env bash
# Launch day: put the PONS token address on the site and deploy. Usage: scripts/set-token.sh 0xCA [.env.testnet|.env.mainnet]
# Writes VITE_PONS_TOKEN, checks the launch exists on PONS mainnet, builds, deploys to production, verifies the live bundle.
set -euo pipefail
CA="${1:?token address}"; ENVFILE="${2:-.env.testnet}"
cd "$(dirname "$0")/.."
[[ "$CA" =~ ^0x[0-9a-fA-F]{40}$ ]] || { echo "not an address: $CA"; exit 1; }
CA_LOWER="$(echo "$CA" | tr '[:upper:]' '[:lower:]')"
# The launch must exist on PONS before it goes on the site (getLaunchedToken(token).exists).
EXISTS="$(cast call --rpc-url https://rpc.mainnet.chain.robinhood.com 0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e \
  'getLaunchedToken(address)((address,address,address,address,address,uint256,uint24,int24,uint16,bool,uint8,uint256,uint256,uint256,bool))' "$CA" | tail -c 8)"
[[ "$EXISTS" == *true* ]] || { echo "PONS factory does not know $CA (exists=false) — wrong address or wrong chain"; exit 1; }
if grep -q '^#\?VITE_PONS_TOKEN=' "$ENVFILE"; then
  sed -i '' "s|^#\?VITE_PONS_TOKEN=.*|VITE_PONS_TOKEN=$CA_LOWER|" "$ENVFILE"
else
  printf 'VITE_PONS_TOKEN=%s\n' "$CA_LOWER" >> "$ENVFILE"
fi
MODE="${ENVFILE#.env.}"
npm run "build:$MODE" >/dev/null
grep -q "$CA_LOWER" dist/assets/main-*.js || { echo "token address missing from the built bundle"; exit 1; }
npx vercel --prod --yes 2>&1 | grep -E "Production|Error" | head -2
sleep 20
BUNDLE="$(curl -s -m 30 https://rig.fan/ | grep -oE 'assets/main-[A-Za-z0-9_-]+\.js' | head -1)"
if curl -s -m 30 "https://rig.fan/$BUNDLE" | grep -q "$CA_LOWER"; then echo "LIVE: rig.fan/#/token shows $CA"; else echo "live bundle $BUNDLE does not contain the token yet — recheck in a minute"; exit 1; fi
