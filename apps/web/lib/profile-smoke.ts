import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parseCloudUserState,
  parseCloudWatchlist,
  resolveProfileSnapshot,
  resolveWatchlistSnapshot,
  watchlistSlots
} from "./profile-cloud";
import {
  DEFAULT_PROFILE,
  normalizeProfile,
  profileIdentityEditState,
  PROFILE_IDENTITY_COOLDOWN_MS,
  PROFILE_IDENTITY_GRACE_MS
} from "./profile";
import { normalizeWatchlist, normalizeWatchlistEntry, watchlistEntryHref } from "./watchlist";
import {
  cleanProjectMediaUri,
  normalizeCreatorApplication,
  normalizeProjectIdentity,
  normalizeProjectSlug,
  parsePublicProject,
  validateCreatorApplication,
  validateProjectIdentity
} from "./creator-application";
import {
  parseModuleActivationRequest,
  parseProjectAssignment
} from "./project-ownership";
import {
  generateReferralCode,
  normalizeReferralCode,
  referralUrl,
  referralXIntent,
  REFERRAL_CODE_PATTERN
} from "./referrals";
import {
  normalizeGameUpdate,
  parseGameUpdate,
  validateGameUpdate
} from "./game-updates";
import { validateCreatorImage } from "./creator-media";
import { firebaseUidForPrivyUser, verifiedPrivyEmail } from "./server/privy-identity";

