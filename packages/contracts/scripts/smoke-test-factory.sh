#!/usr/bin/env bash
set -euo pipefail

RPC_URL="${ROBINHOOD_TESTNET_RPC_URL:-https://rpc.testnet.chain.robinhood.com/}"
FACTORY_ADDRESS="${FACTORY_ADDRESS:-}"

if [[ ! "$FACTORY_ADDRESS" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
  echo "FACTORY_ADDRESS must be a valid EVM address." >&2
  exit 1
fi

CHAIN_ID="$(cast chain-id --rpc-url "$RPC_URL")"
if [[ "$CHAIN_ID" != "46630" ]]; then
  echo "Refusing smoke test: RPC is chain $CHAIN_ID, not Robinhood testnet 46630." >&2
  exit 1
fi

CODE="$(cast code "$FACTORY_ADDRESS" --rpc-url "$RPC_URL")"
if [[ "$CODE" == "0x" ]]; then
  echo "No contract bytecode found at $FACTORY_ADDRESS." >&2
  exit 1
fi

COUNT="$(cast call "$FACTORY_ADDRESS" 'launchCount()(uint256)' --rpc-url "$RPC_URL")"
echo "Factory bytecode present. launchCount(): $COUNT"
