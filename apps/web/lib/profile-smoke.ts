import assert from "node:assert/strict";
import {
  parseCloudUserState,
  parseCloudWatchlist,
  resolveProfileSnapshot,
  resolveWatchlistSnapshot,
  watchlistSlots
} from "./profile-cloud";
import { DEFAULT_PROFILE, normalizeProfile } from "./profile";
import { normalizeWatchlist, normalizeWatchlistEntry } from "./watchlist";

assert.deepEqual(normalizeProfile(null), DEFAULT_PROFILE);

assert.deepEqual(normalizeProfile({
  displayName: "  Momentum Desk  ",
  handle: "@@runner.one!",
  bio: "  Watching liquidity and holder concentration.  ",
  traderMode: "momentum",
  density: "compact"
}), {
  displayName: "Momentum Desk",
  handle: "runnerone",
  bio: "Watching liquidity and holder concentration.",
  traderMode: "momentum",
  density: "compact"
});

assert.deepEqual(normalizeProfile({
  displayName: "",
  traderMode: "unsupported",
  density: "unsupported"
}), DEFAULT_PROFILE);

const watchedToken = {
  address: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  name: "  Runner One  ",
  symbol: " RUN ",
  image: "ipfs://bafy-runner",
  launchId: "42",
  addedAt: 1_000
};

assert.deepEqual(normalizeWatchlistEntry(watchedToken), {
  address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  name: "Runner One",
  symbol: "RUN",
  image: "ipfs://bafy-runner",
  launchId: "42",
  addedAt: 1_000
});
assert.equal(normalizeWatchlistEntry({ ...watchedToken, address: "not-an-address" }), null);
assert.equal(normalizeWatchlist([{ ...watchedToken }, { ...watchedToken, addedAt: 900 }]).length, 1);

const cloudState = parseCloudUserState({
  profile: { ...DEFAULT_PROFILE, displayName: "Cloud Desk" },
  profileUpdatedAt: 300,
  watchlistCount: 1,
  watchlistUpdatedAt: 400
});
assert.equal(cloudState.profile?.displayName, "Cloud Desk");
assert.equal(resolveProfileSnapshot(
  { profile: { ...DEFAULT_PROFILE, displayName: "Local Desk" }, updatedAt: 200 },
  cloudState
).profile.displayName, "Cloud Desk");
assert.equal(resolveProfileSnapshot(
  { profile: { ...DEFAULT_PROFILE, displayName: "Newer Local Desk" }, updatedAt: 500 },
  cloudState
).profile.displayName, "Newer Local Desk");
assert.equal(resolveProfileSnapshot(
  { profile: DEFAULT_PROFILE, updatedAt: 0 },
  parseCloudUserState(null),
  "Google Trader"
).profile.displayName, "Google Trader");

const normalizedEntry = normalizeWatchlistEntry(watchedToken)!;
const slots = watchlistSlots([normalizedEntry], 400);
assert.equal(slots[0]?.id, "00");
assert.deepEqual(parseCloudWatchlist(slots, cloudState), {
  entries: [normalizedEntry],
  updatedAt: 400
});
assert.equal(parseCloudWatchlist(slots, { ...cloudState, watchlistCount: 2 }), null);
assert.deepEqual(resolveWatchlistSnapshot(
  { entries: [], updatedAt: 500 },
  { entries: [normalizedEntry], updatedAt: 400 }
), { entries: [], updatedAt: 500 });

console.log("Profile and Firebase sync smoke tests passed.");
