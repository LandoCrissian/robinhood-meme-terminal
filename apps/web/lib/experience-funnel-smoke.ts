import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  EXPERIENCE_ONBOARDING_VERSION,
  EXPERIENCE_SCHEMA_VERSION,
  EXPERIENCE_STAGES,
  defaultExperiencePreferences,
  experienceDayId,
  normalizeExperienceDevice,
  normalizeExperiencePreferences,
  normalizeExperienceStage
} from "./experience-funnel";

assert.equal(EXPERIENCE_SCHEMA_VERSION, 1);
assert.equal(EXPERIENCE_ONBOARDING_VERSION, 1);
assert.equal(new Set(EXPERIENCE_STAGES).size, EXPERIENCE_STAGES.length);
for (const stage of EXPERIENCE_STAGES) assert.equal(normalizeExperienceStage(stage), stage);
for (const stage of ["", "page_view", "token_clicked", "wallet_address", null, 1]) {
  assert.equal(normalizeExperienceStage(stage), null);
}
assert.equal(normalizeExperienceDevice("mobile"), "mobile");
assert.equal(normalizeExperienceDevice("desktop"), "desktop");
assert.equal(normalizeExperienceDevice("tablet"), null);
assert.equal(experienceDayId(new Date("2026-07-30T23:59:59.000Z")), "2026-07-30");
assert.deepEqual(defaultExperiencePreferences(), {
  schemaVersion: 1,
  onboardingVersion: 0,
  diagnosticsEnabled: false,
  updatedAt: 0
});
assert.deepEqual(normalizeExperiencePreferences({
  schemaVersion: 999,
  onboardingVersion: 99,
  diagnosticsEnabled: true,
  updatedAt: 123
}), {
  schemaVersion: 1,
  onboardingVersion: 1,
  diagnosticsEnabled: true,
  updatedAt: 123
});
assert.equal(normalizeExperiencePreferences({ diagnosticsEnabled: "true" }).diagnosticsEnabled, false);

const guideSource = readFileSync(new URL("../app/first-visit-guide.tsx", import.meta.url), "utf8");
assert.match(guideSource, /terms\.accepted/);
assert.match(guideSource, /Find the market\. Verify the evidence\. Keep control\./);
assert.match(guideSource, /useState\(false\)/, "Diagnostics consent must not be preselected");
assert.match(guideSource, /No wallet address, token, amount, search, email, profile, cookie, or cross-session ID/);

const telemetrySource = readFileSync(new URL("../app/experience-telemetry.tsx", import.meta.url), "utf8");
assert.match(telemetrySource, /recordExperienceStage\("visit_started"\)/);
assert.match(telemetrySource, /recordExperienceStage\("wallet_connected"\)/);

const routeSource = readFileSync(new URL("../app/api/experience/funnel/route.ts", import.meta.url), "utf8");
assert.match(routeSource, /collection\("experienceFunnel"\)\.doc\(day\)/);
assert.match(routeSource, /FieldValue\.increment\(1\)/);
assert.match(routeSource, /Object\.keys\(input\)/);
assert.match(routeSource, /RMT administrator access required/);
assert.doesNotMatch(routeSource, /mediaClientAddress|communityAuthorKey|wallet|tokenAddress|amount|userAgent|cookie/i);

const settingsSource = readFileSync(new URL("../app/experience/experience-settings.tsx", import.meta.url), "utf8");
assert.match(settingsSource, /role="switch"/);
assert.match(settingsSource, /Anonymous journey milestones/);
assert.match(settingsSource, /Replay guide/);

const privacySource = readFileSync(new URL("../app/privacy/page.tsx", import.meta.url), "utf8");
assert.match(privacySource, /Optional anonymous experience measurements/);
assert.match(privacySource, /does not include a wallet address/);
assert.match(privacySource, /latest 14 days of daily aggregate counts/);

const adminSource = readFileSync(new URL("../app/admin/creator-applications/experience-funnel-insights.tsx", import.meta.url), "utf8");
assert.match(adminSource, /No opted-in visits yet/);
assert.match(adminSource, /once-per-browser-session milestones/);

for (const path of [
  "../app/wallet-button.tsx",
  "../app/privy-wallet-button.tsx",
  "../app/fresh-launch-feed.tsx",
  "../app/market-panel.tsx"
]) {
  assert.match(readFileSync(new URL(path, import.meta.url), "utf8"), /recordExperienceStage/);
}

console.info("Experience funnel smoke test passed");
