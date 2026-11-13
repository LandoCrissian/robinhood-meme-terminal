#!/usr/bin/env bash
set -euo pipefail

run_curve_review_fork() {
  local backing="$1"
  local suffix="-$backing"
  if [[ "$backing" == 1000000000000000000 ]]; then suffix=""; fi
  local report="$RUNNER_TEMP/curve-fork-evidence$suffix.json"
  local diagnostics="$RUNNER_TEMP/curve-fork-diagnostics$suffix.log"
  local validator=(
    node packages/contracts/scripts/validate-curve-graduation-4663.mjs
    --anvil "$(command -v anvil)" --solc "$RUNNER_TEMP/solc-0.8.26"
    --backing-wei "$backing"
  )

  if "${validator[@]}" --archive pocket > "$report" 2> "$diagnostics"; then
    return 0
  fi
  cat "$diagnostics" >&2
  # Retry only an explicitly unavailable historical read. Preserve assertion and settlement failures.
  if ! grep -Eq 'Error: eth_(getCode|call|getStorageAt|getAccountInfo).*historical state .* is not available' "$diagnostics"; then
    return 1
  fi
  mv "$diagnostics" "$RUNNER_TEMP/curve-fork-diagnostics$suffix-pocket.log"
  echo "Pocket archive state unavailable at the pinned block. Repeating every check with dRPC." >&2
  if "${validator[@]}" --archive drpc > "$report" 2> "$diagnostics"; then
    return 0
  fi
  cat "$diagnostics" >&2
  return 1
}

run_curve_review_fork "$1"
