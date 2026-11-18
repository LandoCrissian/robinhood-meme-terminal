import { getAddress, type Address, type Hex } from "viem";

export const projectTreasuryDraftKey = "rmt:project-treasury:draft:v1";
export type ProjectTreasuryMode = "none" | "existing" | "contract";
export type ProjectTreasuryDraft = {
  schemaVersion: 1; mode: ProjectTreasuryMode; projectKind: "standalone" | "nft-community";
  controller: string; controllerKind: "eoa" | "safe-1.4.1"; intentId: string;
  sharePercent: string; nftCollection: string;
};
export const emptyProjectTreasuryDraft: ProjectTreasuryDraft = {
  schemaVersion: 1, mode: "none", projectKind: "standalone", controller: "", controllerKind: "eoa",
  intentId: "", sharePercent: "0", nftCollection: "",
};
const address = (value: string) => /^0x[0-9a-f]{40}$/i.test(value) && BigInt(value) > 0xffffn;
const intent = (value: string) => /^0x[0-9a-f]{64}$/i.test(value) && BigInt(value) !== 0n;
/** A 0% contract treasury intentionally becomes zero-address core fee fields.
 * Its separately verified creator binding must survive that normalization. */
export function projectTreasuryCreatorMatches(account: string, intentId?: string, creator?: string): boolean {
  return intentId === undefined ? creator === undefined : intent(intentId) && !!creator && address(creator)
    && address(account) && creator.toLowerCase() === account.toLowerCase();
}
export function newProjectTreasuryIntent(random: Pick<Crypto, "getRandomValues"> = crypto): Hex {
  const bytes = random.getRandomValues(new Uint8Array(32));
  if (bytes.every(byte => byte === 0)) throw Error("Secure project intent unavailable");
  return ("0x" + Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("")) as Hex;
}
export function readProjectTreasuryDraft(value: unknown): ProjectTreasuryDraft | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const r = value as Record<string, unknown>, keys = Object.keys(emptyProjectTreasuryDraft);
  if (Object.keys(r).length !== keys.length || !keys.every(key => Object.hasOwn(r, key)) || r.schemaVersion !== 1
    || !["none", "existing", "contract"].includes(String(r.mode)) || !["standalone", "nft-community"].includes(String(r.projectKind))
    || !["eoa", "safe-1.4.1"].includes(String(r.controllerKind))
    || !["controller", "intentId", "sharePercent", "nftCollection"].every(key => typeof r[key] === "string")
    || String(r.controller).length > 42 || String(r.intentId).length > 66 || String(r.sharePercent).length > 6 || String(r.nftCollection).length > 42) return;
  // Restore editable errors honestly. Validation happens again before every
  // review; storing an address never verifies deployment or wallet authority.
  return { ...r } as ProjectTreasuryDraft;
}
export type ProjectTreasuryDraftErrors = Partial<Record<"controller" | "intentId" | "sharePercent" | "nftCollection", string>>;
export type ReviewedProjectTreasuryDraft = {
  mode: ProjectTreasuryMode; projectKind: "standalone" | "nft-community"; controller: Address | null;
  controllerKind: "eoa" | "safe-1.4.1"; intentId: Hex | null; projectShareBps: number;
  treasuryShareBps: number; nftCollection: Address | null; purchasesEnabled: false;
};
export function validateProjectTreasuryDraft(draft: ProjectTreasuryDraft): { ok: true; draft: ReviewedProjectTreasuryDraft } | { ok: false; errors: ProjectTreasuryDraftErrors } {
  const errors: ProjectTreasuryDraftErrors = {};
  if (!readProjectTreasuryDraft(draft)) return { ok: false, errors: { intentId: "The saved treasury settings are invalid. Restore or clear them before continuing." } };
  const controller = draft.controller.trim(), collection = draft.nftCollection.trim(), share = draft.sharePercent.trim();
  const parsed = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(share);
  const projectShareBps = parsed ? Number(parsed[1]) * 100 + Number((parsed[2] ?? "").padEnd(2, "0")) : -1;
  if (draft.mode === "contract") {
    if (!address(controller)) errors.controller = "Enter the public address of the wallet or supported Safe that will control this treasury.";
    if (!intent(draft.intentId)) errors.intentId = "A fresh, securely generated project intent is required.";
    if (projectShareBps < 0 || projectShareBps > 10_000) errors.sharePercent = "Use 0–100% of project fees, with up to two decimal places.";
    else if (projectShareBps > 0 && Math.floor(projectShareBps * 9000 / 10_000) === 0) errors.sharePercent = "Use at least 0.02% for a nonzero contract allocation.";
  }
  if (draft.projectKind === "nft-community" && collection && !address(collection)) errors.nftCollection = "Use a nonzero collection address. This optional metadata does not change royalty settings.";
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, draft: {
    mode: draft.mode, projectKind: draft.projectKind,
    controller: draft.mode === "contract" ? getAddress(controller.toLowerCase()) : null,
    controllerKind: draft.controllerKind, intentId: draft.mode === "contract" ? draft.intentId.toLowerCase() as Hex : null,
    projectShareBps: draft.mode === "contract" ? projectShareBps : 0,
    treasuryShareBps: draft.mode === "contract" ? Math.floor(projectShareBps * 9000 / 10_000) : 0,
    nftCollection: draft.projectKind === "nft-community" && collection ? getAddress(collection.toLowerCase()) : null,
    purchasesEnabled: false,
  } };
}
