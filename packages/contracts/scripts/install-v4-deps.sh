#!/usr/bin/env bash
set -euo pipefail

CORE_REV="59d3ecf53afa9264a16bba0e38f4c5d2231f80bc"
PERIPHERY_REV="ad04c9f24a170accf5ea1b2836bbafd514537ca6"

if [[ ! -f lib/v4-core/src/PoolManager.sol ]]; then
  forge install "v4-core=Uniswap/v4-core@rev=${CORE_REV}" --no-git
fi

if [[ ! -f lib/v4-periphery/src/utils/BaseHook.sol ]]; then
  forge install "v4-periphery=Uniswap/v4-periphery@rev=${PERIPHERY_REV}" --no-git
fi
