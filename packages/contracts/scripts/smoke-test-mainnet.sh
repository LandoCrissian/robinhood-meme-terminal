#!/usr/bin/env bash
set -euo pipefail

EXPECTED_CHAIN_ID="4663"
CANONICAL_POOL_MANAGER="0x8366a39cC670b4001A1121b8F6A443A643E40951"
EXPECTED_MARKET_FEE_BPS="100"
EXPECTED_VIRTUAL_ETH="300000000000000000"
EXPECTED_VIRTUAL_TOKEN="1017500000000000000000000000"
EXPECTED_GRADUATION_TARGET="2000000000000000000"
EXPECTED_REGISTRY_DELAY="172800"
EXPECTED_REWARD_DELAY="86400"
EXPECTED_PROTOCOL_GOVERNANCE_DELAY="86400"
EXPECTED_FACTORY_VERSION="$(cast keccak 'RMT_FACTORY_V4')"
EXPECTED_PURPOSES=(
  "$(cast keccak 'PROTOCOL_TREASURY')"
  "$(cast keccak 'BUYBACK_RESERVE')"
  "$(cast keccak 'GRADUATION_ASSISTANCE')"
  "$(cast keccak 'REFERRAL_RESERVE')"
  "$(cast keccak 'ECOSYSTEM_GROWTH')"
)

RPC_URL="${ROBINHOOD_MAINNET_RPC_URL:-}"
FACTORY_ADDRESS="${FACTORY_ADDRESS:-}"
ROUTER_ADDRESS="${ROUTER_ADDRESS:-}"
REGISTRY_ADDRESS="${REGISTRY_ADDRESS:-}"
CONTROLLER_ADDRESS="${CONTROLLER_ADDRESS:-}"
EXPECTED_SIGNERS=("${SIGNER_ONE:-}" "${SIGNER_TWO:-}" "${SIGNER_THREE:-}")

fail() {
  echo "Mainnet smoke test failed: $1" >&2
  exit 1
}

normalize() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

for NAME in RPC_URL FACTORY_ADDRESS ROUTER_ADDRESS REGISTRY_ADDRESS CONTROLLER_ADDRESS; do
  VALUE="${!NAME}"
  [[ -n "$VALUE" ]] || fail "$NAME is required."
done
for ADDRESS in "$FACTORY_ADDRESS" "$ROUTER_ADDRESS" "$REGISTRY_ADDRESS" "$CONTROLLER_ADDRESS" "${EXPECTED_SIGNERS[@]}"; do
  [[ "$ADDRESS" =~ ^0x[0-9a-fA-F]{40}$ ]] || fail "invalid expected address: $ADDRESS."
done

[[ "$(cast chain-id --rpc-url "$RPC_URL")" == "$EXPECTED_CHAIN_ID" ]] || fail "RPC is not Robinhood Chain mainnet."
for ADDRESS in "$FACTORY_ADDRESS" "$ROUTER_ADDRESS" "$REGISTRY_ADDRESS" "$CONTROLLER_ADDRESS"; do
  [[ "$(cast code "$ADDRESS" --rpc-url "$RPC_URL")" != "0x" ]] || fail "protocol contract has no bytecode at $ADDRESS."
done

ADAPTER="$(cast call "$FACTORY_ADDRESS" 'graduationAdapter()(address)' --rpc-url "$RPC_URL")"
HOOK="$(cast call "$ADAPTER" 'hook()(address)' --rpc-url "$RPC_URL")"
MANAGER="$(cast call "$ADAPTER" 'poolManager()(address)' --rpc-url "$RPC_URL")"
BOUND_FACTORY="$(cast call "$ADAPTER" 'factory()(address)' --rpc-url "$RPC_URL")"
BOUND_ADAPTER="$(cast call "$HOOK" 'adapter()(address)' --rpc-url "$RPC_URL")"
ROUTER="$(cast call "$FACTORY_ADDRESS" 'platformTreasury()(address)' --rpc-url "$RPC_URL")"
CONTROLLER="$(cast call "$FACTORY_ADDRESS" 'rewardsController()(address)' --rpc-url "$RPC_URL")"
CONTROLLER_FACTORY="$(cast call "$CONTROLLER_ADDRESS" 'factory()(address)' --rpc-url "$RPC_URL")"
REWARDS_GOVERNANCE="$(cast call "$CONTROLLER_ADDRESS" 'governance()(address)' --rpc-url "$RPC_URL")"
CONTROLLER_DELAY="$(cast call "$CONTROLLER_ADDRESS" 'releaseDelay()(uint256)' --rpc-url "$RPC_URL" | awk '{print $1}')"
FACTORY_GOVERNANCE="$(cast call "$REGISTRY_ADDRESS" 'governance()(address)' --rpc-url "$RPC_URL")"

