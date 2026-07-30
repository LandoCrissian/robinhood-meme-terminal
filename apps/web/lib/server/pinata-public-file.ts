import { creatorMetadataBytes, isPublicIpfsCid } from "../creator-media-receipt";
import type { CreatorMediaManifest } from "../creator-media-manifest";

type PinataFile = {
  id?: unknown;
  cid?: unknown;
  size?: unknown;
  network?: unknown;
};

function pinataJwt() {
  const jwt = process.env.PINATA_JWT?.trim() ?? "";
  if (jwt.length < 40) throw new Error("storage_unconfigured");
  return jwt;
}

async function readJson(response: Response) {
  return response.json().catch(() => null) as Promise<unknown>;
}

export async function pinAndVerifyCreatorMetadata(manifest: CreatorMediaManifest) {
  const bytes = creatorMetadataBytes(manifest);
  const file = new File(
    [bytes],
    `${manifest.projectSlug}-${manifest.assetId}-${manifest.manifestHash.slice(2, 10)}.json`,
    { type: "application/json" }
  );
  const form = new FormData();
  form.set("network", "public");
  form.set("file", file);
  form.set("name", file.name);
  form.set("keyvalues", JSON.stringify({
    rmt_schema: "creator_metadata_v1",
    project_slug: manifest.projectSlug,
    asset_id: manifest.assetId,
    revision: manifest.draftRevisionHash,
    manifest: manifest.manifestHash
  }));
  const jwt = pinataJwt();
  const uploadResponse = await fetch("https://uploads.pinata.cloud/v3/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}` },
    body: form,
    signal: AbortSignal.timeout(20_000)
  });
  const uploadBody = await readJson(uploadResponse) as { data?: PinataFile } | null;
  const uploaded = uploadBody?.data;
  if (
    !uploadResponse.ok
    || typeof uploaded?.id !== "string"
    || !isPublicIpfsCid(uploaded.cid)
    || uploaded.size !== file.size
  ) throw new Error("storage_upload_failed");

  const query = new URL("https://api.pinata.cloud/v3/files/public");
  query.searchParams.set("cid", uploaded.cid);
  query.searchParams.set("limit", "10");
  const verifyResponse = await fetch(query, {
    headers: { Authorization: `Bearer ${jwt}` },
    cache: "no-store",
    signal: AbortSignal.timeout(12_000)
  });
  const verifyBody = await readJson(verifyResponse) as {
    data?: { files?: PinataFile[] };
  } | null;
  const verified = verifyBody?.data?.files?.find((candidate) => (
    candidate.id === uploaded.id
    && candidate.cid === uploaded.cid
    && candidate.size === file.size
  ));
  if (!verifyResponse.ok || !verified) throw new Error("storage_verification_failed");
  return {
    metadataCid: uploaded.cid,
    providerFileId: uploaded.id,
    storedSize: file.size
  };
}
