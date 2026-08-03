import { keccak256, toHex, type Hex } from "viem";

export const CREATOR_MEDIA_SUPERSESSION_SCHEMA_VERSION = 1 as const;

export type CreatorMediaSupersession = {
  schemaVersion: typeof CREATOR_MEDIA_SUPERSESSION_SCHEMA_VERSION;
  supersessionId: string;
  supersessionHash: Hex;
  projectSlug: string;
  assetId: string;
  receiptId: string;
  replacedDraftRevisionHash: Hex;
  replacementDraftRevisionHash: Hex;
  reasonCode: "creator_correction";
  note: string;
  recordedBy: string;
  contractExecution: "disabled";
  createdAt?: unknown;
};

type SupersessionPayload = Omit<
  CreatorMediaSupersession,
  "supersessionId" | "supersessionHash" | "createdAt"
>;

export function createCreatorMediaSupersession(input: {
  projectSlug: string;
  assetId: string;
  receiptId: string;
  replacedDraftRevisionHash: Hex;
  replacementDraftRevisionHash: Hex;
  recordedBy: string;
}): CreatorMediaSupersession {
  if (
    !/^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/.test(input.projectSlug)
    || !/^[A-Za-z0-9]{20}$/.test(input.assetId)
    || !/^[0-9a-f]{64}$/.test(input.receiptId)
    || !/^0x[0-9a-f]{64}$/.test(input.replacedDraftRevisionHash)
    || !/^0x[0-9a-f]{64}$/.test(input.replacementDraftRevisionHash)
    || input.replacedDraftRevisionHash === input.replacementDraftRevisionHash
    || input.recordedBy.length < 1
    || input.recordedBy.length > 128
  ) throw new Error("The metadata supersession is invalid.");
  const payload: SupersessionPayload = {
    schemaVersion: CREATOR_MEDIA_SUPERSESSION_SCHEMA_VERSION,
    projectSlug: input.projectSlug,
    assetId: input.assetId,
    receiptId: input.receiptId,
    replacedDraftRevisionHash: input.replacedDraftRevisionHash,
    replacementDraftRevisionHash: input.replacementDraftRevisionHash,
    reasonCode: "creator_correction",
    note: "A newer saved creator-rights revision replaces this metadata receipt.",
    recordedBy: input.recordedBy,
    contractExecution: "disabled"
  };
  return {
    ...payload,
    supersessionId: input.receiptId,
    supersessionHash: keccak256(toHex(JSON.stringify(payload)))
  };
}

export function parseCreatorMediaSupersession(
  supersessionId: string,
  value: unknown
): CreatorMediaSupersession | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as CreatorMediaSupersession;
  try {
    const parsed = createCreatorMediaSupersession(candidate);
    if (
      supersessionId !== parsed.supersessionId
      || candidate.supersessionId !== parsed.supersessionId
      || candidate.supersessionHash !== parsed.supersessionHash
      || candidate.note !== parsed.note
      || candidate.reasonCode !== "creator_correction"
      || candidate.contractExecution !== "disabled"
    ) return null;
    return {
      ...parsed,
      ...(candidate.createdAt === undefined ? {} : { createdAt: candidate.createdAt })
    };
  } catch {
    return null;
  }
}
