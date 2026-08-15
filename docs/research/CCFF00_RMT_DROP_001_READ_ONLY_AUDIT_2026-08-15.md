# CCFF00 × RMT Drop #001 — read-only audit

**Date:** 2026-08-15  
**Status:** research evidence only; no approval, signature, transaction, deployment, fee activation, or fund movement  
**Branch:** `research/ccff00-tba-probe`

## Exact identities

- Robinhood Chain: `4663`
- CCFF00 ERC-721 collection: `0x505A22Ffed8d37ebE580FfD98d2Cdb0021189146`
- CCFF00 ERC-20: `0x73CB777311Dc5e464C53Ddafb4496Fd87fE0eC97`
- RMT ERC-20: `0xdBa33be56C89CC9fc014c4459028d7e5c7878671`
- ERC-6551 Registry: `0x000000006551c19487814612e58FE06813775758`
- CCFF00 account implementation: `0x03dA8C9df253a4401b08629a6F50E4c4E8e248cC`
- CCFF00 ERC-6551 salt: `0x448cc5ed5a52db42393a3d48476af932464724d8262648ad18b66d2ffef1a8e0`
- Candidate verified batch sender: `HoodAirdrop` at `0x7bd896c76351250aCC46AA7DcB22C0106dbb1175`

The verified CCFF00 NFT source exposes `getTokenBoundAccount(tokenId)` and derives the account through the exact ERC-6551 registry, implementation, salt, chain ID, collection address and token ID. Its mint path funds that deterministic token-bound account with the configured `TOKENS_PER_NFT` allocation.

## Supply boundary

At full-supply snapshot block `37448096`:

- total minted NFTs: **732**
- public/community minted NFTs: **482**
- reserve minted NFTs: **250**
- current public IDs: **1–482**
- founder reserve IDs: **9751–9770** (20)
- project reserve IDs: **9771–10000** (230)

The reserve NFTs are deliberately excluded from the proposed community Drop #001 unless a later explicit decision includes them.

## Public/community drop audit

At exact snapshot block `37451763`, direct Robinhood RPC reads were performed for every public token ID `1–482`.

Results:

- public NFTs: **482**
- unique current public owner wallets: **164**
- unique deterministic public TBAs: **482**
- activated/deployed public TBAs: **24**
- counterfactual/not-yet-deployed public TBAs: **458**
- TBAs holding exactly the configured 10,000 CCFF00: **482 / 482**
- total CCFF00 across public TBAs: **4,820,000 CCFF00**
- public TBAs already holding RMT: **0 / 482**
- public TBAs with zero RMT: **482 / 482**
- total RMT across the 482 public TBAs before any RMT drop: **0 RMT**

Therefore, at this snapshot, a successful RMT transfer to every public CCFF00 TBA would create **482 RMT-holding token-bound addresses**.

## Canary NFTs

The deterministic addresses independently derived from the verified collection contract exactly match the shortened HoodStreet UI addresses supplied by the owner.

| NFT | Owner at snapshot | Canonical TBA | Activated | CCFF00 | RMT |
| --- | --- | --- | --- | ---: | ---: |
| #470 | `0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA` | `0xFd1fDC1d3aA3AeEA37b265C691C7D367cBb20a6e` | no | 10,000 | 0 |
| #471 | `0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA` | `0xF26b9c1ecA9489A1AdCe201fB82630889cfe6246` | no | 10,000 | 0 |
| #472 | `0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA` | `0x3b71916De0aE9a4e2303dD6fCe66A8f6555c83D5` | no | 10,000 | 0 |

These three accounts already hold their 10,000 CCFF00 while their account bytecode is not yet deployed. That is consistent with CCFF00 deliberately funding deterministic ERC-6551 addresses before account activation.

## Proposed Drop #001 budget

For the **482 public/community NFTs only**:

| RMT per NFT TBA | Total RMT |
| ---: | ---: |
| 100 | 48,200 |
| 250 | 120,500 |
| **500** | **241,000** |
| 1,000 | 482,000 |
| 2,000 | 964,000 |

The current recommended first public allocation is **500 RMT per TBA**, totaling **241,000 RMT**, subject to the canary control test below.

## Required canary before any mass distribution

The CCFF00 collection and ERC-6551 registry source are verified on Blockscout, but the custom CCFF00 account implementation at `0x03dA...248cC` has runtime bytecode and is **not source-verified on Blockscout**. Therefore the mass transfer must not be the first RMT interaction with these accounts.

Required sequence:

1. Send **1 RMT** to each of #470, #471 and #472 canonical TBAs (3 RMT total).
2. Confirm all three RMT balances change from zero to exactly 1 RMT.
3. Activate/deploy at least one of those token-bound accounts through the existing HoodStreet path.
4. Re-read deployed account bytecode and NFT/account binding.
5. Prove the current NFT owner can execute an RMT transfer out of that TBA.
6. Only after that proof, prepare the full 482-recipient transaction(s).
7. Re-snapshot immediately before the mass drop if eligibility should include public NFTs minted after block `37451763`.

## Candidate batch sender

Blockscout reports `HoodAirdrop` at `0x7bd896c76351250aCC46AA7DcB22C0106dbb1175` as a verified, non-proxy contract. Its ABI exposes `airdrop` and `airdropEqual`.

The verified `airdropEqual` source loops the supplied recipient array and calls `IERC20(token).safeTransferFrom(msg.sender, recipient, amount)` for each recipient. It rejects an empty list, zero amount and zero recipients, then emits the aggregate `Airdropped` event.

If used after the canary, RMT should approve only the exact drop amount required by the chosen batches; transaction gas and maximum safe recipients per batch must be simulated before signing. No batch size is authorized by this audit.

## Accounting classification

This proposed first drop is manually funded ecosystem/community canary funding. It is **not RMT terminal execution-fee revenue**, and it must not be reported as fee-funded while RMT production execution-fee collection remains disabled.
