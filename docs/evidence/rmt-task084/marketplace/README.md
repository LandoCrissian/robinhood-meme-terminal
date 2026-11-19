# Task084 signed-order and payment qualification

**BLOCKED_NO_BROADCAST.** No current public listing was admitted. No owner signed order was supplied. No production currency or purchase is authorized.

The exact base is `663c057746e795f8cde60a4eca8d51d4d685b768`, under [owner direction](https://github.com/LandoCrissian/robinhood-meme-terminal/pull/677#issuecomment-7019806025). All previous deployed source, Task082/083 archives, source qualifications and security gates remain intact.

## Actual read-only observations

The [original qualification output](qualification-observation.json) preserves the actual bounded OpenSea response and twelve raw downstream authority RPC responses, with hashes in [manifest.json](manifest.json). Public GETs at 20:29:47 and 20:32:06 UTC on 2026-11-19 returned **HTTP401**, a 70-byte missing-key response. The later response is retained exactly inside the qualification output. No credential was provisioned or purchased, no redirect/private backend was followed, and no scraping workaround was attempted. This establishes unavailable access for the tested documented endpoint, not absence of live listings everywhere. A collection page, bid or fulfilled receipt is not a current signed listing.

Official and Pocket RPCs corroborated WETH block **118499505**, hash `0x5160602b2f53879b4a5bcac819cbdacd068ad72a722d415fad53c577659f68b1`. Proxy, implementation and ProxyAdmin hashes match the independently reproduced Task083 source records. This refresh did not rerun compilers. The proxy's full original runtime reproduces; implementation/admin executable correspondence retains their original metadata/input gaps. Source correspondence does not clear security observations or future upgrades.

ProxyAdmin remains `0xa3acd31afb851b4eb9dad00f5204c01d924267df`, owning aeWETH proxy `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` with implementation `0xc6b81b429797e0f555440b70cd99e032d7ae947e`. ProxyAdmin owner `0x2A153c6A1B66DBc930a8d7017230ab0253005C09` is itself an exact source-proven TransparentUpgradeableProxy runtime, not an established EOA or quorum. One bounded additional hop found implementation `0x3c3e52bc8c181d06a76e2518bbc655c5bb3ce7cd` (runtime hash `0x0d88feac198ef1b50b99fddf06aa9f6b1050bfe7211d6f04173de9b6d8953bcb`) and the same ProxyAdmin. The delegated owner getter reverted on both providers. Both final canonical anchor checks passed. Downstream roles, signer membership/threshold and immutable upgrade notice remain unestablished. No EOA, Safe or timelock control is inferred from a name, proxy or getter.

## Strict owner-supplied pathway

The new [typed declaration](../../../../scripts/seaport-acquisition/owner-supplied-order.d.mts) and [JSON schema](../../../../scripts/seaport-acquisition/owner-supplied-order.schema.json) describe this envelope:

- schemaVersion 1, kind OWNER_SUPPLIED, side LISTING.
- provenance contains canonical ISO obtainedAt and a plain reference label; it asserts origin without authenticating a public feed.
- order contains only exact chainId, Seaport address, decimal counter, canonical seller signature and typed order parameters.

`parseOwnerSuppliedOrder(rawUtf8, options)` rejects invalid UTF8, more than 32KiB, duplicate object keys, excess depth/nodes, extra fields, URLs/calldata/pins, stale/future provenance and unsupported order shapes. The supported subset remains one ERC721/ERC1155 offer, FULL_OPEN, static full amounts, zero zone/hash/conduit, no criteria/tips/dynamic amounts/partial fractions, seller consideration first and unique payees. It never signs or sends.

`ingestOwnerSuppliedSignedOrder(rawUtf8, {profile, nowMs, verifierOptions, paymentProfile})` and `verifyCurrentOwnerSuppliedOrder(envelope, options)` separately bind trusted application source/runtime pins and exact reviewed consideration/reserve limits. They corroborate chain, fresh block/time, Seaport domain/controller/hash/counter/unfilled status, canonical EOA signature, NFT interface/owner/balance/approval, exact fees/ERC2981 royalty and funded reserve at the same block; they recheck the canonical anchor after the reads. Reads are bounded to 128 actual provider operations and 15 seconds. A failure, reorg, disagreement, contract/delegated seller or unknown source/proxy remains UNAVAILABLE.

Default profile `robinhood-4663-read-only-v1` fixes chain4663 and the canonical Seaport address. Only explicit `seaport-local-31337-v1` admits synthetic local data, labeled SYNTHETIC_LOCAL_CORROBORATION_ONLY. Two local endpoints are corroboration of a fixture, not independent public market evidence. No arbitrary chain override exists.

A successful OWNER_SUPPLIED_CURRENT_ORDER_VERIFIED result includes the original typed order/orderHash, observed chain/block/hash/time and payment/NFT/approval evidence. It always has publicListingVerified=false, executionApproved=false, executionEnabled=false and productionStatus=NO_GO. Current seller-signed state can be proved without asserting that a marketplace publicly listed it. Contract/Safe seller ingestion is explicitly unsupported here; the existing separately reviewed genuine Safe fixture path is unchanged. Every watcher cycle and immediately preceding unsigned preparation must call the verifier again; a prior successful label is not current evidence. Root's watcher separately enforces OFF, caps, epochs, runtime/policy and deduplication.

## Asset policy

Native ETH needs no token approval. The vault must spend only its separately accounted prefunding and forward exactly the complete signed consideration, while the caller's purchase value remains zero. Exact per-transaction call-tree/payment and recipient delta checks, NFT custody and vault accounting remain necessary. An unrelated same-block payment cannot satisfy the purchase fee. Native read-only admissibility is not production release.

All production ERC20s, including aeWETH, remain blocked regardless of ticker, interface, observed balances or pinned proxy bytecode. Unknown upgrade/admin/quorum/bridge burn powers, fee-on-transfer, rebasing and changing payment behavior are unadmitted. Only the explicit immutable-synthetic-local payment profile with trusted source/runtime pins is available on chain31337. Its allowance must be zero before, exactly scoped to pinned Seaport for the all-in amount during fulfillment, and zero afterward; every recipient credit and custody change must match or revert atomically. This local profile provides no production aeWETH approval.

## Validation, integrity and limits

Sixteen focused checks passed in actual in-memory Node execution: strict parsing, supported profiles, domain/counter/status/signature/ownership/approval/reserve failures, disagreement/reorg, exact consideration, production ERC20 exclusion, no credential fallback, actual artifact integrity, bounded proxy control-map replay and unknown-code/changed-anchor rejection. No local checkout, build, package install or file write was used because C: had no free space. Root integration CI and genuine connected/fork suites remain separate requirements.

Run after checkout:

```sh
node --test scripts/seaport-acquisition/owner-supplied-order.test.mjs \
  scripts/seaport-acquisition/payment-policy.test.mjs \
  scripts/seaport-acquisition/marketplace-current-qualification.test.mjs
```

Gitleaks 8.30.1 scanned the exact original observation plus all thirteen decoded original transport bodies as plaintext in memory before archive; the initial combined source/observation scan also passed: **zero findings, zero unclassified**, using the unchanged repository configuration. The exact redacted scanner stdout is [retained](raw-gitleaks-report.json). The manifest binds raw/input/source hashes and distinguishes the actual observation producer snapshot from a later failure-handling refinement. No scanner rules, ignores or history changed. Original raw JSON and public RPC error responses remain intact.

The bounded observation does not establish an available live feed, current NFT price, L1 finality, audit clearance, acceptable production upgrade authority, funded keeper or execution approval. No live transaction, real owner signature, wallet funding or production change occurred.
