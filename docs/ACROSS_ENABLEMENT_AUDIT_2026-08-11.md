# Across funding enablement audit — 2026-08-11

Status: **software verification passed; production enablement blocked and left disabled**.

No signature, approval, transaction, deposit, refund, database write, commit, push, merge, or deployment occurred during this audit. Production-service mutations were limited to adding the newly issued Across API key and integrator ID, independently reviewed SpokePool deployment pins, and dedicated authenticated RPC configuration as server-only Vercel variables for Production and Preview. All execution flags remain disabled.

## Verification completed

- Full VNext prebuild suite passed, including strict Across quote verification, lifecycle persistence, source transaction verification, current `FundsDeposited` event verification, destination delivery proof, refund delivery proof, recovery, and kill-switch behavior.
- Optimized Next.js production build passed.
- Production dependency audit reported zero known vulnerabilities.
- Changed and untracked files passed a redacted Gitleaks scan.
- GitHub Dependabot reports zero open alerts.
- Current `origin/main` production health and secret-scan workflows are green.
- Public production health verification passed.
- Ethereum, Arbitrum, Base, and Robinhood SpokePool proxy bytecode, implementation addresses, and implementation bytecode hashes were re-read from chain and still match the recorded preflight observations.
- RMT was registered through the official Across integrator form. The issued API credential authenticated successfully against the production Swap API, and authenticated chain discovery returned Robinhood Chain 4663.
- Across's current official chain registry still identifies the exact Ethereum, Arbitrum, Base, and Robinhood SpokePool proxy addresses used by RMT. The official contracts repository documents the UUPS upgrade boundary, so RMT pins both proxy runtime and the current EIP-1967 implementation identity instead of trusting the stable proxy address alone.
- Release readiness now reports API credentials and deployment pins as separate gates. A valid API key can no longer make the readiness response ambiguously claim that contract pins are configured.
- A dedicated Alchemy funding app now serves Ethereum, Arbitrum, and Base mainnet only; the existing RMT Alchemy app serves Robinhood mainnet only. All testnet and beacon variants were disabled.
- Each dedicated RPC authenticated with a server-only bearer token and returned its exact expected chain ID: 1, 42161, 8453, and 4663. The same endpoints independently re-read every proxy runtime, EIP-1967 implementation address, and implementation runtime; all twelve observations matched the configured pins.
- RPC bearer credentials are stored separately from endpoint URLs so secrets do not appear in URLs, request logs, screenshots, or provider error traces.

## Production configuration audit

The signed-in production deployment contains Firebase Admin recovery credentials and now contains the registered RMT Across API key, integrator ID, all twelve reviewed proxy/implementation pins, four dedicated RPC endpoints, and four bearer credentials as server-only variables for Production and Preview. Credential values are intentionally omitted from this document.

It does not currently contain:

- either Across quote or authorization enablement flag.

This is safe. The application reports the infrastructure as configured while keeping new quotes, wallet authorization, and public asset selection disabled. Recovery tracking remains independently available for an existing deposit if one is later created under an authorized proof.

## Selected proof-wallet readiness

The selected admin proof wallet was read from the dedicated authenticated RPCs on Ethereum, Arbitrum, and Base. It currently holds no native Circle USDC on any of the three supported source chains. Ethereum has a small nonzero native-gas balance; Arbitrum and Base have neither native USDC nor native gas. No quote, approval, signature, transaction, or balance movement was attempted.

This is an expected fail-closed result. The wallet address is deliberately not committed into the repository, and RMT does not automatically acquire or move assets to manufacture a funded proof condition.

## Tests that cannot yet be completed

The following release gates still require external state and cannot be simulated into a production pass:

1. Authenticated production Swap API quote using RMT's registered integrator identity and a real supported source amount.
2. Read-only funded-wallet preflight against authentic Circle USDC and native gas on the selected source chain. The selected proof wallet currently fails this gate on all three supported source chains.
3. Controlled small-value source submission from the Privy-linked proof wallet.
4. Independent source receipt and `FundsDeposited` event reconciliation.
5. Destination USDG delivery and wallet balance delta confirmation on Robinhood Chain.
6. A controlled expiry/refund rehearsal proving the provider-to-onchain refund linkage and cross-device recovery.

The user currently has no Base USDC. RMT must not automatically acquire, bridge, or move funds to manufacture this proof condition.

## Exact enablement conditions

Before any live flag changes:

1. **Completed:** register RMT through the official Across integrator form and store the server-only API key and unique integrator ID as sensitive Production and Preview variables.
2. **Completed:** provision dedicated HTTPS RPC endpoints for Ethereum, Arbitrum, Base, and Robinhood Chain, restrict them to required mainnets, authenticate with server-only bearer credentials, and prove chain/deployment identity.
3. **Completed:** review, re-read, and configure the observed SpokePool proxy and implementation pins server-side.
4. Publish the reviewed code through a focused preview PR and verify the preview readiness endpoint.
5. Select a Privy-linked proof wallet and run the read-only three-chain balance scanner.
6. Separately approve a tiny authentic source-USDC proof balance plus source-chain gas.
7. Complete source, destination, persistence, recovery, and refund rehearsals.
8. Enable quotes first while public selection and authorization remain off.
9. Rehearse a fresh quote against the enabled preview.
10. Enable authorization only after the proof record is complete and reviewed.

Until every condition above is satisfied, `RMT_VNEXT_ACROSS_FUNDING_QUOTES_ENABLED=false` and `RMT_VNEXT_ACROSS_FUNDING_AUTHORIZATION_ENABLED=false` remain the required production state.
