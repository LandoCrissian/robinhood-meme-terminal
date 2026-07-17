import assert from "node:assert/strict";
import { DEFAULT_PROFILE, normalizeProfile } from "./profile";

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

console.log("Profile normalization smoke test passed.");
