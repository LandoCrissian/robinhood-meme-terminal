# Task 091: current deployed identity and unsigned publication review

The original factory action **remains pending and time-eligible** at the two captured canonical L2 observations. Nothing was signed, broadcast, scheduled again, cancelled or deployed. No token was created. Chain interactions were public reads and the owner's specifically requested ephemeral publication `eth_call` / gas review, with no wallet or secret access. After concrete root review under Task 091, four **nonfinancial explorer source-publication forms** were submitted once for the existing deployed contracts. All were accepted into the explorer queue; full source metadata is still unobserved. No contract or website configuration changed.

| Observation | Official and Pocket agree |
| --- | --- |
| Full protocol/runtime and publication review | Block **119336631**, `0xd9e3d0ada75c340f1f771b55f00df74dad8340c76a6b70c3737ecc72e45997f7`, **2026-11-20 20:32:20 UTC** |
| Migration admission and both treasury Safes | Block **119338032**, `0x974902e0cca0f5f0fd3bb07db4080ae40b02eaf0e7b7e3cd26af530a104375e6`, **2026-11-20 20:34:40 UTC** |
| Directory | Action nonce **0**, signer epoch **1**, latest factory version **0**, suspended **false**, factory(1) and currentFactory zero, no pending signer rotation |
| Original action | `0xad499113950f3410a60c6fe9fe40b4d1d98cf055eeafeb2b1736a5a38c5fea1e`; original canonical Schedule `0x96bd234e49d766c73c66f9787f26736040b4fc64d91ed2ae888eca3f4c8afb65` preserved |
| Actual notice / inclusive expiry | Mature since **2026-11-19 23:32:28 UTC**; expires **2026-11-26 19:50:06 UTC / 12:50:06 PM MST** |
| Current V3 template | `migrationTemplates(3)` zero. Its deployed successor runtime exists but is not admitted. Later production V2→V3 migration needs its own separately noticed governance action. This is separate from Factory V1 publication and token creation. |
| Safes | Both original Operations and Reserve proxies and three infrastructure runtimes match. Exact approved three owners, threshold **2**, nonce **0**, no modules or guard, pinned handler; canonical and pending configuration agree. |

[Current capture](current/capture.json.gz) retains all **206** bounded requests and exact raw response bytes, including all **14** production protocol/external runtimes at the same fixed block through both providers, five original constructor receipts and canonical blocks, original Schedule/event, three governance EOA eligibility checks, **21** immutable/economic bindings, and current delegated owner account identity. [Authority capture](current/authority.json.gz) retains **114** additional bounded reads, including both Safes and the unpublished V3 template. Every anchor is checked again after its reads. There were no retries or unavailable responses in these two captures. Neither L2 agreement nor current runtime correspondence proves Ethereum L1 finality.

## Exact review packet

[unsigned-execute-review.json](current/unsigned-execute-review.json) contains the complete 228-byte `DirectoryV2.execute(Action)` calldata, target `0xE677A69A8124714DD0d88b73BDf1B89cc791ca9C`, chain **4663**, original sender `0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA`, zero value, current confirmed/pending account nonce **494**, digest and predecessor schedule. Calldata hash: `0xf13b66ca989dd1034c95e9a9095dcb85e034b7a3a78f2a602698194cae1a542d`.

Both providers returned `0x` for the exact publication review and estimated **114416 gas**. The captured proposal uses **143020 gas**, maximum fee **42748000 wei/gas**, priority fee **0** and maximum network cost **6113818960000 wei (0.00000611381896 ETH)**. Observed Nitro L1 posting estimate is **0**; this is an estimate, not proof of L1 finality or a future fee guarantee. The sender's exact EIP-7702 designator and delegate runtime were verified at canonical and pending state.

The packet is **review-only** and never signing/broadcast authority. Its captured costs/nonce require a fresh capture before any owner-controlled wallet review; the offline admission expires after 180 seconds. The action remains bounded by its original inclusive November 26 deadline. Reconcile current mapping first: if anyone has already executed this permissionless action, verify the publication and do not submit a duplicate. Do not repeat the original signatures, Schedule or constructors.

**Publication permits direct public factory creation immediately even while every website financial flag stays OFF.** It creates no token, moves no assets, and does not publish the V3 migration template. The owner must separately approve that public factory effect and current wallet costs. No signature, cancellation, new schedule or submission is requested by this package.

## Reproduction and verification

Run the offline suite without credentials or network:

```powershell
node --test docs/evidence/rmt-task091/governance/review-packet.test.mjs
```

