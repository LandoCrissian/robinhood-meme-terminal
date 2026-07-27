import { isAddress } from "viem";

export const CREATOR_APPLICATION_SCHEMA_VERSION = 1 as const;
export const PROJECT_RECORD_SCHEMA_VERSION = 1 as const;
export const RMT_ADMIN_EMAIL = "launchrmt@gmail.com";

export const PROJECT_TYPES = ["token", "art", "music", "community", "other"] as const;
export const PROJECT_MODULES = ["token", "nft", "marketplace", "music"] as const;

export type ProjectType = typeof PROJECT_TYPES[number];
export type RequestedProjectModule = typeof PROJECT_MODULES[number];
export type CreatorApplicationStatus = "pending" | "needs_changes" | "approved" | "rejected";

export type CreatorApplicationDraft = {
  projectName: string;
  summary: string;
  projectType: ProjectType;
  website: string;
  xProfile: string;
  tokenAddress: string;
  requestedModules: RequestedProjectModule[];
  ownershipConfirmed: boolean;
  termsAccepted: boolean;
};

export type CreatorApplication = CreatorApplicationDraft & {
  schemaVersion: typeof CREATOR_APPLICATION_SCHEMA_VERSION;
  contactEmail: string;
  status: CreatorApplicationStatus;
  submittedAt?: unknown;
  updatedAt?: unknown;
  reviewedAt?: unknown;
  reviewNote?: string;
  projectSlug?: string;
};

export type PublicProjectRecord = {
  schemaVersion: typeof PROJECT_RECORD_SCHEMA_VERSION;
  slug: string;
  name: string;
  summary: string;
  projectType: ProjectType;
  website: string;
  xProfile: string;
  logoUri: string;
  bannerUri: string;
  tokenAddress: string;
  availableModules: RequestedProjectModule[];
  status: "live";
  publishedAt?: unknown;
  updatedAt?: unknown;
};

export type ProjectIdentityDraft = Pick<
  PublicProjectRecord,
  "name" | "summary" | "website" | "xProfile" | "logoUri" | "bannerUri"
>;

export const EMPTY_CREATOR_APPLICATION: CreatorApplicationDraft = {
  projectName: "",
  summary: "",
  projectType: "community",
  website: "",
  xProfile: "",
  tokenAddress: "",
  requestedModules: ["token"],
  ownershipConfirmed: false,
  termsAccepted: false
};

function cleanText(value: unknown, maximum: number) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function cleanUrl(value: unknown) {
  const candidate = cleanText(value, 256);
  if (!candidate) return "";
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" ? url.toString().slice(0, 256) : "";
  } catch {
    return "";
  }
}

export function cleanProjectMediaUri(value: unknown) {
  const candidate = cleanText(value, 512);
  if (!candidate) return "";
  if (/^ipfs:\/\/[a-zA-Z0-9]+(?:\/[a-zA-Z0-9._~-]+)*$/.test(candidate)) return candidate;
  try {
    const url = new URL(candidate);
    if (
      url.protocol !== "https:"
      || url.username
      || url.password
      || url.pathname.toLowerCase().endsWith(".svg")
    ) return "";
    return url.toString().slice(0, 512);
  } catch {
    return "";
  }
}

export function normalizeProjectIdentity(value: unknown): ProjectIdentityDraft {
  const draft = value && typeof value === "object" ? value as Partial<ProjectIdentityDraft> : {};
  return {
    name: cleanText(draft.name, 80),
    summary: cleanText(draft.summary, 600),
    website: cleanUrl(draft.website),
    xProfile: cleanUrl(draft.xProfile),
    logoUri: cleanProjectMediaUri(draft.logoUri),
    bannerUri: cleanProjectMediaUri(draft.bannerUri)
  };
}

export function validateProjectIdentity(value: ProjectIdentityDraft) {
  const draft = normalizeProjectIdentity(value);
  if (draft.name.length < 2) return "Project name must be at least 2 characters.";
  if (draft.summary.length < 40) return "Project description must be at least 40 characters.";
  if (value.website.trim() && !draft.website) return "Website must be a valid HTTPS URL.";
  if (value.xProfile.trim() && !draft.xProfile) return "X profile must be a valid HTTPS URL.";
  if (value.logoUri.trim() && !draft.logoUri) return "Logo must be a valid HTTPS or IPFS image URL. SVG files are not accepted.";
  if (value.bannerUri.trim() && !draft.bannerUri) return "Banner must be a valid HTTPS or IPFS image URL. SVG files are not accepted.";
  return null;
}

