# RMT Uniswap V3 V2 deployment readiness

Status: `NOT_DEPLOYED`, `NOT_ACTIVATED`, `OWNER_AUTHORIZATION_REQUIRED`.

This package prepares a deterministic, owner-authorized deployment of
`RMTUniswapV3FeeExecutorV2`. It does not select a production treasury or effective block,
does not hold a private key, and does not enable wallet authorization.

## Reproducible build

Two clean offline builds from frozen executor head `146651dbed51ada2832a025bf2079cd6e65748df`
produced identical artifacts with Foundry 1.7.1 and solc 0.8.26. Configuration: optimizer
enabled, 200 runs, via-IR enabled, Cancun EVM.

- Creation bytecode: 12,927 bytes; hash
  `0x4aad11354c2be1ac4632ddfa1968e40394fdd3127e51038e369c73d389d79a02`
- Runtime template: 10,968 bytes; hash
  `0x82d18e9315e6328e703658849f5f8a1a286d5c4ac08e74d363aebd34a7ef4b31`

The deployed runtime hash also binds constructor immutables and must be recomputed for the
owner-authorized treasury and effective block.

## Frozen identities

- Chain: Robinhood Chain `4663`
- Preserved admin/deployer: `0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA`
- Router02: `0xCaf681a66D020601342297493863E78C959E5cb2`
- Factory: `0x1f7d7550B1b028f7571E69A784071F0205FD2EfA`
- Canonical WETH proxy: `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73`
- Expected WETH implementation: `0xC6B81b429797E0f555440b70cD99e032D7AE947e`
- Deterministic factory: `0x4e59b44847b379578588920cA78FbF26c0B4956C`

The server must still verify the current WETH EIP-1967 implementation slot before signing.
The executor pins the proxy and expected implementation runtime identities; Solidity cannot
read another account's storage slot onchain.

## Deterministic plan

The salt is V2-domain-separated, chain-bound, policy-bound, and bytecode-bound:

```text
keccak256(abi.encode(
  keccak256("RMT_UNISWAP_V3_FEE_EXECUTOR_V2_CREATE2"),
  4663,
  policyHash,
  treasury,
  policyFromBlock,
  policyBeforeBlock,
  keccak256(creationCode)
))
```

The expected address is standard CREATE2 using the historical deterministic factory, that
salt, and the complete constructor-bearing init-code hash. V1 salt material is never reused.

The deterministic rehearsal uses candidate Safe `0x6170...d2eC` and future test block
`50,000,000` only. These values are **REHEARSAL_ONLY_NOT_OWNER_AUTHORIZED**:

- Policy hash: `0xf5d958e3438913decc845c20c71385484f9e727ce8010e1b63e226cc149a547a`
- Constructor arguments hash: `0x4d9430040afdacc5dc584a1db1350080e8c611ed9ed8906f22b1e1415611ff64`
- Init-code hash: `0x02b083117a33cb8b1f1f5aa028052ec520d513ba25d6c3137bf1466317f3b507`
- Salt: `0x5a43df7a90b9c11cecded696dd0f7c881f619ba44c636ee9deb3cc22d238efd5`
- Predicted executor: `0x11F72aCEcc703394241b24c5C532C33788daAc86`
- Simulated deployed runtime hash:
  `0x25fc42a8e918ce2fd42034ba8ac3b3005eecd32130eda340c6674dbd441208bd`

Tests prove that changing either treasury or effective block changes the policy hash,
constructor arguments, init code, salt, and predicted address.

`RehearseRMTUniswapV3FeeExecutorV2.s.sol` performs a no-broadcast deployment only inside a
local fork. `DeployRMTUniswapV3FeeExecutorV2.s.sol` reads no private key; a future authorized
broadcast must use the preserved deployer through an external Foundry signer. It requires
every dependency, policy, hash, salt, and expected address as explicit matching inputs.

## Candidate treasury architecture

The existing Safe at `0x61700479A4A1F62584Fd3ABA2c2b290EA727d2eC` is a candidate, not an
authorization. The executor needs only a stable recipient capable of receiving native ETH and
standard ERC-20s. The Safe can later execute or authorize separately reviewed calls/modules
that route collected assets to buyback, creator-reward, community-distribution, or Mint Engine
contracts. None of that downstream policy belongs in the immutable executor, and changing
downstream Safe-authorized routing does not require redeploying it.

Fresh read-only Robinhood mainnet verification on 2026-08-23 found:

- Safe proxy runtime hash:
  `0x4e381985ca68b3e5d27b4425fa581c19cf33146d3f887a3cfca96f55528ea46f`
- Singleton `0xEdd160fEBBD92E350D4D398fb636302fccd67C7e`, version 1.5.0, runtime hash
  `0x180193227186ccb85316c94db1f0d156ed932b14712cfaac78901899178572dc`