[offline-tests.txt](offline-tests.txt): **10/10 tests pass, zero skips**. Independent replay recomputes raw response hashes and deployed runtime hashes, decodes actual getters and schedule events, checks canonical block rechecks and both witnesses, original authority, manager/Permit2 and economic bindings, delegated sender and Safe custody configuration. Negative cases reject changed action/digest/epoch, duplicate publication, pending sender nonce, suspension, target/value/chain/calldata drift, unexpected authorization fields, a reorg or runtime change, altered simulation, prohibited RPC methods, missing funds, incoherent cost caps, immature notice, expired action and stale captured costs. The tenth test reconstructs the four source-publication constructor inputs and rejects changed source, constructor suffix, target, runtime and extra API-key fields. These tests neither execute governance nor establish a contract audit.

For a new explicitly authorized public review capture, create an empty evidence directory and run the pinned producer against it; it refuses to overwrite earlier observations:

```powershell
node docs/evidence/rmt-task091/governance/capture.mjs <fresh-output-directory>
node docs/evidence/rmt-task091/governance/capture-authority.mjs <fresh-authority.json.gz>
```

The first producer permits only fixed original public getters, known identities and the exact original already-scheduled publication simulation/estimate after real maturity. It has a **220-request**, **10-second timeout** and **256 KiB response** bound; the supplemental producer permits **128** read-only requests and no simulation. No signer/broadcast method exists. The exact compiler input and source plan remain the original immutable ones; these tools do not create an authorization or infer launch acceptance.

## Public source metadata and remaining action

[Explorer metadata](current/explorer-metadata.json), recorded **2026-11-20 20:38:48 UTC** through the Blockscout connector, reports full verification for Directory, Registry and both successor deployers. Bootstrap, guard, graduation engine and factory have **no observed full explorer verification metadata**. That initial metadata pass used eight read-only queries and consumed the existing free connector budget; it made no publication POST, new key, payment or quota workaround. Exact compiler/runtime correspondence is separately tested and does not turn these four metadata absences into published source.

[Four prepared requests](source-publication/manifest.json) contain the complete original Standard JSON and exact constructor suffix for each missing source record. They were prepared offline using the existing `export-blockscout-4663` input builder and production constructor materialization, rather than its archived fixture addresses. All eight original production initcode/runtime hashes and original guard salt are checked before writing. The immutable input SHA-256 remains `66aa27a8f98a395ba76cbf770a890107a56c60af4a5975bfdadd349c84273e10`; each request is a gzip JSON object whose `fields` are the exact multipart form fields, including `sourceCode`. The packet contains **no signing or deployment request**. Its source-publication constructor bytes are 416 (bootstrap), 64 (guard), 256 (engine), and 224 (factory).

The [official verification API documentation](https://docs.blockscout.com/devs/verification/blockscout-smart-contract-verification-api) documents Standard JSON, explicit constructor arguments and the per-instance contract API route. The normal alternative is the existing explorer's **Contract → Verify & publish → Solidity (Standard JSON input)** form with this input and the corresponding fully qualified name. The central API now requires a key; none is provided or created here. Current per-instance authentication/rate limits and verification acceptance have not been tested by this offline preparation. Stop on access denial, 429, CAPTCHA or payment requirement. A response saying verification started, or an old job status, cannot substitute for full canonical metadata/source/runtime correspondence.

```powershell
node docs/evidence/rmt-task091/governance/prepare-source-publication.mjs --solc <pinned-native-solc> --output-dir <fresh-directory>
```

The preparation script has no network request. After the exact forms were reviewed, [four normal per-instance submissions](current/source-publication-attempt.json) returned **HTTP 200 / API status 1** at **2026-11-20 20:45:31–33 UTC**, each with a verification GUID. This writes explorer source metadata only and deploys or signs nothing. No API key, paid service, new credential, alternate route, browser challenge bypass or connector quota reset was used. Exact submitted multipart and prepared-file digests, constructor suffixes, raw response text and GUIDs are retained.

The [one permitted result pass](source-publication-results/outcome.json) made eight ordinary GETs: one status and one canonical-metadata read for each accepted request. All four statuses were **Pending in queue**; none of the four canonical metadata responses yet contains full-verification/source fields. Raw metadata responses are retained beside the outcome. There was no polling loop, retry or duplicate form. **The four source-publication records remain an external-service blocker.** After processing, make one ordinary verification status/canonical metadata check and compare the full compiler/source/constructor/runtime identity before closing it; do not resubmit these accepted forms merely because they are queued. Preserve the earlier unverified observation and this queue evidence independently.

Owner-controlled steps are limited to a fresh exact publication wallet review before expiry, acceptance of its immediate public-creation effect, and the separately reviewed website activation prerequisites. This packet grants none of those actions. Public source metadata completion and independent L1 finality/policy acceptance remain separate from the verified L2/runtime observation; operational, physical-device and creator-site blockers are recorded in the parent Task 091 release decision.
