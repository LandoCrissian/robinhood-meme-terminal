# RMT Uniswap V3 V2 deployment readiness

Status: `DEPLOYED`, `DEPLOYED_NOT_ACTIVATED`, `APPLICATION_SOURCE_ADMITTED`.

The owner authorized and confirmed the exact deterministic V2 deployment documented below.
Deployment is complete at `0xef729FbC9aDfC431ae46ECc198144160e2dD7832`. Activation remains
unauthorized, the public fee remains off, and source admission does not change Production.
No Distribution, Spotlight, buyback, or NFT authority is implied.

This package preserves the complete deterministic proposal and the independently verified
post-deployment evidence for `RMTUniswapV3FeeExecutorV2`. It fixes the treasury, effective
block, constructor, CREATE2 salt, deployed address, runtime hash, exact unsigned deployment
transaction, and canonical receipt. It does not hold a private key and does not enable wallet
authorization.

## Current release boundary

- Deployment: **COMPLETE**
- Executor: `0xef729FbC9aDfC431ae46ECc198144160e2dD7832`
- Activation: **NOT AUTHORIZED**
- Public fee: **OFF**
- Application source admission: **COMPLETE; PRODUCTION GATE OFF**
- Quote wiring: **READY IN SOURCE; PRODUCTION GATE OFF**
- Authorize/provider registry wiring: **READY IN SOURCE; PRODUCTION GATE OFF**

## Deployed package and preserved proposal

The complete machine-readable package, including the exact 13,439-byte factory calldata, is
[`packages/contracts/deployments/rmt-uniswap-v3-fee-executor-v2.template.json`](../packages/contracts/deployments/rmt-uniswap-v3-fee-executor-v2.template.json).
It is derived from canonical main `9cd69b20cad70f5302ea4b900174b3610250eeb7`.

- Treasury: `0x61700479A4A1F62584Fd3ABA2c2b290EA727d2eC`
- Effective block: `51,296,658`; no `effectiveBeforeBlock`
- Policy hash: `0x91c988a28bd8b308e57bfbd3a991571b663f1c5d8430f96dfa1db2e5cfb93484`
- Constructor arguments hash: `0x6198dd3a8fd00ad064846dc2c4418755a16871a694975811b0e98ab154dbff50`
- Creation-code hash: `0x4aad11354c2be1ac4632ddfa1968e40394fdd3127e51038e369c73d389d79a02`
- Init-code hash: `0xbaf7664de34dd6c2713a7eb0df80bcd39564fa9c55e6669ac111fe1a9e7c646f`
- Salt: `0x8042491cf951a01116a97dc3ec93870a88f8f92a9f28cc20db0bbf2c304aeb69`
- Predicted executor: `0xef729FbC9aDfC431ae46ECc198144160e2dD7832`
- Expected constructor-bound runtime hash:
  `0xed8ec8cd44f2c228044678358bb7c4565953067ceab42319b169358354b9693d`
- Deployment target: deterministic factory `0x4e59b44847b379578588920cA78FbF26c0B4956C`
- Deployment value: `0`
- Deployment calldata hash: `0x11b8155284275c8edabdc24ee0f404b0cb8178f25912a21f75cac2f6393afd43`
- Live estimate: 2,532,242 gas; bounded 120% gas limit 3,038,691; bounded estimate
  `958311980670000` wei (`0.00095831198067 ETH`) at the recorded gas-price snapshot

A no-broadcast Robinhood mainnet fork first deployed the exact init code at the predicted
address, verified every immutable, and produced the expected runtime hash. The live predicted
address had no code at that proposal snapshot and did not collide with V1, the treasury,
Router02, the factory, WETH, or another known RMT production role.

## Canonical deployment receipt

Independent Robinhood Chain `4663` verification established:

- Transaction: `0xc25e1d4265c47fa08fd81c5296fab1ec1e73e732a7fd989b3313f45c8764356d`
- Status: `success`
- Block: `51,119,538`
- Block hash: `0xed8d05d267fc7315636e34200d672ed22678c7aa9d6c03413091e6f6d35465ed`
- Timestamp: `2026-08-31T19:38:27Z`
- Transaction index: `3`
- Deployer nonce: `202`
- Sender: `0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA`
- Factory target: `0x4e59b44847b379578588920cA78FbF26c0B4956C`
- Value: `0`
- Gas used: `2,490,107`
- Effective gas price: `328,550,000` wei
- Total cost: `818,124,654,850,000` wei (`0.00081812465485 ETH`)
- Calldata hash: `0x11b8155284275c8edabdc24ee0f404b0cb8178f25912a21f75cac2f6393afd43`
- Deployed runtime: 10,968 bytes
- Deployed runtime hash: `0xed8ec8cd44f2c228044678358bb7c4565953067ceab42319b169358354b9693d`

