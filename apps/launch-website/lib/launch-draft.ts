import { isLaunchAddress } from "./launch-data";
import { launchTerms, launchTokenSupply } from "./launch-terms";

export const creationReviewPath = "/api/launchpad/creation-review";
export const launchDraftLimits = { name: 48, symbol: 12, description: 500, projectURI: 196, artworkURL: 256 } as const;

export const emptyLaunchDraft = {
  name: "", symbol: "", description: "", projectURI: "", artworkURL: "",
  treasury: "", treasuryShare: "",
};

export type LaunchDraft = typeof emptyLaunchDraft;
export const projectTreasuryShareUnit = "project-percent" as const;
export const projectFeeShareBps = launchTerms.projectFeeSharePercent * 100;
const fullFeeShareBps = 10_000;

export type LaunchReviewRequest = Omit<LaunchDraft, "description" | "artworkURL"> & {
  treasuryShareUnit?: typeof projectTreasuryShareUnit;
};
type TreasuryShareUnit = "project-percent" | "total-fee-percent";
export type LaunchDraftField = keyof LaunchDraft;
export type LaunchDraftErrors = Partial<Record<LaunchDraftField, string>>;
export type ReviewedLaunchDraft = {
  name: string;
  symbol: string;
  description: string;
  projectURI: string;
  artworkURL: string;
  supply: number;
  treasury: string;
  treasuryShareBps: number;
};
export type ReviewedLaunchTerms = Omit<ReviewedLaunchDraft, "description" | "artworkURL">;
type DraftResult = { ok: true; draft: ReviewedLaunchDraft } | { ok: false; errors: LaunchDraftErrors };

const reviewFields = ["name", "symbol", "projectURI", "treasury", "treasuryShare"] as const;
const fields = [...reviewFields, "description", "artworkURL"] as const;
const encoder = new TextEncoder();
const unsafeText = /[\p{Cc}\p{Cf}\p{Cs}]/u;

function hasStringFields(input: unknown, keys: readonly string[]) {
  return !!input && typeof input === "object" && !Array.isArray(input)
    && Object.keys(input).length === keys.length
    && keys.every((key) => Object.hasOwn(input, key) && typeof (input as Record<string, unknown>)[key] === "string");
}

export function readStoredLaunchDraft(input: unknown): LaunchDraft | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return;
  const record = input as Record<string, unknown>;
  const restored = { ...emptyLaunchDraft };
  // Only restore known editable fields. Earlier drafts may contain a retired option.
  for (const key of fields) {
    const value = record[key];
    if (!Object.hasOwn(record, key) || typeof value !== "string" || value.length > 500) return;
    restored[key] = value;
  }
  return restored;
}

export function isLaunchReviewRequest(input: unknown): input is LaunchReviewRequest {
  return hasStringFields(input, reviewFields) || (hasStringFields(input, [...reviewFields, "treasuryShareUnit"])
    && (input as LaunchReviewRequest).treasuryShareUnit === projectTreasuryShareUnit);
}

export function reviewableFields(draft: ReviewedLaunchDraft): ReviewedLaunchTerms {
  const { name, symbol, projectURI, supply, treasury, treasuryShareBps } = draft;
  return { name, symbol, projectURI, supply, treasury, treasuryShareBps };
}

function httpsURL(input: string, maxBytes: number) {
  if (!/^https:\/\//i.test(input) || unsafeText.test(input) || /[\s\\]/u.test(input)) return null;
  try {
    const url = new URL(input);
    if (url.protocol === "https:" && !url.username && !url.password && encoder.encode(url.href).length <= maxBytes) {
      return url.href;
    }
  } catch { /* A malformed URL is a field error. */ }
  return null;
}

function percentageBps(value: string) {
  const amount = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(value);
  return amount ? Number(amount[1]) * 100 + Number((amount[2] ?? "").padEnd(2, "0")) : null;
}

export function totalTreasuryFeePercent(treasuryShareBps: number) {
  return (treasuryShareBps / 100).toFixed(2);
}

const projectPercentFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 });