const vercelConfig = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8")) as {
  headers?: Array<{
    source?: string;
    headers?: Array<{ key?: string; value?: string }>;
  }>;
};
const profileProviderSource = readFileSync(new URL("../app/profile-provider.tsx", import.meta.url), "utf8");
const profilePageSource = readFileSync(new URL("../app/profile/page.tsx", import.meta.url), "utf8");
const identityBridgeSource = readFileSync(new URL("../app/rmt-identity.tsx", import.meta.url), "utf8");
const firebaseSessionRouteSource = readFileSync(new URL("../app/api/auth/firebase-session/route.ts", import.meta.url), "utf8");
const firebaseUserBindingSource = readFileSync(new URL("./server/rmt-firebase-user.ts", import.meta.url), "utf8");
assert.match(
  profileProviderSource,
  /useRmtIdentity\(\)/,
  "Profiles must use the single RMT identity context"
);
assert.match(
  profileProviderSource,
  /fetch\("\/api\/auth\/firebase-session"/,
  "The browser must exchange the signed RMT identity through the same-origin bridge"
);
assert.match(
  profileProviderSource,
  /signInWithCustomToken\(client\.auth, result\.firebaseToken\)/,
  "Firestore access must use a server-minted custom token"
);
assert.doesNotMatch(
  profileProviderSource,
  /signInWithRedirect|signInWithPopup|sendSignInLinkToEmail|signInWithEmailLink/,
  "RMT must not expose a second Firebase sign-in flow"
);
assert.match(
  identityBridgeSource,
  /usePrivy\(\)/,
  "Privy must own the visible RMT account session"
);
assert.match(
  identityBridgeSource,
  /useIdentityToken\(\)/,
  "The account bridge must use Privy's signed identity token"
);
assert.match(profilePageSource, /Sign in or create RMT account/);
assert.match(profilePageSource, /Keep one account—link extra sign-in methods here/);
assert.match(profilePageSource, /Link Google/);
assert.match(profilePageSource, /Link wallet/);
assert.match(profilePageSource, /useDisconnect\(\)/);
assert.match(profilePageSource, /disconnectWallet\(\)/);
assert.match(profilePageSource, /setEditorExpanded\(false\)/, "A saved identity must return to a compact profile summary.");
assert.match(profilePageSource, /Update desk settings/, "A user must be able to reopen the compact identity editor.");
assert.equal((profilePageSource.match(/Sign in or create RMT account/g) ?? []).length, 1);
assert.match(identityBridgeSource, /account\.walletClientType !== "privy"/);
assert.match(identityBridgeSource, /linkWallet: \(\) => linkWallet\(\{ walletChainType: "ethereum-only" \}\)/);
assert.doesNotMatch(profilePageSource, /OR USE ANY EMAIL|passwordless|Firebase sign-in/);

assert.match(firebaseSessionRouteSource, /verifyPrivyIdentity\(token\)/);
assert.match(firebaseSessionRouteSource, /findRmtFirebaseUser\(auth, privyUserId, email\)/);
assert.match(firebaseUserBindingSource, /getUserByEmail\(email\)/);
assert.match(firebaseUserBindingSource, /emailBinding !== privyUserId/);
assert.match(firebaseSessionRouteSource, /identity_already_bound/);
assert.match(firebaseSessionRouteSource, /createCustomToken\(user\.uid, claims\)/);
assert.match(firebaseSessionRouteSource, /rmt_privy_uid:\s*privyUserId/);
assert.doesNotMatch(firebaseSessionRouteSource, /request[^\n]*email|input[^\n]*email/);

const privyUid = firebaseUidForPrivyUser("did:privy:rmt-user");
assert.match(privyUid, /^rmt_privy_[a-f0-9]{64}$/);
assert.doesNotMatch(privyUid, /rmt-user/);
assert.equal(privyUid, firebaseUidForPrivyUser("did:privy:rmt-user"));
assert.equal(verifiedPrivyEmail({ linked_accounts: [
  { type: "email", address: " ADMIN@Example.com ", verified_at: 10 }
] } as never), "admin@example.com");
assert.equal(verifiedPrivyEmail({ linked_accounts: [
  { type: "email", address: "ignored@example.com", verified_at: 0 },
  { type: "google_oauth", email: " Google@Example.com ", verified_at: 20 }
] } as never), "google@example.com");
assert.equal(verifiedPrivyEmail({ linked_accounts: [
  { type: "email", address: "unverified@example.com", verified_at: 0 }
] } as never), "");

const globalSecurityHeaders = new Map(
  vercelConfig.headers?.find((entry) => entry.source === "/(.*)")?.headers?.map((header) => (
    [header.key?.toLowerCase(), header.value]
  )) ?? []
);
assert.match(
  globalSecurityHeaders.get("content-security-policy") ?? "",
  /frame-ancestors 'none'/,
  "Production must reject framing through CSP"
);
assert.equal(globalSecurityHeaders.get("x-frame-options"), "DENY");
assert.equal("rewrites" in vercelConfig, false, "The retired Firebase OAuth helper proxy must remain removed");
assert.equal(globalSecurityHeaders.get("x-content-type-options"), "nosniff");
assert.equal(globalSecurityHeaders.get("referrer-policy"), "strict-origin-when-cross-origin");
assert.match(globalSecurityHeaders.get("permissions-policy") ?? "", /camera=\(\)/);

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
assert.equal(
  watchlistEntryHref(normalizeWatchlistEntry(watchedToken)!),
  "/project/0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa?launch=42"
);
assert.equal(
  watchlistEntryHref(normalizeWatchlistEntry({ ...watchedToken, launchId: undefined })!),
  "/market/0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
);

const cloudState = parseCloudUserState({
  profile: { ...DEFAULT_PROFILE, displayName: "Cloud Desk" },
  profileUpdatedAt: 300,
  identityUpdatedAt: { toMillis: () => 250 },
  watchlistCount: 1,
  watchlistUpdatedAt: 400
});
assert.equal(cloudState.profile?.displayName, "Cloud Desk");
assert.equal(cloudState.identityUpdatedAt, 250);
assert.equal(resolveProfileSnapshot(
  { profile: { ...DEFAULT_PROFILE, displayName: "Local Desk" }, updatedAt: 200, identityUpdatedAt: 150 },
  cloudState
).profile.displayName, "Cloud Desk");
assert.equal(resolveProfileSnapshot(
  { profile: { ...DEFAULT_PROFILE, displayName: "Newer Local Desk" }, updatedAt: 500, identityUpdatedAt: 450 },
  cloudState
).profile.displayName, "Newer Local Desk");
assert.equal(resolveProfileSnapshot(
  { profile: DEFAULT_PROFILE, updatedAt: 0, identityUpdatedAt: 0 },
  parseCloudUserState(null)
).profile.displayName, DEFAULT_PROFILE.displayName);
assert.equal(profileIdentityEditState(0, 1_000).phase, "setup");
assert.equal(profileIdentityEditState(1_000, 1_000 + PROFILE_IDENTITY_GRACE_MS).phase, "grace");
assert.equal(profileIdentityEditState(1_000, 1_000 + PROFILE_IDENTITY_GRACE_MS + 1).phase, "locked");
assert.equal(profileIdentityEditState(1_000, 1_000 + PROFILE_IDENTITY_COOLDOWN_MS).phase, "unlocked");
assert.equal(normalizeReferralCode("  rmt-abcdefgh  "), "RMT-ABCDEFGH");
assert.equal(normalizeReferralCode("RMT-ABCDI234"), "");
assert.equal(normalizeReferralCode("RMT-TOO-SHORT"), "");
assert.match(generateReferralCode(), REFERRAL_CODE_PATTERN);
assert.equal(referralUrl("RMT-ABCDEFGH"), "https://www.rmtlaunch.fun/r/RMT-ABCDEFGH");
assert.match(
  referralXIntent("RMT-ABCDEFGH"),
  /https:\/\/x\.com\/intent\/post\?.*www\.rmtlaunch\.fun%2Fr%2FRMT-ABCDEFGH/
);

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

const creatorApplication = normalizeCreatorApplication({
  projectName: "  Runner Studio  ",
  summary: "  A community studio building transparent art and music experiences for Robinhood Chain.  ",
  projectType: "music",
  website: "https://runner.example",
  xProfile: "https://x.com/runner",
  tokenAddress: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  requestedModules: ["token", "music", "music", "unsupported"],
  ownershipConfirmed: true,
  termsAccepted: true
});
assert.deepEqual(creatorApplication, {
  projectName: "Runner Studio",
  summary: "A community studio building transparent art and music experiences for Robinhood Chain.",
  projectType: "music",
  website: "https://runner.example/",
  xProfile: "https://x.com/runner",
  tokenAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  requestedModules: ["token", "music"],
  ownershipConfirmed: true,
  termsAccepted: true
});
assert.equal(validateCreatorApplication(creatorApplication), null);
assert.match(validateCreatorApplication({ ...creatorApplication, tokenAddress: "" }) ?? "", /Token module/);

assert.deepEqual(parseProjectAssignment({
  schemaVersion: 1,
  projectSlug: "runner-studio",
  ownerId: "creator-user",
  allowedModules: ["nft", "music"]
})?.allowedModules, ["nft", "music"]);
assert.equal(parseProjectAssignment({
  schemaVersion: 1,
  projectSlug: "runner-studio",
  ownerId: "",
  allowedModules: ["nft"]
}), null);
assert.equal(parseModuleActivationRequest("nft", {
  schemaVersion: 1,
  module: "nft",
  status: "ready",
  reviewNote: "Configuration review completed."
})?.reviewNote, "Configuration review completed.");
assert.equal(parseModuleActivationRequest("nft", {
  schemaVersion: 1,
  module: "music",
  status: "requested"
}), null);

const adminActivationSource = readFileSync(new URL("../app/admin/creator-applications/activation-review-inbox.tsx", import.meta.url), "utf8");
assert.match(adminActivationSource, /requested → reviewing → ready\/declined|Process creator requests/);
assert.match(adminActivationSource, /does not deploy|without deploying contracts/);
assert.match(adminActivationSource, /Mark ready/);
assert.equal(normalizeProjectSlug("  Runner Studio!!!  "), "runner-studio");
assert.equal(cleanProjectMediaUri("ipfs://bafybeigdyrzt/logo.png"), "ipfs://bafybeigdyrzt/logo.png");
assert.equal(cleanProjectMediaUri("javascript:alert(1)"), "");
assert.equal(cleanProjectMediaUri("https://runner.example/logo.svg"), "");
const projectIdentity = normalizeProjectIdentity({
  name: "Runner Studio",
  summary: creatorApplication.summary,
  website: creatorApplication.website,
  xProfile: creatorApplication.xProfile,
  logoUri: "https://runner.example/logo.webp",
  bannerUri: "ipfs://bafybeigdyrzt/banner.png"
});
assert.equal(validateProjectIdentity(projectIdentity), null);
const gamingApplication = normalizeCreatorApplication({
  ...creatorApplication,
  projectType: "gaming",
  requestedModules: ["game"],
  tokenAddress: ""
});
assert.equal(gamingApplication.projectType, "gaming");
assert.deepEqual(gamingApplication.requestedModules, ["game"]);

const publicProject = parsePublicProject({
  schemaVersion: 1,
  slug: "runner-studio",
  name: "Runner Studio",
  summary: creatorApplication.summary,
  projectType: "music",
  website: creatorApplication.website,
  xProfile: creatorApplication.xProfile,
  logoUri: projectIdentity.logoUri,
  bannerUri: projectIdentity.bannerUri,
  tokenAddress: creatorApplication.tokenAddress,
  availableModules: ["token", "music"],
  status: "live"
});
assert.equal(publicProject?.slug, "runner-studio");
assert.deepEqual(publicProject?.availableModules, ["token", "music"]);
assert.equal(publicProject?.logoUri, "https://runner.example/logo.webp");
assert.equal(parsePublicProject({ ...publicProject, status: "pending" }), null);
const gamingProject = parsePublicProject({
  schemaVersion: 1,
  slug: "runner-game",
  name: "Runner Game",
  summary: "A creator-owned game universe with a public development page, playable builds and community updates.",
  projectType: "gaming",
  website: "https://game.runner.example/",
  xProfile: "",
  tokenAddress: "",
  availableModules: ["game"],
  gameUrl: "https://play.runner.example/",
  trailerUrl: "https://video.runner.example/trailer",
  gameStatus: "playable",
  gamePlatforms: ["web", "windows"],
  gameGenre: "adventure",
  gameModes: ["single-player", "co-op"],
  gameReleaseDate: "2026-11-14",
  gameMediaUris: [
    "https://media.runner.example/gameplay.webp",
    "ipfs://bafybeirunnergame/screenshot.png",
    "javascript:alert(1)"
  ],
  status: "live"
});
assert.equal(gamingProject?.gameStatus, "playable");
assert.deepEqual(gamingProject?.gamePlatforms, ["web", "windows"]);
assert.equal(gamingProject?.gameGenre, "adventure");
assert.deepEqual(gamingProject?.gameModes, ["single-player", "co-op"]);
assert.equal(gamingProject?.gameReleaseDate, "2026-11-14");
assert.deepEqual(gamingProject?.gameMediaUris, [
  "https://media.runner.example/gameplay.webp",
  "ipfs://bafybeirunnergame/screenshot.png"
]);
const gameUpdate = normalizeGameUpdate({
  type: "release",
  title: "  Public alpha is live  ",
  body: "  Players can now test cooperative matchmaking and the rebuilt tutorial.  ",
  version: " v0.3.0 ",
  link: "https://runner.example/alpha",
  imageUri: "ipfs://bafybeigameupdate/alpha.webp"
});
assert.equal(gameUpdate.title, "Public alpha is live");
assert.equal(gameUpdate.version, "v0.3.0");
assert.equal(validateGameUpdate(gameUpdate), null);
assert.equal(validateGameUpdate({ ...gameUpdate, link: "javascript:alert(1)" }), "Update link must be a valid HTTPS URL.");
assert.equal(parseGameUpdate("alpha", {
  schemaVersion: 1,
  ...gameUpdate,
  createdAt: { toMillis: () => 1 }
})?.type, "release");

const creatorControlSource = readFileSync(new URL("../app/project-creator-controls.tsx", import.meta.url), "utf8");
const creatorApplicationSource = readFileSync(new URL("../app/creator-application-panel.tsx", import.meta.url), "utf8");
const creatorMediaSource = readFileSync(new URL("../app/creator-media-upload.tsx", import.meta.url), "utf8");
assert.match(creatorApplicationSource, /RMT CREATOR STUDIO/);
assert.match(creatorApplicationSource, /Open Creator Studio/);
assert.match(creatorApplicationSource, /does not deploy a contract, charge a fee or activate a marketplace automatically/);
assert.match(creatorControlSource, /Save public identity/);
assert.match(creatorControlSource, /id="creator-studio"/);
assert.match(creatorControlSource, /RMT CREATOR STUDIO/);
assert.match(creatorControlSource, /label="Project logo"/);
assert.match(creatorControlSource, /label="Project banner"/);
assert.match(creatorControlSource, /Playable game or store link/);
assert.match(creatorControlSource, /Play modes/);
assert.match(creatorControlSource, /Publish development update/);
assert.match(creatorControlSource, /CreatorImageField/);
assert.match(creatorControlSource, /CreatorGalleryField/);
assert.match(creatorMediaSource, /uploads are public and may be permanent/);
assert.equal(validateCreatorImage({ type: "image/png", size: 5_000_000 }), null);
assert.match(validateCreatorImage({ type: "image/gif", size: 1_000 }) ?? "", /JPG, PNG, or WebP/);
assert.match(validateCreatorImage({ type: "image/webp", size: 5_000_001 }) ?? "", /5 MB/);
const approvedProjectSource = readFileSync(new URL("../app/project/[address]/approved-project-page.tsx", import.meta.url), "utf8");
assert.match(approvedProjectSource, /GAME CREATOR SHOWCASE/);
assert.match(approvedProjectSource, /GAMEPLAY GALLERY/);
assert.match(approvedProjectSource, /GameReleaseUpdates/);
assert.match(approvedProjectSource, /ProjectAudienceControls/);
const projectAudienceSource = readFileSync(new URL("../app/project-audience-controls.tsx", import.meta.url), "utf8");
assert.match(projectAudienceSource, /PEOPLE WATCHING/);
assert.match(projectAudienceSource, /Follower identities stay private/);
assert.match(projectAudienceSource, /aria-pressed/);

const referralRouteSource = readFileSync(new URL("../app/r/[code]/route.ts", import.meta.url), "utf8");
const referralCaptureSource = readFileSync(new URL("../app/referral-capture.tsx", import.meta.url), "utf8");
const inviteSource = readFileSync(new URL("../app/invite/[code]/invite-acceptance.tsx", import.meta.url), "utf8");
const invitePageSource = readFileSync(new URL("../app/invite/[code]/page.tsx", import.meta.url), "utf8");
const profileLayoutSource = readFileSync(new URL("../app/profile/layout.tsx", import.meta.url), "utf8");
const providersSource = readFileSync(new URL("../app/providers.tsx", import.meta.url), "utf8");
assert.match(referralRouteSource, /new URL\("\/", request\.nextUrl\.origin\)/);
assert.match(invitePageSource, /redirect\("\/"\)/);
assert.match(profileLayoutSource, /redirect\("\/"\)/);
assert.doesNotMatch(providersSource, /<ReferralCapture|<CommunityLive/);
assert.doesNotMatch(referralCaptureSource, /window\.location\.search|capturePendingReferral/);
assert.match(inviteSource, /Accept &amp; set up my profile/);
assert.match(inviteSource, /Continue without this invite/);
assert.match(inviteSource, /clearPendingReferral/);

console.log("Paused profile source, Firebase protections, and public quarantine smoke tests passed.");