export function normalizeProjectSlug(value: unknown) {
  return cleanText(value, 48)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

export function normalizeCreatorApplication(value: unknown): CreatorApplicationDraft {
  const draft = value && typeof value === "object" ? value as Partial<CreatorApplicationDraft> : {};
  const projectType = PROJECT_TYPES.includes(draft.projectType as ProjectType)
    ? draft.projectType as ProjectType
    : "community";
  const requestedModules = Array.from(new Set(
    Array.isArray(draft.requestedModules)
      ? draft.requestedModules.filter((module): module is RequestedProjectModule => (
          PROJECT_MODULES.includes(module as RequestedProjectModule)
        ))
      : []
  )).slice(0, PROJECT_MODULES.length);

  return {
    projectName: cleanText(draft.projectName, 80),
    summary: cleanText(draft.summary, 600),
    projectType,
    website: cleanUrl(draft.website),
    xProfile: cleanUrl(draft.xProfile),
    tokenAddress: typeof draft.tokenAddress === "string" && isAddress(draft.tokenAddress.trim(), { strict: false })
      ? draft.tokenAddress.trim().toLowerCase()
      : "",
    requestedModules,
    ownershipConfirmed: draft.ownershipConfirmed === true,
    termsAccepted: draft.termsAccepted === true
  };
}

export function validateCreatorApplication(value: CreatorApplicationDraft) {
  const draft = normalizeCreatorApplication(value);
  if (draft.projectName.length < 2) return "Project name must be at least 2 characters.";
  if (draft.summary.length < 40) return "Tell us more about the project in at least 40 characters.";
  if (value.website.trim() && !draft.website) return "Website must be a valid HTTPS URL.";
  if (value.xProfile.trim() && !draft.xProfile) return "X profile must be a valid HTTPS URL.";
  if (value.tokenAddress.trim() && !draft.tokenAddress) return "Token contract must be a valid EVM address.";
  if (draft.requestedModules.length === 0) return "Choose at least one project module.";
  if (draft.requestedModules.includes("token") && !draft.tokenAddress) {
    return "A token contract is required when requesting the Token module.";
  }
  if (!draft.ownershipConfirmed) return "Confirm that you are authorized to represent this project.";
  if (!draft.termsAccepted) return "Accept the review and publication terms.";
  return null;
}

export function parseCreatorApplication(value: unknown): CreatorApplication | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Partial<CreatorApplication>;
  const draft = normalizeCreatorApplication(data);
  if (
    data.schemaVersion !== CREATOR_APPLICATION_SCHEMA_VERSION
    || typeof data.contactEmail !== "string"
    || !["pending", "needs_changes", "approved", "rejected"].includes(data.status ?? "")
    || validateCreatorApplication(draft)
  ) return null;
  return {
    ...draft,
    schemaVersion: CREATOR_APPLICATION_SCHEMA_VERSION,
    contactEmail: data.contactEmail.trim().toLowerCase(),
    status: data.status as CreatorApplicationStatus,
    submittedAt: data.submittedAt,
    updatedAt: data.updatedAt,
    reviewedAt: data.reviewedAt,
    reviewNote: cleanText(data.reviewNote, 600),
    projectSlug: normalizeProjectSlug(data.projectSlug)
  };
}

export function parsePublicProject(value: unknown): PublicProjectRecord | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Partial<PublicProjectRecord>;
  const slug = normalizeProjectSlug(data.slug);
  const projectType = PROJECT_TYPES.includes(data.projectType as ProjectType)
    ? data.projectType as ProjectType
    : null;
  const availableModules = Array.from(new Set(
    Array.isArray(data.availableModules)
      ? data.availableModules.filter((module): module is RequestedProjectModule => (
          PROJECT_MODULES.includes(module as RequestedProjectModule)
        ))
      : []
  ));
  const tokenAddress = typeof data.tokenAddress === "string" && isAddress(data.tokenAddress, { strict: false })
    ? data.tokenAddress.toLowerCase()
    : "";
  if (
    data.schemaVersion !== PROJECT_RECORD_SCHEMA_VERSION
    || data.status !== "live"
    || !slug
    || !projectType
    || typeof data.name !== "string"
    || data.name.trim().length < 2
    || typeof data.summary !== "string"
    || data.summary.trim().length < 40
    || availableModules.length === 0
    || (availableModules.includes("token") && !tokenAddress)
  ) return null;
  return {
    schemaVersion: PROJECT_RECORD_SCHEMA_VERSION,
    slug,
    name: data.name.trim().slice(0, 80),
    summary: data.summary.trim().slice(0, 600),
    projectType,
    website: cleanUrl(data.website),
    xProfile: cleanUrl(data.xProfile),
    logoUri: cleanProjectMediaUri(data.logoUri),
    bannerUri: cleanProjectMediaUri(data.bannerUri),
    tokenAddress,
    availableModules,
    status: "live",
    publishedAt: data.publishedAt,
    updatedAt: data.updatedAt
  };
}