FEE="$(cast call "$FACTORY_ADDRESS" 'marketFeeBps()(uint16)' --rpc-url "$RPC_URL" | awk '{print $1}')"
VIRTUAL_ETH="$(cast call "$FACTORY_ADDRESS" 'initialVirtualEthReserve()(uint256)' --rpc-url "$RPC_URL" | awk '{print $1}')"
VIRTUAL_TOKEN="$(cast call "$FACTORY_ADDRESS" 'initialVirtualTokenReserve()(uint256)' --rpc-url "$RPC_URL" | awk '{print $1}')"
TARGET="$(cast call "$FACTORY_ADDRESS" 'graduationTarget()(uint256)' --rpc-url "$RPC_URL" | awk '{print $1}')"
COUNT="$(cast call "$FACTORY_ADDRESS" 'launchCount()(uint256)' --rpc-url "$RPC_URL" | awk '{print $1}')"

TOKEN_IMPLEMENTATION="$(cast call "$FACTORY_ADDRESS" 'tokenImplementation()(address)' --rpc-url "$RPC_URL")"
REWARD_IMPLEMENTATION="$(cast call "$FACTORY_ADDRESS" 'rewardVaultImplementation()(address)' --rpc-url "$RPC_URL")"
MARKET_IMPLEMENTATION="$(cast call "$FACTORY_ADDRESS" 'marketImplementation()(address)' --rpc-url "$RPC_URL")"
PURPOSE_IMPLEMENTATION="$(cast call "$FACTORY_ADDRESS" 'purposeVaultImplementation()(address)' --rpc-url "$RPC_URL")"

REGISTRY_FACTORY="$(cast call "$REGISTRY_ADDRESS" 'activeFactory()(address)' --rpc-url "$RPC_URL")"
REGISTRY_VERSION="$(cast call "$REGISTRY_ADDRESS" 'activeVersion()(bytes32)' --rpc-url "$RPC_URL")"
REGISTRY_DELAY="$(cast call "$REGISTRY_ADDRESS" 'activationDelay()(uint256)' --rpc-url "$RPC_URL" | awk '{print $1}')"

FAIR_DELAY="$(cast call "$MARKET_IMPLEMENTATION" 'FAIR_START_DELAY_BLOCKS()(uint256)' --rpc-url "$RPC_URL" | awk '{print $1}')"
FAIR_DURATION="$(cast call "$MARKET_IMPLEMENTATION" 'FAIR_START_DURATION_BLOCKS()(uint256)' --rpc-url "$RPC_URL" | awk '{print $1}')"
FAIR_TX_CAP="$(cast call "$MARKET_IMPLEMENTATION" 'FAIR_START_MAX_TX_BPS()(uint16)' --rpc-url "$RPC_URL" | awk '{print $1}')"
FAIR_WALLET_CAP="$(cast call "$MARKET_IMPLEMENTATION" 'FAIR_START_MAX_WALLET_BPS()(uint16)' --rpc-url "$RPC_URL" | awk '{print $1}')"

for ADDRESS in "$ADAPTER" "$HOOK" "$MANAGER" "$TOKEN_IMPLEMENTATION" "$REWARD_IMPLEMENTATION" "$MARKET_IMPLEMENTATION" "$PURPOSE_IMPLEMENTATION" "$FACTORY_GOVERNANCE" "$REWARDS_GOVERNANCE"; do
  [[ "$(cast code "$ADDRESS" --rpc-url "$RPC_URL")" != "0x" ]] || fail "missing bytecode at $ADDRESS."
done

