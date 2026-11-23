import { artworkCID, artworkOrigin, assetPath } from "./token-artwork";

export const rmtImageCID = "bafkreihyj5x6scusvllwd5lf4ayewhcrefkht7srotorcc3uucwn4snx7q";
export const rmtImageURL = artworkOrigin + assetPath(rmtImageCID, "image.webp");
export const originalRmtMetadataCID = "bafkreiazx4gbczh3uskiarktmoahm6mwt5ri243mmz2rfldak25yivjp5y";

export function descriptionMetadata(description: string) {
  if (typeof description !== "string" || !description.trim() || new TextEncoder().encode(description).length > 500 ||
      /[\u0000-\u0009\u000b-\u001f\u007f]/.test(description)) throw new Error("Use 1 to 500 UTF-8 bytes of plain text.");
  const bytes = new TextEncoder().encode(JSON.stringify({name:"RMT", description, image:rmtImageURL}));
  const cid = artworkCID(bytes);
  return {bytes, cid, projectURI:artworkOrigin + assetPath(cid,"metadata.json"), artworkURL:rmtImageURL};
}
