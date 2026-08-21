# CCFF00 Community Engine gas cost and budget model V1

**Status:** PLANNING ONLY — NUMERIC CAPS DEFERRED TO MEASURED CANARIES  
**Purpose:** make Community Engine ETH spending observable, bounded and economically rational without tying allocation rights to contributions or selling RMT for gas.

## 1. Core rule

The engine acquires zero-price NFTs, but zero mint price does not mean zero cost.

Every admitted run should account for:

```text
acquisition transaction gas
+ optional TBA activation gas
+ NFT delivery gas
+ failed/reverted/uncertain transaction gas actually charged
= Community Engine native gas cost
```

No RMT conversion is part of this calculation.

## 2. Onchain-native cost unit

Authoritative accounting unit is wei.

For a confirmed EIP-1559-style transaction where receipt exposes effective gas price:

```text
txGasCostWei = gasUsed * effectiveGasPrice
```

Use receipt fields rather than a pre-submit estimate for confirmed actual cost.

If Robinhood receipt semantics/provider exposes additional L1/data fee fields separately, Package G/H must inspect current chain receipts and define whether those are already reflected in `effectiveGasPrice * gasUsed` or need separate accounting. Do not double count.

## 3. Cost categories

Every charged transaction should classify:

```text
MINT_ACQUISITION
TBA_ACTIVATION
NFT_DELIVERY
REPAIR_DELIVERY
COLLECTOR_MAINTENANCE
RMT_PAY_SPONSORED_GAS  // separate rail/accounting, not collector budget by default
```

The first four are Community Engine collector-run costs.

RMT Pay sponsorship must remain separately reported unless an explicit later funding integration combines budgets.

## 4. Run accounting

For one mint run:

```text
mintRunNativeCostWei =
  acquisitionGasWei
  + sum(tbaActivationGasWei)
  + sum(deliveryGasWei)
  + sum(repairGasWei)
  + chargedFailureGasWei
```

Track separately:

```text
successfulGasWei
failedGasWei
uncertainEventuallyChargedGasWei
```

Do not hide failed gas in successful cost averages.

## 5. Per-NFT effective gas cost

After deliveries reconcile:

```text
confirmedDeliveredCount = N
```

If `N > 0`:

```text
costPerDeliveredNftWei = mintRunNativeCostWei / N
```

Also expose acquisition-only and delivery-only averages so regressions are diagnosable.

## 6. TBA activation cost attribution

If a selected Square's canonical TBA must be deployed/activated before receiving its first NFT, that cost is a Community Engine delivery cost for the run that first needs it.

Track:

```text
activationCount
activationGasWei
```

Do not charge/penalize the holder's future fairness level because their TBA required activation.

A later policy could preactivate TBAs for efficiency, but V1 should not spend gas doing so without an imminent admitted delivery unless separately justified.

## 7. Pre-sign gas estimate

For each tx compute:

```text
gasUnitsEstimate
feePerGasEstimate
totalEstimatedGasWei
```

Use current Robinhood transaction fee mechanics/provider data at implementation time.

Do not price-limit using USD as the only security cap because USD oracle/provider failure should not permit arbitrary wei spend.

Primary hard caps are native units:

```text
maxGasUnits
maxGasCostWei
```

USD can be display/advisory.

## 8. Multi-level spend caps

Package H should maintain independent caps:

### Transaction cap

```text
maxMintTxGasWei
maxDeliveryTxGasWei
maxActivationTxGasWei
```

### Mint-run cap

```text
maxMintRunGasWei
```

includes acquisition + expected deliveries/activation safety budget.

### Time-window cap

```text
maxRollingGasWei
windowSeconds
```

or explicit UTC/day/epoch policy.

### Inventory exposure cap

```text
maxPendingInventory
```

prevents continuing to mint when gas budget is insufficient to deliver already-acquired NFTs.

## 9. Admission must reserve delivery budget

Do not spend the last ETH acquiring NFTs that the collector cannot afford to distribute.

Before mint signing, estimate/reserve:

```text
acquisition gas
+ worst-case admitted delivery gas for quantity
+ potential TBA activation gas for selected/preflight cohort when estimable
+ safety reserve
```

If current available/authorized budget is less than required:

```text
DO NOT MINT
```

Possible code:

```text
COMMUNITY_ENGINE_GAS_BUDGET_EXHAUSTED
```

This is stronger than checking only whether the collector can pay the mint transaction itself.

## 10. Fairness preflight vs gas forecast

Package D fairness preflight knows a candidate set/count, but final selected owners/Squares are only determined after acquisition + randomness.

Therefore pre-mint gas budget should use a conservative activation/delivery estimate rather than picking owners early just to estimate exact gas.

Possible approach after Package F measurements:

```text
expected max delivery gas per item
expected max activation+delivery gas per item
```

Use worst-case or reviewed percentile + explicit safety margin once real data exists.

Do not bias selection toward already-activated Squares merely to save gas; that would make gas state an allocation weight.

## 11. Cap derivation from canaries

Do not invent production numbers now.

Package G/H should collect:

```text
mint gas samples by adapter/quantity
delivery gas samples by transfer method
TBA activation gas samples
failed/revert gas samples
gas-price observations
```

Then propose caps with evidence.

