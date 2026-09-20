# Phone quote state consistency repair

Base: `9be2dd25bee80a47e6f424ce9018e4065b37d22c`.

## Evidence and first failure

The owner reported contradictory freshness messages at 01:12–01:28 of
`ScreenRecording_09-20-2026 11-19-25_1.mp4`. The recording was not available in
this workspace; its timestamps are owner evidence, not a locally inspected video.

The new actual-component browser regression reproduces the contradiction on the
base build. It submits a synthetic approval through the local wallet boundary,
reloads its journal without retained handoff intent, selects the same amount,
recovers the approval receipt, obtains fresh server verification, then advances
the browser clock past expiry. The page shows an estimate and “Set when you
trade” for the minimum alongside “Fresh swap verification passed”.

The source defects are:

1. `postExecutionState.swap_ready` is historical but rendered an unconditional
   current verification claim. `currentTradeEvidence` correctly rejects expired
   authority, but the parent did not own a timer for plan/evidence expiry.
2. The automatic refresh effect admitted only `idle`, excluding the successfully
   restored `swap_ready` / `next_approval_ready` states. The wallet child labeled
   expiry “Refreshing price...” even when there was no refresh request.
3. Post-approval preparation duplicated the ordinary refresh pipeline outside
   its coordinator. While a replacement was pending, the primary action was
   disabled and the last displayed output could disappear.
4. A terminal `QUOTE_EXPIRED` failure could retain “Refreshing price...” as its
   error detail after preparation stopped. A second regression reproduces that
   contradiction with the expanded details visible; the terminal message now
   says “Price changed. Retry quote.”

The recording alone does not establish that an upstream request hung. No new
production quote or log-derived network latency is claimed. Local delayed
responses separately exercise genuine pending quote and verification requests.

## Repair

- One parent expiry boundary invalidates visible current-authority claims.
- The last same-intent output remains an explicitly stale, non-executable
  estimate; no cached minimum or authorization becomes current authority.
- Post-approval verification uses the existing generation-aware refresh
  coordinator, repeat-approval guard, exact verification and authorization.
- Restored ready states participate in the unchanged nine-second cadence.
- An explicit Trade click joins pending preparation, or obtains fresh authority
  when an idle plan already exists. Only retained explicit intent can hand off.
- A pending wallet component remains mounted through expiry to receive its
  original response; expiry never creates a second wallet request.

No expiry extension, faster polling, new execution system or fee-policy change.
Transport limits remain 12 seconds for indicative quotes, 15 for verification,
and 30 for authorization, each with one transport attempt. The existing outer
revalidation budget remains at most four attempts with bounded backoff for its
specific recoverable phases. Permanent failures stop for explicit retry.

## Validation scope

`quote-state-browser-checks.mjs` runs the real composer and server APIs on desktop
and mobile, with synthetic external provider/RPC/wallet boundaries. It covers:

- restored approval, fresh verification, expiry and delayed replacement;
- preserved stale output with no current minimum/simulation/ready claim;
- delayed indicative and firm-verification responses;
- replacement success, permanent failure and explicit retry;
- one in-flight refresh, including an explicit Trade click during the delay;
- a Trade click replacing a still-fresh idle authorization;
- no duplicate approval or unsolicited swap handoff.

The existing pending-wallet browser case additionally asserts that expiry keeps
the response owner mounted, removes current ready claims, and reload recovery
does not resubmit. Existing wallet, post-approval, stale generation, simulation,
commitment, fee, route-boundary and recovery negatives remain in the full suite.

The regression fails on the base build and the initial six desktop/mobile
quote-delay cases pass on the repaired build. The PR's exact-head browser and
required CI results are the authority for the complete final validation run.

These are LOCAL / MOCKED acceptance results, not real-wallet or production
acceptance. Merge and deployment require separate owner authorization; the next
production acceptance is the owner's ordinary phone journey.
