#!/usr/bin/env bash
set -euo pipefail

CORE_REV="59d3ecf53afa9264a16bba0e38f4c5d2231f80bc"
PERIPHERY_REV="ad04c9f24a170accf5ea1b2836bbafd514537ca6"

install_pinned() {
  local name="$1"
  local repository="$2"
  local revision="$3"
  local sentinel="$4"
  local marker="lib/${name}/.rmt-source-revision"

  if [[ -f "${sentinel}" ]]; then
    if [[ -f "${marker}" && "$(<"${marker}")" == "${revision}" ]]; then
      return
    fi
    echo "lib/${name} exists without the expected RMT revision marker; move it aside and rerun" >&2
    exit 1
  fi

  forge install "${name}=${repository}@${revision}" --no-git
  printf '%s\n' "${revision}" > "${marker}"
}

install_pinned "v4-core" "Uniswap/v4-core" "${CORE_REV}" "lib/v4-core/src/PoolManager.sol"
install_pinned "v4-periphery" "Uniswap/v4-periphery" "${PERIPHERY_REV}" "lib/v4-periphery/src/utils/BaseHook.sol"