export function treasuryProjectPercent(treasuryShareBps: number) {
  const percent = projectPercentFormat.format(treasuryShareBps * 100 / projectFeeShareBps);
  const approximate = treasuryShareBps * 1_000_000 % projectFeeShareBps !== 0;
  return (approximate ? "≈" : "") + percent + "%";
}

export function restoreLegacyLaunchDraft(draft: LaunchDraft): LaunchDraft {
  const saved = draft.treasuryShare.trim();
  if (!saved) return draft;
  const previous = /^\d{1,2}(?:\.\d{1,2})?$/.test(saved) ? percentageBps(saved) : null;
  // The first two-decimal project percentage that floors to the original contract value.
  const share = previous !== null && previous <= projectFeeShareBps
    ? totalTreasuryFeePercent(Math.ceil(previous * fullFeeShareBps / projectFeeShareBps))
    : "";
  return { ...draft, treasuryShare: share };
}

export function validateLaunchDraft(draft: LaunchDraft, unit: TreasuryShareUnit = projectTreasuryShareUnit): DraftResult {
  const errors: LaunchDraftErrors = {};
  const name = draft.name.trim();
  const symbol = draft.symbol.trim();
  const description = draft.description.replaceAll("\r\n", "\n").trim();
  if (!name || encoder.encode(name).length > launchDraftLimits.name || unsafeText.test(name)) {
    errors.name = "Enter a name up to 48 UTF-8 bytes without control characters.";
  }
  if (!/^[a-z0-9]{1,12}$/i.test(symbol)) errors.symbol = "Use 1 to 12 ASCII letters or digits.";
  if (encoder.encode(description).length > launchDraftLimits.description || unsafeText.test(description.replaceAll("\n", ""))) {
    errors.description = "Use up to 500 UTF-8 bytes of plain text.";
  }
  const projectInput = draft.projectURI.trim();
  const artworkInput = draft.artworkURL.trim();
  const projectURI = projectInput ? httpsURL(projectInput, launchDraftLimits.projectURI) : "";
  const artworkURL = artworkInput ? httpsURL(artworkInput, launchDraftLimits.artworkURL) : "";
  if (projectURI === null) errors.projectURI = "Use an HTTPS URL up to 196 bytes without credentials.";
  if (artworkURL === null) errors.artworkURL = "Use an HTTPS URL up to 256 bytes without credentials.";

  const treasury = draft.treasury.trim().toLowerCase();
  const share = draft.treasuryShare.trim();
  const enteredBps = percentageBps(share);
  const maxShare = unit === projectTreasuryShareUnit ? fullFeeShareBps : projectFeeShareBps;
  const treasuryShareBps = enteredBps === null ? 0 : unit === projectTreasuryShareUnit
    ? Math.floor(enteredBps * projectFeeShareBps / fullFeeShareBps)
    : enteredBps;
  if (share && (enteredBps === null || enteredBps > maxShare || (unit === "total-fee-percent" && /^\d{3}/.test(share)))) {
    errors.treasuryShare = `Use a percentage up to ${maxShare / 100}% with at most two decimal places.`;
  } else if (enteredBps && treasuryShareBps === 0) {
    errors.treasuryShare = "Use at least 0.02% of project fees for a nonzero on-chain allocation.";
  }
  if ((treasury && (!isLaunchAddress(treasury) || /^0x0{40}$/.test(treasury))) || (!treasury && treasuryShareBps > 0)) {
    errors.treasury = "Enter a nonzero Ethereum address for the project treasury.";
  }
  if (treasury && treasuryShareBps === 0 && !errors.treasuryShare) {
    errors.treasuryShare = "Enter a fee share above 0%, or leave both treasury fields empty.";
  }

  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, draft: {
    name, symbol: symbol.toUpperCase(), description, projectURI: projectURI ?? "", artworkURL: artworkURL ?? "",
    supply: launchTokenSupply, treasury, treasuryShareBps,
  } };
}