- Owner set: only preserved admin/deployer `0x7E8E...76cA`; threshold 1; nonce 0
- Fallback handler `0x3EfCBb83A4A7AfCb4F68D501e2C2203A38Be77f4`, runtime hash
  `0x3c6a85bcf7b563daa624b884b4e9a1b9fa5371edde7be945d998071a48f28bbc`
- No enabled modules at the snapshot; owner-authorized Safe transactions can add separately
  reviewed downstream routing later
- A value-bearing read-only call to the Safe receive path succeeded; the Safe also held a
  standard USDG balance, demonstrating ordinary ERC-20 custody

## Effective boundary

`policyBeforeBlock = 0` is the recommended open-ended production value. The owner must select
a future Robinhood L2 `policyFromBlock`. A lead of `1,000,000` L2 blocks is recommended; the
live preflight must convert that into current wall-clock time immediately before authorization.
At the observed 2026-08-23 cadence of about 0.1004 seconds per block, this is approximately
27 hours 53 minutes. That leaves a full operational day for confirmation, immutable verification,
artifact finalization, controlled proof preparation, and aborting before activation.

## Controlled proof after deployment and before public activation

Use only the preserved admin/deployer wallet and small owner-approved amounts. Public wallet
authorization remains off.

1. Confirm deployed code, all immutable getters, WETH EIP-1967 link, policy hash, treasury,
   boundary, and deterministic transaction receipt against the finalized artifact.
2. Native ETH to USDG: quote on `providerInput = gross - floor(gross * 25 / 10_000)`, bind a
   protected output and short ArbSys deadline, send the wallet transaction to the V2 executor,
   and confirm exact native treasury delta, USDG output, consumed execution ID, zero executor
   ETH/token/WETH residue, and internal Router02-only routing.
3. USDG to native ETH: approve the executor for exactly gross input, confirm the allowance is
   exactly consumed to zero, execute to the V2 executor, and confirm exact USDG treasury delta,
   protected native output, exact WETH unwrap, consumed execution ID, zero executor residue,
   and zero Router02 allowance.
4. Re-submit each consumed execution ID as a read-only simulation and require replay rejection.
5. Require finalized confirmations and record receipt, block, gas, fee, balances, runtime hashes,
   and negative proofs in the deployment artifact. This proof does not enable public trading.

## Activation tranche (plan only)

The later activation PR should be minimal:

1. Admit only `uniswap-v3` as `V2_ATOMIC_INPUT_FEE` in
   `VNEXT_PROVIDER_FEE_SETTLEMENT_REGISTRY`.
2. Enable adapter wallet authorization only when the exact active V2 policy, verified executor
   runtime/immutables, WETH EIP-1967 link, and deployment artifact all match.
3. Keep all missing or mismatched configuration quote-only and preserve rejection of Router02
   as a wallet target.
4. Keep UP, Sushi, 0x, and UniswapX quote-only.
5. Keep the final wallet-submission release gate separately disabled until the explicit owner
   public-activation operation.

## Recommended merge and release choreography

1. Owner authorizes the candidate treasury, future effective block, exact rehearsal hashes,
   and deployment only after this readiness review.
2. Deploy through the deterministic factory from the preserved admin wallet; verify runtime,
   immutables, receipt, and source. Do not activate.
3. Run and finalize the two controlled proofs above while every production adapter remains
   quote-only.
4. Commit the completed deployment artifact in a narrow stacked artifact PR.
5. Build/review the activation tranche on top of the exact foundation + executor + readiness +
   artifact stack, with its final submission gate still off.
6. Incorporate #429, readiness, artifact, and activation into the #428 integration branch after
   each component review; compare the resulting tree to the reviewed stack.
7. Run protected CI on that exact combined head, then merge the complete #428 release stack to
   main once. This avoids a meaningful main interval where the fee foundation disables legacy
   execution but V2 integration is absent.
8. Let the unchanged protected main deploy with wallet submission still off. Verify health,
   quote visibility, configuration fail-closed behavior, and no Router02 wallet target.
9. Bind only the owner-authorized V2 policy/executor environment metadata and redeploy the same
   main SHA. Re-verify exact runtime/immutables and keep public submission off.
10. After the effective block and a separate owner activation, enable the final submission gate,
    redeploy the same SHA, and immediately smoke-test one controlled route.
11. On any mismatch, disable the final submission/provider gate and redeploy the same SHA. All
    providers return to quote-only; there is no fee-free fallback and the deployed ownerless
    executor retains no privileged control surface.

No deployment, treasury authorization, effective-block selection, environment mutation, or
wallet activation is performed by this package.
