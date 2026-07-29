import type { User } from "firebase/auth";

export const CREATOR_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const CREATOR_IMAGE_MAX_BYTES = 5_000_000;

export function validateCreatorImage(file: Pick<File, "size" | "type">) {
  if (!CREATOR_IMAGE_TYPES.includes(file.type as typeof CREATOR_IMAGE_TYPES[number])) {
    return "Use a JPG, PNG, or WebP image.";
  }
  if (file.size > CREATOR_IMAGE_MAX_BYTES) return "Image must be 5 MB or smaller.";
  return null;
}

export async function uploadCreatorImage(user: User, projectSlug: string, file: File) {
  const validationError = validateCreatorImage(file);
  if (validationError) throw new Error(validationError);
  const token = await user.getIdToken();
  const signResponse = await fetch("/api/media/creator-sign", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ filename: file.name, projectSlug })
  });
  const signResult = await signResponse.json() as { url?: string; error?: string };
  if (!signResponse.ok || !signResult.url) {
    throw new Error(signResult.error || "Could not prepare the creator image upload.");
  }

  const form = new FormData();
  form.append("file", file);
  form.append("network", "public");
  const uploadResponse = await fetch(signResult.url, { method: "POST", body: form });
  const uploadResult = await uploadResponse.json() as { data?: { cid?: unknown }; error?: string };
  const cid = uploadResult.data?.cid;
  if (!uploadResponse.ok || typeof cid !== "string" || !/^[a-zA-Z0-9]+$/.test(cid)) {
    throw new Error(uploadResult.error || "Creator image upload failed.");
  }
  return `ipfs://${cid}`;
}