[[ "$(normalize "$MANAGER")" == "$(normalize "$CANONICAL_POOL_MANAGER")" ]] || fail "adapter is not using canonical PoolManager."
[[ "$(normalize "$BOUND_FACTORY")" == "$(normalize "$FACTORY_ADDRESS")" ]] || fail "adapter/factory binding mismatch."
[[ "$(normalize "$BOUND_ADAPTER")" == "$(normalize "$ADAPTER")" ]] || fail "hook/adapter binding mismatch."
[[ "$(normalize "$ROUTER")" == "$(normalize "$ROUTER_ADDRESS")" ]] || fail "protocol router mismatch."
[[ "$(normalize "$CONTROLLER")" == "$(normalize "$CONTROLLER_ADDRESS")" ]] || fail "rewards controller mismatch."
[[ "$(normalize "$CONTROLLER_FACTORY")" == "$(normalize "$FACTORY_ADDRESS")" ]] || fail "controller/factory binding mismatch."
[[ "$CONTROLLER_DELAY" == "$EXPECTED_REWARD_DELAY" ]] || fail "reward release delay mismatch."
[[ "$FEE" == "$EXPECTED_MARKET_FEE_BPS" ]] || fail "market fee mismatch: $FEE."
[[ "$VIRTUAL_ETH" == "$EXPECTED_VIRTUAL_ETH" ]] || fail "virtual ETH reserve mismatch: $VIRTUAL_ETH."
[[ "$VIRTUAL_TOKEN" == "$EXPECTED_VIRTUAL_TOKEN" ]] || fail "virtual token reserve mismatch: $VIRTUAL_TOKEN."
[[ "$TARGET" == "$EXPECTED_GRADUATION_TARGET" ]] || fail "graduation target mismatch: $TARGET."

[[ "$(normalize "$REGISTRY_FACTORY")" == "$(normalize "$FACTORY_ADDRESS")" ]] || fail "registry active factory mismatch."
[[ "$REGISTRY_VERSION" == "$EXPECTED_FACTORY_VERSION" ]] || fail "registry version mismatch."
[[ "$REGISTRY_DELAY" == "$EXPECTED_REGISTRY_DELAY" ]] || fail "registry activation delay mismatch."

FACTORY_GOVERNANCE_DELAY="$(cast call "$FACTORY_GOVERNANCE" 'executionDelay()(uint256)' --rpc-url "$RPC_URL" | awk '{print $1}')"
REWARDS_GOVERNANCE_DELAY="$(cast call "$REWARDS_GOVERNANCE" 'executionDelay()(uint256)' --rpc-url "$RPC_URL" | awk '{print $1}')"
[[ "$FACTORY_GOVERNANCE_DELAY" == "0" ]] || fail "factory governance delay mismatch."
[[ "$REWARDS_GOVERNANCE_DELAY" == "0" ]] || fail "rewards governance delay mismatch."

for GOVERNANCE in "$FACTORY_GOVERNANCE" "$REWARDS_GOVERNANCE"; do
  for ((i = 0; i < 3; i++)); do
    ACTUAL_SIGNER="$(cast call "$GOVERNANCE" 'signers(uint256)(address)' "$i" --rpc-url "$RPC_URL")"
    [[ "$(normalize "$ACTUAL_SIGNER")" == "$(normalize "${EXPECTED_SIGNERS[$i]}")" ]] ||
      fail "governance signer $i mismatch."
  done
done

EXPECTED_ROUTER_BPS=(4000 2000 2000 1000 1000)
PROTOCOL_GOVERNANCE=""
declare -a PURPOSE_VAULTS
for ((i = 0; i < 5; i++)); do
  VAULT="$(cast call "$ROUTER_ADDRESS" 'recipients(uint256)(address)' "$i" --rpc-url "$RPC_URL")"
  PURPOSE_VAULTS[$i]="$VAULT"
  [[ "$(cast code "$VAULT" --rpc-url "$RPC_URL")" != "0x" ]] || fail "purpose vault $i has no bytecode."

  VAULT_GOVERNANCE="$(cast call "$VAULT" 'governance()(address)' --rpc-url "$RPC_URL")"
  VAULT_PURPOSE="$(cast call "$VAULT" 'purpose()(bytes32)' --rpc-url "$RPC_URL")"
  [[ "$VAULT_PURPOSE" == "${EXPECTED_PURPOSES[$i]}" ]] || fail "purpose vault $i label mismatch."

  if [[ -z "$PROTOCOL_GOVERNANCE" ]]; then
    PROTOCOL_GOVERNANCE="$VAULT_GOVERNANCE"
  else
    [[ "$(normalize "$VAULT_GOVERNANCE")" == "$(normalize "$PROTOCOL_GOVERNANCE")" ]] ||
      fail "purpose vault governance mismatch."
  fi

  for ((j = 0; j < i; j++)); do
    [[ "$(normalize "$VAULT")" != "$(normalize "${PURPOSE_VAULTS[$j]}")" ]] ||
      fail "purpose vaults must be distinct."
  done
