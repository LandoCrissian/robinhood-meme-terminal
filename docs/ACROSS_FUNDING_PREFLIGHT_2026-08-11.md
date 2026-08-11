# Across funding read-only mainnet preflight — 2026-08-11

No signature, approval, transaction, database write, or production feature enablement occurred.

## Route availability

Anonymous read-only `/swap/approval` probes used a non-funded probe address and a 5 USDC exact input. Across returned HTTP 200 for every intended route:

| Source | Route | Expected USDG | Protected USDG | Reported fee | Quoted fill |
| --- | --- | ---: | ---: | ---: | ---: |
| Ethereum native USDC | direct `bridgeableToBridgeable` | 4.989115 | 4.989115 | 0.010903 USDC | 2s |
| Arbitrum native USDC | direct `bridgeableToBridgeable` | 4.989614 | 4.989614 | 0.010403 USDC | 1s |
| Base native USDC | direct `bridgeableToBridgeable` | 4.989614 | 4.989614 | 0.010403 USDC | 1s |

All three responses had:

- exact native Circle USDC input identity;
- canonical Robinhood USDG output identity;
- the expected source SpokePool target;
- Across as the bridge provider;
- no origin swap;
- no destination swap;
- source USDC as the refund token.

Provider simulation was false because the deliberately non-funded probe address had no source balance. RMT correctly treats that as non-executable. A strict pass requires the real, Privy-linked proof wallet to hold the selected native USDC and source-chain gas.

RMT now independently reads the exact registered USDC balance and native gas balance before requesting a funded quote. `pnpm --filter web readiness:vnext-across` checks Base, Arbitrum, and Ethereum without signing or submitting anything. An empty chain reports `fundedPreflightReady=false` and `transactionAttempted=false`; it does not prompt the user to acquire or bridge funds.

The public endpoint accepted anonymous probes, but Across documentation requires an API key and registered two-byte integrator ID for production. RMT continues to require both and will not rely on anonymous availability.

## Upgradeable deployment evidence

Each SpokePool is an EIP-1967/UUPS proxy. Pinning only the proxy runtime is insufficient because its implementation can change without changing the proxy code. RMT now verifies the proxy hash, implementation slot, implementation address, and implementation runtime hash.

| Chain | Proxy runtime hash | Implementation | Implementation runtime hash |
| --- | --- | --- | --- |
| Ethereum | `0x932cddc50793da935ccf915651ad67f6b746e9936fcc5614f0ff492563782c75` | `0x5E5B726C81f43B953a62AD87E2835C85c4D9Dd3B` | `0x871b78b472741f6a433cb26def3ac3360c596afc7d280b3bb7c6ed40c716861f` |
| Arbitrum | `0x932cddc50793da935ccf915651ad67f6b746e9936fcc5614f0ff492563782c75` | `0xAE54d52223C34e4102927516900Cc3c562Afe02E` | `0x4bda0932952ceb4450f2ca0fd84bb800123d7bf0d68d7df0bd0a77d453483f3a` |
| Base | `0x932cddc50793da935ccf915651ad67f6b746e9936fcc5614f0ff492563782c75` | `0x77AA19D49484Cc88c2cA1C8527226E891C5C72D8` | `0x56896163199aed50b424c2103562d16e2ce5ac16878bb46e287a4d16a42a83ee` |
| Robinhood | `0xbad165a67f16d7be75d8197acdecb912517a516ce0ca2249dee18cd643577f61` | `0x3Db06DA8F0a24A525f314eeC954fC5c6a973d40E` | `0xbe087541a5136cbfede5292fb114c44763b1830a45de82915b68f3f51270a806` |

These values are observations, not automatic approvals. They require source/deployment review before being placed in the production environment. Any subsequent implementation change fails closed until separately reviewed.

## Swap API calldata marker

Current Swap API responses append a fixed `73c0de` marker after the optional documented `1dc0de + integratorId` suffix. This marker is not described on the public integrator page reviewed during the preflight.

RMT accepts only these exact encodings:

- canonical ABI calldata;
- canonical calldata + exact configured integrator suffix;
- either of the above + exact `73c0de` Swap API marker.

Any different trailing byte fails closed. The marker remains an explicit provider-schema assumption to reconfirm with an authenticated production quote before sending funds.

## Remaining blockers

Registration, exact deployment pins, dedicated authenticated RPCs, and Firebase recovery persistence are complete. The selected admin proof wallet was scanned on all three supported source chains and has no native Circle USDC. It has a small nonzero Ethereum gas balance but no Arbitrum or Base gas.

1. Keep the funding flow fail closed without presenting a transaction while no supported source is funded.
2. Separately approve and place a tiny authentic Circle USDC proof balance plus native gas on one selected source chain. Do not manufacture readiness or move funds automatically.
3. Run `pnpm --filter web preflight:vnext-across` for the authenticated strict read-only quote.
4. Only after that passes, present the exact approval/deposit to the wallet for the controlled proof.

Base remains the preferred first proof because it is the lowest-friction planned source. Arbitrum and Ethereum remain independently gated paths; the code does not assume the user currently owns Base USDC.
