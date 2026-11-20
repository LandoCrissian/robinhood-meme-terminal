# Task 089 governance observation

The bounded official/Pocket observation at **2026-11-20T14:08:08Z**, canonical block **119107552** (hash `0x70519ad25081d3b20fc2e5ff92a9a0cee7c128a46ec83613520a211903ac2187`), found the original action **PENDING_TIME_ELIGIBLE**.

Both witnesses rechecked the canonical Schedule receipt `0x96bd234e49d766c73c66f9787f26736040b4fc64d91ed2ae888eca3f4c8afb65`, its block and exact ActionScheduled event. The original digest `0xad499113950f3410a60c6fe9fe40b4d1d98cf055eeafeb2b1736a5a38c5fea1e` remained pending with nonce 0, signer epoch 1 and unchanged signer identities. No factory was published: latestVersion 0, empty factories(1) and currentFactory. Directory/factory runtimes matched the retained pins.

The real notice completed November 19 at 23:32:28 UTC. The inclusive expiry is **2026-11-26T19:50:06Z / November 26 at 12:50:06 PM MST**. There were **538918 seconds** remaining at this observation. A later state change is possible; these are dated reads, not continuous monitoring.

There were exactly **42 RPC reads**, 21 per witness, restricted to chain ID, canonical block headers, the two exact runtime addresses, the exact Schedule receipt and enumerated public view getters. No execute/cancel call, state-changing simulation, gas estimation, transaction construction, signing or broadcast occurred. Raw receipt logs contain no authorization signatures; transaction input was not requested. The exact producer and responses are archived with SHA-256 identities. The producer's original Linux checkout path is retained for audit, not presented as a portable command or an instruction to perform more network activity.

Four offline tests bind archive/source identities, all methods/selectors, independent anchors and runtime pins, decoded state, original Schedule canonicality and the inclusive notice window. Run `node --test docs/evidence/rmt-task089/governance/read-state.test.mjs`. These tests use only retained files and the repository's pinned viem package.

Source interpretation: execute(Publish) sets latestVersion to 1 and factories(1) to the exact factory/runtime, clears pending and increments the action nonce. It creates no project token and moves no launch funds. It does admit that factory through RegistryV3.register when its other conditions hold. Website OFF flags do not enforce on-chain access. Publication has no caller-only or new-signature check, so a third party can execute the already scheduled action while its exact nonce/epoch/runtime/notice conditions hold. Directory suspension is not a Publish execution predicate; the registry separately rejects registration while suspended. This observation is not a recommendation or authorization to execute, cancel or suspend.

All core finding and operational holds remain. Two-provider L2 agreement does not establish Ethereum L1 finality or current correctness of every external dependency. **BLOCKED_NO_BROADCAST.**
