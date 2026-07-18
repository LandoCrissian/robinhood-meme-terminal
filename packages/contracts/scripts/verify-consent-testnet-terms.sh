#!/usr/bin/env bash
set -euo pipefail

EXPECTED_HASH="0x236ed1f849548c61a923152a92dc91593f22a6e2ff3d176a4b0db38b3b2d2b57"
TERMS_FILE="${1:-../../docs/CONSENT_MIGRATION_TESTNET_TERMS_V1.md}"

if [[ ! -f "$TERMS_FILE" ]]; then
  echo "Consent-migration testnet terms were not found: $TERMS_FILE" >&2
  exit 1
fi

if ! command -v cast >/dev/null 2>&1; then
  echo "Foundry cast is required to verify the consent-migration terms hash." >&2
  exit 1
fi

if ! command -v xxd >/dev/null 2>&1; then
  echo "xxd is required to encode the exact terms bytes." >&2
  exit 1
fi

ACTUAL_HASH="$(cast keccak "0x$(xxd -p "$TERMS_FILE" | tr -d '\n')")"
if [[ "$ACTUAL_HASH" != "$EXPECTED_HASH" ]]; then
  echo "Consent-migration terms hash mismatch." >&2
  echo "Expected: $EXPECTED_HASH" >&2
  echo "Actual:   $ACTUAL_HASH" >&2
  exit 1
fi

echo "Consent-migration testnet terms hash verified: $ACTUAL_HASH"
