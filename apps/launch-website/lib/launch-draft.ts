import { isLaunchAddress } from "./launch-data";
import { launchTerms } from "./launch-terms";

export const creationReviewPath = "/api/launchpad/creation-review";
export const launchDraftLimits = { name: 48, symbol: 12, description: 500, projectURI: 196, artworkURL: 256 } as const;

export const emptyLaunchDraft = {
  name: "", symbol: "", description: "", projectURI: "", artworkURL: "",
  supplyPreset: "0", treasury: "", treasuryShare: "",
};

export type LaunchDraft = typeof emptyLaunchDraft;
export type LaunchReviewRequest = Omit<LaunchDraft, "description" | "artworkURL">;
export type LaunchDraftField = keyof LaunchDraft;
export type LaunchDraftErrors = Partial<Record<LaunchDraftField, string>>;
export type ReviewedLaunchDraft = {
  name: string;
  symbol: string;
  description: string;
  projectURI: string;
  artworkURL: string;
  supply: number;
  supplyPreset: number;
  treasury: string;
  treasuryShareBps: number;
};
export type ReviewedLaunchTerms = Omit<ReviewedLaunchDraft, "description" | "artworkURL">;

const reviewFields = ["name", "symbol", "projectURI", "supplyPreset", "treasury", "treasuryShare"] as const;
const fields = [...reviewFields, "description", "artworkURL"] as const;
const encoder = new TextEncoder();
const unsafeText = /[\p{Cc}\p{Cf}\p{Cs}]/u;

function hasStringFields(input: unknown, keys: readonly string[]) {
  return !!input && typeof input === "object" && !Array.isArray(input)
    && Object.keys(input).length === keys.length
    && keys.every((key) => Object.hasOwn(input, key) && typeof (input as Record<string, unknown>)[key] === "string");
}

export function isLaunchDraft(input: unknown): input is LaunchDraft {
  return hasStringFields(input, fields);
}

export function isLaunchReviewRequest(input: unknown): input is LaunchReviewRequest {
  return hasStringFields(input, reviewFields);
}

export function reviewableFields(draft: ReviewedLaunchDraft): ReviewedLaunchTerms {
  const { name, symbol, projectURI, supply, supplyPreset, treasury, treasuryShareBps } = draft;
  return { name, symbol, projectURI, supply, supplyPreset, treasury, treasuryShareBps };
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

export function validateLaunchDraft(draft: LaunchDraft):
  { ok: true; draft: ReviewedLaunchDraft } | { ok: false; errors: LaunchDraftErrors } {
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
  const supplyPreset = /^[0-2]$/.test(draft.supplyPreset) ? Number(draft.supplyPreset) : -1;
  const supply = launchTerms.supplyPresets[supplyPreset];
  if (supply === undefined) errors.supplyPreset = "Choose one of the fixed supply presets.";

  const treasury = draft.treasury.trim().toLowerCase();
  const share = draft.treasuryShare.trim();
  const amount = /^(\d{1,2})(?:\.(\d{1,2}))?$/.exec(share);
  const treasuryShareBps = amount ? Number(amount[1]) * 100 + Number((amount[2] ?? "").padEnd(2, "0")) : 0;
  if (share && (!amount || treasuryShareBps > launchTerms.projectFeeSharePercent * 100)) {
    errors.treasuryShare = "Use a percentage up to 90% with at most two decimal places.";
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
    supply, supplyPreset, treasury, treasuryShareBps,
  } };
}