The transaction calldata exactly matches the preserved unsigned package. CREATE2 recomputes
the deployed executor exactly. Every immutable getter and dependency runtime matches the
package, the canonical WETH implementation slot still resolves to the pinned implementation,
and V1 remains unchanged at its distinct address and runtime. CREATE2 permits only one
successful creation at this exact salt and init code. The deployment is the owner's nonce 202
transaction, while current latest and pending nonces are both 203; no later owner broadcast or
duplicate successful deployment exists.
The receipt contains no unexplained value transfer.

At verification snapshot block `51,130,537`
(`0xb192273885d02ff576a5979ebc50b94c0625bb739e0f75221e104b35e2d473bf`,
2026-08-31T19:56:59Z), `166,121` blocks remained before the immutable policy boundary.
Crossing that boundary never authorizes application admission, wallet submission, or public
fee collection.

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

## Deployed treasury binding

The existing Safe at `0x61700479A4A1F62584Fd3ABA2c2b290EA727d2eC` is the sole immutable V2
treasury. The owner's deployment authorization applied to this exact constructor binding only;
it did not authorize activation. The executor needs only a stable recipient capable of receiving native ETH and
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

`policyBeforeBlock = 0` is the immutable open-ended value. The accelerated
`policyFromBlock` is `51,296,658`, selected as exactly 225,000 blocks after fresh canonical
snapshot block `51,071,658` (`0x76c535...ecd1e`, 2026-08-31T18:17:47Z). The preceding
100,000-block sample began at block `50,971,658` (`0x10c621...b26c5`,
2026-08-31T15:28:53Z), yielding an observed cadence of 0.10134 seconds per block. At that
cadence, the boundary is approximately 6 hours 20 minutes after the snapshot, around
2026-09-01T00:37:49Z. This is inside the owner-approved 100,000-250,000-block and roughly
3-7-hour bounds while retaining time for owner review, deployment, immutable verification,
and aborting before activation. The prior 1,000,000-block proposal and stale rehearsal block
`50,000,000` have no authority.

## Application wiring inventory

Contract readiness is not application activation readiness. On this exact source:

| Stage | Status | Evidence |
| --- | --- | --- |
| Quote | `READY` | The ordinary V3 adapter quotes provider input after the exact floored 25-bps input fee and exposes explicit V2 economics. |
| Verify | `READY` | Exact V2 route, runtime, policy, pool, recipient, deadline, gas, calldata, and simulation verification exists. |
| Authorize | `READY` | The registry is source-admitted as version-explicit V2, with exact executor/policy verification and a separate server-only gate that defaults false. |
| Wallet review | `READY` | The authorization-plan codec accepts explicit `VNEXT_V2_ATOMIC_INPUT_FEE` authority. |
| Prehash journal | `READY` | V2 calldata hashes and recovery plans are durably bound. |
| Receipt recovery | `READY` | Exact V2 settlement-event reconciliation and terminal recovery exist. |
| Confirmation UI | `READY` | Confirmed V2 actual fee and net output fields are supported. |

Source admission does not activate Production. `RMT_VNEXT_UNISWAP_V3_V2_AUTHORIZATION_ENABLED`
defaults false and is required in addition to the exact policy and executor gates. The controlled
canary release scope is `PROOF_WALLET_ONLY`: the separate server-only
`RMT_VNEXT_UNISWAP_V3_V2_PROOF_WALLET` must contain the exact authenticated recipient before the
V2 lane can be selected. It never inherits the historical V1
`RMT_VNEXT_UNISWAP_V3_FEE_PROOF_WALLET`. Non-proof recipients retain their pre-V2 provider and
settlement behavior; once the proof wallet enters the V2 lane, missing or mismatched V2 authority
fails closed and never downgrades to V1 or fee-free V3 execution.

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

## Remaining release choreography

1. Merge this narrow post-deployment evidence only after owner review.
2. Add and review the separate quote and `uniswap-v3` provider-admission wiring while every
   production execution and fee gate remains disabled.
3. Reverify the deployed runtime, immutables, policy boundary, WETH implementation link, and
   exact application configuration before each controlled proof.
4. Run the separately owner-authorized bidirectional controlled proofs and finalize their
   receipt, fee, treasury, residual, allowance, replay, recovery, and UI evidence.
5. Request a separate owner decision before any production application admission or public
   activation.

This evidence finalization changes no contract, application logic, treasury, fee rate, route
ranking, production environment, deployment, or wallet state.
