import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  classifyFundingFailure,
  createFundingSession,
  fundingSessionNeedsReconciliation,
  fundingSessionStorageKey,
  parseFundingSession,
  RMT_FUNDING_CHAIN_ID,
  reconcileFundingSession,
  recordFundingCheckoutOpened,
  recordFundingFailure,
  recordFundingResult
} from "./funding-session";

const destination = "0x1111111111111111111111111111111111111111";
const nativeAsset = "0x0000000000000000000000000000000000000000";
const tokenAsset = "0x2222222222222222222222222222222222222222";
const binding = { destination, chainId: RMT_FUNDING_CHAIN_ID, asset: nativeAsset };
const opened = createFundingSession({ destination, asset: nativeAsset, initialBalanceAtomic: 5n, now: 1 });
assert.equal(opened.status, "NOT_SUBMITTED");
assert.equal(opened.initialBalanceAtomic, "5");
assert.equal(
  fundingSessionStorageKey(binding),
  `rmt:funding:v1:${RMT_FUNDING_CHAIN_ID}:${destination}:${nativeAsset}`,
  "Persistence must bind the chain, destination, and exact asset."
);
assert.notEqual(
  fundingSessionStorageKey(binding),
  fundingSessionStorageKey({ ...binding, asset: tokenAsset }),
  "Two assets at one address must never share a funding session."
);
assert.throws(
  () => fundingSessionStorageKey({ ...binding, chainId: 1 }),
  /Robinhood Chain 4663/,
  "A persistence key for another chain must fail closed."
);
assert.throws(
  () => createFundingSession({ destination, asset: nativeAsset, initialBalanceAtomic: undefined as never }),
  /balance baseline/,
  "A funding session cannot start without an exact-asset balance baseline."
);
assert.throws(
  () => createFundingSession({ destination, asset: nativeAsset, initialBalanceAtomic: -1n }),
  /balance baseline/,
  "An exact-asset balance baseline cannot be negative."
);

const submitted = recordFundingResult(opened, { method: "fiat", status: "confirmed" }, 2);
assert.equal(submitted.status, "SUBMITTED_PENDING", "Provider confirmation must not impersonate destination settlement.");
assert.equal(fundingSessionNeedsReconciliation(submitted), true);
assert.equal(reconcileFundingSession(submitted, 5n, 3).status, "SUBMITTED_PENDING");
assert.equal(reconcileFundingSession(submitted, 6n, 4).status, "DELIVERED");
const providerPending = recordFundingResult(opened, { method: "fiat", status: "submitted" }, 2);
const pendingWithBalance = reconcileFundingSession(providerPending, 6n, 4);
assert.equal(pendingWithBalance.status, "SUBMITTED_PENDING",
  "A balance increase cannot resolve a provider flow without provider-attributable terminal evidence.");
assert.equal(pendingWithBalance.balanceIncreaseObservedAt, 4);
assert.equal(
  reconcileFundingSession(opened, 6n, 4).status,
  "NOT_SUBMITTED",
  "A balance increase cannot promote a session before provider submission."
);

const checkoutOpened = recordFundingCheckoutOpened(opened, 2);
assert.equal(checkoutOpened.status, "UNKNOWN");
assert.equal(fundingSessionNeedsReconciliation(checkoutOpened), true,
  "Opening provider UI must become unresolved before the SDK promise settles.");
assert.equal(reconcileFundingSession(checkoutOpened, 5n, 3).status, "UNKNOWN");
assert.equal(
  recordFundingFailure(checkoutOpened, new Error("not authenticated"), 3).session.status,
  "UNKNOWN",
  "After provider UI opens, an SDK error string cannot grant duplicate-checkout authority."
);

const cancelled = recordFundingFailure(opened, new Error("User closed the funding modal"), 2);
assert.equal(cancelled.session.status, "CANCELLED");
assert.doesNotMatch(cancelled.message, /no funds were moved/i);
assert.equal(fundingSessionNeedsReconciliation(cancelled.session), true);
assert.equal(reconcileFundingSession(cancelled.session, 6n, 4).status, "CANCELLED");
assert.equal(reconcileFundingSession(cancelled.session, 6n, 4).balanceIncreaseObservedAt, 4,
  "An unrelated direct receive is recorded without releasing a cancelled provider attempt.");

const failed = recordFundingFailure(opened, new Error("not authenticated"), 2);
assert.equal(failed.session.status, "FAILED");
assert.equal(reconcileFundingSession(failed.session, 6n, 4).status, "FAILED");
const unknown = recordFundingFailure(opened, new Error("provider window lost connection"), 2);
assert.equal(unknown.session.status, "UNKNOWN");
assert.equal(reconcileFundingSession(unknown.session, 6n, 4).status, "UNKNOWN");
assert.equal(classifyFundingFailure(new Error("not authenticated")).status, "FAILED");
assert.equal(classifyFundingFailure(new Error("provider window lost connection")).status, "UNKNOWN");

