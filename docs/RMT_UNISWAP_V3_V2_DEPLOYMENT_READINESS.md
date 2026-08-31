# RMT Uniswap V3 V2 deployment readiness

Status: `PROPOSED_OWNER_AUTHORIZATION`, `NOT_DEPLOYED`, `NOT_ACTIVATED`.

The owner selected the exact V2 economics and proposed treasury documented below for deployment
review. This package is not authorization to deploy or activate V2. Deployment remains blocked
until the owner issues `DEPLOY RMT V3 FEE EXECUTOR V2`; activation requires a later, separate
decision. No Distribution, Spotlight, buyback, or NFT authority is implied.

This package prepares a deterministic, owner-authorized deployment of
`RMTUniswapV3FeeExecutorV2`. It fixes the proposed treasury, effective block, constructor,
CREATE2 salt, predicted address, runtime hash, and exact unsigned deployment transaction. It
does not hold a private key and does not enable wallet authorization.

## Final proposed package

The complete machine-readable package, including the exact 13,439-byte factory calldata, is
[`packages/contracts/deployments/rmt-uniswap-v3-fee-executor-v2.template.json`](../packages/contracts/deployments/rmt-uniswap-v3-fee-executor-v2.template.json).
It is derived from canonical main `9cd69b20cad70f5302ea4b900174b3610250eeb7`.

- Treasury: `0x61700479A4A1F62584Fd3ABA2c2b290EA727d2eC`
- Effective block: `52,031,325`; no `effectiveBeforeBlock`
- Policy hash: `0x817c811c7d6f5d4d7fd5740f6169114394415292e7a4c6043e15efbc23da003a`
- Constructor arguments hash: `0x10d3f6c445ac7e746a72f858f37a94512b27cf214e1d748aaec043f4fb382ce5`
- Creation-code hash: `0x4aad11354c2be1ac4632ddfa1968e40394fdd3127e51038e369c73d389d79a02`
- Init-code hash: `0x6d92231b7b5435809c57a91139b98624b729709ec67c60e029b8d471214fd3b3`
- Salt: `0xd9d5e78f113848ce84aedd7c54f0b44bcf232e679856f6156c82aa4ae02861bc`
- Predicted executor: `0x6D4CdBC3000Ae0C3d23C00BF70E48c9682f77CE2`
- Expected constructor-bound runtime hash:
  `0x974250439f6cce7c355c1b91547cbd9a6667a68f2486076edeaf54a168f0df4e`
- Deployment target: deterministic factory `0x4e59b44847b379578588920cA78FbF26c0B4956C`
- Deployment value: `0`
- Deployment calldata hash: `0xe2a27bc21ddd89cf122ad6b410acd1c7b9dade16ff49cc95549b404bfb2b6d97`
- Live estimate: 2,531,956 gas; bounded 120% gas limit 3,038,348; bounded estimate
  `921451951352000` wei (`0.000921451951352 ETH`) at the recorded gas-price snapshot

A no-broadcast Robinhood mainnet fork deployed the exact init code at the predicted address,
verified every immutable, and produced the expected runtime hash. The live predicted address
had no code at the recorded snapshot and did not collide with V1, the treasury, Router02, the
factory, WETH, or another known RMT production role.

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

The older rehearsal used candidate Safe `0x6170...d2eC` and test block `50,000,000`. Those
values remain historical **REHEARSAL_ONLY_NOT_OWNER_AUTHORIZED** evidence and are not the
proposed package:

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

## Proposed treasury architecture

The existing Safe at `0x61700479A4A1F62584Fd3ABA2c2b290EA727d2eC` is the sole proposed V2
treasury, not a deployment authorization. The executor needs only a stable recipient capable of receiving native ETH and
standard ERC-20s. The Safe can later execute or authorize separately reviewed calls/modules
that route collected assets to buyback, creator-reward, community-distribution, or Mint Engine
contracts. None of that downstream policy belongs in the immutable executor, and changing
downstream Safe-authorized routing does not require redeploying it.

Fresh read-only Robinhood mainnet verification on 2026-08-31 found:

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

`policyBeforeBlock = 0` is the proposed open-ended value. The final proposed
`policyFromBlock` is `52,031,325`, selected as exactly 1,000,000 blocks after canonical snapshot
block `51,031,325` (`0x0f062d...ee71`, 2026-08-31T17:09:43Z). At the previously measured
cadence this is approximately 27 hours 53 minutes, leaving a full operational day for owner
review, deployment, verification, and aborting before the policy boundary. The stale rehearsal
block `50,000,000` has no authority.

## Application wiring inventory

Contract readiness is not application activation readiness. On this exact source:

| Stage | Status | Evidence |
| --- | --- | --- |
| Quote | `CODE_CHANGE_REQUIRED` | The ordinary V3 quote path still chooses V1/direct settlement rather than V2 net economics. |
| Verify | `READY` | Exact V2 route, runtime, policy, pool, recipient, deadline, gas, calldata, and simulation verification exists. |
| Authorize | `CODE_CHANGE_REQUIRED` | The exact V2 authorization implementation exists, but the global `uniswap-v3` fee-settlement registry remains `QUOTE_ONLY`. |
| Wallet review | `READY` | The authorization-plan codec accepts explicit `VNEXT_V2_ATOMIC_INPUT_FEE` authority. |
| Prehash journal | `READY` | V2 calldata hashes and recovery plans are durably bound. |
| Receipt recovery | `READY` | Exact V2 settlement-event reconciliation and terminal recovery exist. |
| Confirmation UI | `READY` | Confirmed V2 actual fee and net output fields are supported. |

The quote and provider-admission changes are a separate activation/wiring tranche. This
deployment-package PR does not silently switch production routing or the provider registry.

## Controlled proof after deployment and before public activation

Use only the preserved admin/deployer wallet and small owner-approved amounts. Public wallet
authorization remains off.

1. Confirm deployed code, all immutable getters, WETH EIP-1967 link, policy hash, treasury,
   boundary, and deterministic transaction receipt against the finalized artifact.
2. At canary time choose the highest-liquidity verified ERC-20 for which ordinary net route
   ranking independently selects V3 V2; do not privilege a project token. Native ETH to that
   token: quote on `providerInput = gross - floor(gross * 25 / 10_000)`, bind a protected
   output and short ArbSys deadline, send the wallet transaction to the V2 executor, and
   confirm exact native treasury delta, token output, consumed execution ID, zero executor
   ETH/token/WETH residue, and internal Router02-only routing.
3. The same token to native ETH: approve the executor for exactly gross input, confirm the allowance is
   exactly consumed to zero, execute to the V2 executor, and confirm exact input-token treasury delta,
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
