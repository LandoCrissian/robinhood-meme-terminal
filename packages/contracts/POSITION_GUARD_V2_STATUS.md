# Position Guard V2 candidate status

`RMTPositionGuardExecutor` in this branch is a review candidate only.

The candidate binds automatic exits to a wallet-registered Uniswap V3 order, derives trigger eligibility and minimum output from pool TWAP observations, fixes proceeds to WETH in the same wallet, and requires explicit onchain cancellation plus wallet-authority cleanup.

It must remain undeployed and release-locked until the contract suite, generated deployment artifacts, static analysis, mainnet-fork rehearsal, independent review, restricted Privy policy review, bounded canary, and revocation rehearsal are complete.