A reasonable process conceptually:

1. collect controlled samples;
2. compute median/p95/max observed gas units per operation type;
3. inspect outliers manually;
4. choose an explicit safety margin;
5. owner reviews native-ETH exposure;
6. freeze versioned caps;
7. production never silently increases them.

No particular percentile/margin is pre-approved by this planning doc.

## 12. Adapter-specific gas profiles

Different mint families may have different acquisition gas.

Maintain measurements by:

```text
adapterId
adapterVersion
quantity bucket
```

Do not let a cheap SeaDrop profile authorize a high-gas unknown/new adapter.

New adapter release includes gas rehearsal/profile before production cap admission.

## 13. Gas-price spike behavior

If gas price rises after an unsigned mint plan was built:

- refresh gas estimate immediately before signing;
- if hard native-cost cap exceeded, wait/reject;
- do not increase cap automatically;
- do not sell RMT to cover difference;
- do not switch to a different recipient cohort to reduce gas.

A candidate can expire while waiting for acceptable gas. Missing a free mint is preferable to uncontrolled spend.

## 14. Failed/reverted transaction policy

A failed transaction may still spend gas.

After confirmed failure:

```text
failedGasWei += actual receipt cost
```

Failure budget should feed adapter/provider health decisions.

Repeated adapter-specific reverts after a previously valid simulation should auto-pause that adapter/candidate rather than burn gas retrying.

## 15. Uncertain transaction accounting

Until transaction fate known:

```text
reserve potential gas liability
```

Do not free its budget and submit a replacement simply because no receipt is currently visible.

Once reconciled:

- if not submitted/proven absent, release reservation;
- if confirmed, book actual gas;
- if replaced, book charged canonical transaction(s) according to chain evidence.

## 16. Repair gas

A delivery repair is part of the original mint-run economics.

Public proof/accounting should show:

```text
initial delivery attempts
repair attempts
repair gas
final delivery outcome
```

Do not exclude repair gas to make cost/NFT metrics look better.

## 17. Gas fund sources

Account source categories separately:

```text
COMMUNITY_VOLUNTARY_ETH
RMT_OPERATIONS_VOLUNTARY_ETH
VERSIONED_REVENUE_POLICY_ETH
OTHER_EXPLICITLY_ADMITTED
```

No source category changes fairness.

Do not claim current RMT terminal revenue funds Community Engine until an actual transaction/policy does.

## 18. Community gas runway

Useful advisory metric:

```text
availableGasBudgetWei
/
recentConservativeCostPerDeliveredNftWei
≈ estimated additional NFT deliveries
```

This is an estimate, not a guarantee, because gas/adapter/activation mix changes.

Another useful metric:

```text
estimatedRunsAtCurrentCap
```

based on hard per-run maximum exposure.

## 19. No “spend the whole vault” behavior

Even if gas vault holds substantial ETH, collector operating balance should remain small and refill-bounded.

Runtime should reason over:

```text
collector operating budget
```

not treat the entire community vault balance as available to one transaction.

This preserves blast-radius isolation.

## 20. Budget state reference

Conceptual:

```ts
type CommunityGasBudgetStateV1 = {
  policyVersion: number;
  collectorBalanceAtomic: UintString;
  committedPendingGasAtomic: UintString;
  rollingSpentAtomic: UintString;
  rollingWindowStart: UintString;
  maxRollingSpendAtomic: UintString;
  maxMintRunSpendAtomic: UintString;
  maxPendingInventory: number;
  stateHash: Hex;
};
```

Mint pre-sign verifies fresh budget state.

## 21. Gas policy version

A future production policy should bind numeric caps and operation categories in a hashable artifact:

```text
policyVersion
chainId
collector
operation caps
run cap
window cap
pending inventory cap
effective boundary
policyHash
```

Changing a cap creates a new version/release review.

No environment variable alone should silently widen onchain spend beyond the reviewed policy without corresponding evidence/release controls.

## 22. Public gas dashboard

Future public metrics:

```text
Gas fund balance
Community ETH contributed
Other admitted ETH contributed
ETH spent on successful mints
ETH spent on deliveries/activation
ETH spent on failed/reverted txs
NFTs successfully delivered
Average native gas per delivered NFT
Current estimated runway
Current policy/caps
```

Do not display a donor contribution as an NFT entitlement.

## 23. USD display

If useful, show a current approximate USD value of gas spend via a clearly sourced price feed/API.

USD is informational and may be stale/unavailable.

Native wei accounting remains authoritative.

## 24. RMT Pay gas accounting is separate

RMT Pay may use a third-party sponsor/paymaster whose costs are:

- prepaid billing balance;
- provider invoice/credit;
- onchain paymaster deposit;
- another model.

Do not automatically add these costs to Community Engine collector gas-vault accounting.

Future dashboard can show both categories separately:

```text
Collector gas
RMT Pay sponsored gas
```

## 25. Success criterion

The engine's gas model succeeds when:

- no mint can exceed reviewed native exposure;
- delivery budget is considered before acquisition;
- failed gas is visible;
- uncertain tx reserves budget;
- gas price spikes fail closed;
- contributor amount never changes allocation;
- RMT is never automatically sold to replenish ETH;
- numeric caps come from canary evidence rather than guesses.