done

[[ "$(cast code "$PROTOCOL_GOVERNANCE" --rpc-url "$RPC_URL")" != "0x" ]] || fail "protocol governance has no bytecode."
PROTOCOL_DELAY="$(cast call "$PROTOCOL_GOVERNANCE" 'executionDelay()(uint256)' --rpc-url "$RPC_URL" | awk '{print $1}')"
[[ "$PROTOCOL_DELAY" == "$EXPECTED_PROTOCOL_GOVERNANCE_DELAY" ]] || fail "protocol governance delay mismatch."
for ((i = 0; i < 3; i++)); do
  ACTUAL_SIGNER="$(cast call "$PROTOCOL_GOVERNANCE" 'signers(uint256)(address)' "$i" --rpc-url "$RPC_URL")"
  [[ "$(normalize "$ACTUAL_SIGNER")" == "$(normalize "${EXPECTED_SIGNERS[$i]}")" ]] ||
    fail "protocol governance signer $i mismatch."
done

ROUTER_BPS=(
  "$(cast call "$ROUTER_ADDRESS" 'TREASURY_BPS()(uint16)' --rpc-url "$RPC_URL" | awk '{print $1}')"
  "$(cast call "$ROUTER_ADDRESS" 'BUYBACK_RESERVE_BPS()(uint16)' --rpc-url "$RPC_URL" | awk '{print $1}')"
  "$(cast call "$ROUTER_ADDRESS" 'GRADUATION_ASSISTANCE_BPS()(uint16)' --rpc-url "$RPC_URL" | awk '{print $1}')"
  "$(cast call "$ROUTER_ADDRESS" 'REFERRAL_RESERVE_BPS()(uint16)' --rpc-url "$RPC_URL" | awk '{print $1}')"
  "$(cast call "$ROUTER_ADDRESS" 'ECOSYSTEM_GROWTH_BPS()(uint16)' --rpc-url "$RPC_URL" | awk '{print $1}')"
)
for ((i = 0; i < 5; i++)); do
  [[ "${ROUTER_BPS[$i]}" == "${EXPECTED_ROUTER_BPS[$i]}" ]] || fail "router split $i mismatch."
done

[[ "$FAIR_DELAY" == "3" ]] || fail "Fair Start delay mismatch."
[[ "$FAIR_DURATION" == "25" ]] || fail "Fair Start duration mismatch."
[[ "$FAIR_TX_CAP" == "50" ]] || fail "Fair Start transaction cap mismatch."
[[ "$FAIR_WALLET_CAP" == "150" ]] || fail "Fair Start wallet cap mismatch."

for ADDRESS in "$FACTORY_ADDRESS" "$ROUTER_ADDRESS" "$CONTROLLER_ADDRESS" "$FACTORY_GOVERNANCE" "$REWARDS_GOVERNANCE" "$PROTOCOL_GOVERNANCE"; do
  if cast call "$ADDRESS" 'owner()(address)' --rpc-url "$RPC_URL" >/dev/null 2>&1; then
    fail "contract unexpectedly exposes an owner: $ADDRESS."
  fi
  if cast call "$ADDRESS" 'upgradeTo(address)' "$ADDRESS" --rpc-url "$RPC_URL" >/dev/null 2>&1; then
    fail "contract unexpectedly exposes an upgrade path: $ADDRESS."
  fi
done

echo "Robinhood Chain secured V4 mainnet stack verified."
echo "Factory: $FACTORY_ADDRESS"
echo "Protocol revenue router: $ROUTER_ADDRESS"
echo "Version registry: $REGISTRY_ADDRESS"
echo "Delayed rewards controller: $CONTROLLER_ADDRESS"
echo "Factory governance: $FACTORY_GOVERNANCE"
echo "Rewards governance: $REWARDS_GOVERNANCE"
echo "Protocol governance: $PROTOCOL_GOVERNANCE"
echo "Five distinct purpose vaults verified."
echo "Fair Start: 3-block delay, 25 protected blocks, 0.5% transaction cap, 1.5% wallet cap"
echo "Launch count: $COUNT"
