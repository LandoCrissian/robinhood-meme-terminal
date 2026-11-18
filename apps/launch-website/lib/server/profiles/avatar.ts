import type { Firestore } from "firebase-admin/firestore";
import { createHash } from "node:crypto";
import { assertWriteSession, profileCollections as c, randomToken, type ProfileAccount, type WriteAuthorization } from "./store";
import { ProfileError } from "./config";

export const maximumAvatarUploadBytes = 2 * 1024 * 1024;
export const maximumStoredAvatarBytes = 64 * 1024;
export async function sanitizeAvatar(bytes: Uint8Array, contentType: string) {
  if (bytes.byteLength === 0 || bytes.byteLength > maximumAvatarUploadBytes) throw new ProfileError(413, "avatar_too_large", "Use an image smaller than 2 MiB.");
  const input = Buffer.from(bytes);
  const format = input.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? "png"
    : input.subarray(0, 3).equals(Buffer.from([255, 216, 255])) ? "jpeg"
    : input.subarray(0, 4).toString() === "RIFF" && input.subarray(8, 12).toString() === "WEBP" ? "webp" : null;
  if (!format || contentType !== "image/" + format) throw new ProfileError(400, "invalid_avatar", "Choose a genuine PNG, JPEG or WebP image.");
  try {
    const { default: sharp } = await import("sharp");
    const image = sharp(input, { limitInputPixels: 4_194_304, failOn: "error", animated: false });
    const metadata = await image.metadata();
    if (metadata.format !== format || !metadata.width || !metadata.height || (metadata.pages ?? 1) !== 1) throw new Error("Unsupported raster");
    const result = await image.rotate().resize(256, 256, { fit: "inside", withoutEnlargement: true }).webp({ quality: 80 }).toBuffer({ resolveWithObject: true });
    if (result.data.byteLength > maximumStoredAvatarBytes) throw new Error("Sanitized image exceeds bound");
    return { bytes: result.data, mime: "image/webp" as const, width: result.info.width, height: result.info.height,
      sha256: createHash("sha256").update(result.data).digest("hex") };
  } catch { throw new ProfileError(400, "invalid_avatar", "This image could not be safely decoded. Use a small, still PNG, JPEG or WebP image."); }
}
export async function saveAvatar(db: Firestore, account: ProfileAccount, image: Awaited<ReturnType<typeof sanitizeAvatar>>, guard: WriteAuthorization) {
  const id = randomToken().slice(0, 32);
  const url = "/api/account/avatar/" + account.walletAddress + "?v=" + image.sha256;
  await db.runTransaction(async tx => {
    const accountRef = db.collection(c.accounts).doc(account.uid);
    const publicRef = db.collection(c.public).doc(account.walletAddress.toLowerCase());
    const [internal, visible] = await tx.getAll(accountRef, publicRef);
    if (internal.data()?.authEpoch !== account.authEpoch || !visible.exists) throw new ProfileError(401, "profile_session_expired", "Sign in again.");
    await assertWriteSession(tx, db, account, guard);
    const oldId = internal.data()?.avatarId;
    if (oldId !== undefined && (typeof oldId !== "string" || !/^[a-f0-9]{32}$/.test(oldId))) throw new Error("Invalid stored avatar identity");
    const oldRef = oldId ? db.collection(c.avatars).doc(oldId) : null;
    const old = oldRef ? await tx.get(oldRef) : null;
    if (old?.exists && old.data()?.uid !== account.uid) throw new Error("Avatar ownership mismatch");
    tx.create(db.collection(c.avatars).doc(id), { ...image, uid: account.uid, walletAddress: account.walletAddress, createdAt: new Date().toISOString() });
    tx.set(accountRef, { avatarId: id }, { merge: true });
    tx.update(publicRef, { avatarUrl: url, updatedAt: new Date().toISOString() });
    if (oldRef) tx.delete(oldRef);
  });
  return url;
}
export async function readAvatar(db: Firestore, address: string, version: string | null) {
  return db.runTransaction(async tx => {
    const visible = (await tx.get(db.collection(c.public).doc(address.toLowerCase()))).data();
    const binding = (await tx.get(db.collection(c.wallets).doc("4663_" + address.toLowerCase()))).data();
    if (!visible?.avatarUrl || !binding?.uid) return null;
    const account = (await tx.get(db.collection(c.accounts).doc(binding.uid))).data();
    if (!account?.avatarId || account.walletAddress !== address || !/^[a-f0-9]{32}$/.test(account.avatarId)) return null;
    const image = (await tx.get(db.collection(c.avatars).doc(account.avatarId))).data();
    if (!image || image.uid !== binding.uid || image.walletAddress !== address || image.mime !== "image/webp" || !Buffer.isBuffer(image.bytes)
        || image.bytes.length > maximumStoredAvatarBytes || !/^[a-f0-9]{64}$/.test(image.sha256) || image.width > 256 || image.height > 256
        || createHash("sha256").update(image.bytes).digest("hex") !== image.sha256
        || visible.avatarUrl !== "/api/account/avatar/" + address + "?v=" + image.sha256 || (version && version !== image.sha256)) return null;
    return { bytes: image.bytes as Buffer, sha256: image.sha256 as string };
  });
}