const persisted = parseFundingSession(JSON.stringify(submitted), binding);
assert.equal(persisted?.destination, destination);
assert.equal(parseFundingSession(JSON.stringify({ ...submitted, destination: tokenAsset }), binding), undefined);
assert.equal(parseFundingSession(JSON.stringify(submitted), { ...binding, asset: tokenAsset }), undefined);
assert.equal(parseFundingSession(JSON.stringify({ ...submitted, chainId: 1 }), binding), undefined);
assert.equal(parseFundingSession(JSON.stringify({ ...submitted, initialBalanceAtomic: undefined }), binding), undefined);
assert.equal(parseFundingSession("not-json", binding), undefined);

const fundingActions = readFileSync(new URL("../app/privy-funding-actions.tsx", import.meta.url), "utf8");
const fundingButton = readFileSync(new URL("../app/fund-wallet-button.tsx", import.meta.url), "utf8");
const receiveDialog = readFileSync(new URL("../app/wallet-receive-dialog.tsx", import.meta.url), "utf8");
assert.ok(
  fundingActions.indexOf("await nativeBalance.refetch()") < fundingActions.indexOf("await addFunds("),
  "Provider checkout must follow an exact-asset balance refresh."
);
assert.match(fundingActions, /typeof exactBalance !== "bigint"/,
  "Provider checkout must fail closed when the balance baseline is unavailable.");
assert.match(fundingActions, /identity\.activeWalletKey[\s\S]*?wallet\.key === identity\.activeWalletKey[\s\S]*?activeAddress\?\.toLowerCase\(\) === selectedWallet\.address\.toLowerCase\(\)/,
  "Provider funding must bind its destination to the exact connector-qualified trading account.");
assert.match(fundingActions, /BALANCE INCREASE OBSERVED · UNRESOLVED/,
  "An unattributed balance increase remains visibly unresolved rather than releasing provider retry authority.");
assert.doesNotMatch(fundingActions, /Funding is marked delivered/,
  "Balance movement must not be presented as provider-attributed delivery.");
assert.match(fundingActions, /recordFundingCheckoutOpened\([\s\S]*?saveSession\(opened\)[\s\S]*?await addFunds\(/,
  "An unresolved funding record must be durable before provider UI opens.");
assert.match(fundingActions, /navigator\.locks\.request\([\s\S]*?readPersistedSession\(\)[\s\S]*?fundingSessionNeedsReconciliation\(persisted\.session\)[\s\S]*?saveSession\(opened\)[\s\S]*?await addFunds\(/,
  "Provider checkout must re-read durable state inside one cross-tab lock before opening provider UI.");
assert.match(fundingActions, /fundingAttemptInFlight\.current[\s\S]*?return;[\s\S]*?fundingAttemptInFlight\.current = requestStorageKey/,
  "A same-tab double click must fail closed before balance reads or provider UI.");
assert.match(fundingActions, /const requestStorageKey = storageKey[\s\S]*const publish = \(next: string\)[\s\S]*activeStorageKey\.current === requestStorageKey[\s\S]*setMessage\(next\)/,
  "Delayed funding results may publish status only into the exact destination account that started them.");
assert.match(fundingActions, /fundingAttemptKey && fundingAttemptKey !== storageKey[\s\S]*Finish the open funding window/,
  "An account switch cannot disguise a still-open provider window or open a concurrent replacement.");
assert.match(fundingActions, /window\.addEventListener\("storage", storageChanged\)/,
  "Another tab's unresolved funding record must update the visible authority state.");
assert.match(fundingActions, /if \(!saveSession\(opened\)\)[\s\S]*?provider checkout was not opened/,
  "Provider checkout must stay closed when duplicate protection cannot be persisted.");
assert.doesNotMatch(fundingActions, /No increase observed · start a new deposit/,
  "A momentary unchanged balance must not authorize a duplicate provider attempt.");
assert.match(fundingActions, /stays blocked until provider-attributable finality and destination delivery are both established/,
  "Uncertain and cancelled funding must remain visibly unresolved even if an unrelated direct receive arrives.");
assert.match(fundingActions, /privyFundingMatchesRequestedAsset\(funding, requestedAsset\)/,
  "Provider checkout must compare its configured destination asset with the exact ticket request.");
assert.match(fundingActions, /if \(!providerAssetMatches\)[\s\S]*will not silently substitute/,
  "A provider-asset mismatch keeps exact direct receive available without silently changing the requested asset.");
assert.match(fundingActions, /destination && providerAssetMatches \? fundingSessionStorageKey/,
  "A mismatched provider asset must not hydrate or create a funding authority record.");
assert.match(fundingButton, /<PrivyFundingActions requestedAsset=\{exactRequestedAsset\}/,
  "The deposit sheet passes its exact selected asset into provider capability enforcement.");
assert.match(fundingButton, /<WalletReceiveDialog[\s\S]*requestedAsset=\{exactRequestedAsset\}/,
  "Direct receive carries the exact selected asset into the destination review.");
assert.match(receiveDialog, /Selected asset:[\s\S]*Sending another asset will not fund this trade ticket/,
  "Receive presents the exact native or contract asset without implying that another asset funds the current ticket.");

console.log("Account-first funding session state remains destination-bound and balance-reconciled.");
