"use client";

import type { User } from "firebase/auth";
import { useId, useState, type ChangeEvent } from "react";
import { ipfsToHttp } from "../lib/token-metadata";
import {
  CREATOR_IMAGE_MAX_BYTES,
  CREATOR_IMAGE_TYPES,
  uploadCreatorImage,
  validateCreatorImage
} from "../lib/creator-media";

type CreatorImageFieldProps = {
  label: string;
  description: string;
  projectSlug: string;
  user: User;
  value: string;
  onChange: (value: string) => void;
  shape?: "square" | "banner" | "landscape";
  optional?: boolean;
};

export function CreatorImageField({
  label,
  description,
  projectSlug,
  user,
  value,
  onChange,
  shape = "landscape",
  optional = false
}: CreatorImageFieldProps) {
  const inputId = useId();
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [previewFailed, setPreviewFailed] = useState(false);

  const selectFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const validationError = validateCreatorImage(file);
    if (validationError) {
      setMessage(validationError);
      return;
    }
    setUploading(true);
    setMessage("");
    try {
      const uri = await uploadCreatorImage(user, projectSlug, file);
      onChange(uri);
      setPreviewFailed(false);
      setMessage("Uploaded to public IPFS. Save the project to publish this change.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Image upload failed.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className={`creatorMediaField ${shape}`}>
      <div className="creatorMediaHeading"><div><strong>{label}{optional ? " · optional" : ""}</strong><span>{description}</span></div>{value && <button type="button" onClick={() => { onChange(""); setMessage("Image removed from this draft. Save to publish."); }}>Remove</button>}</div>
      {value && !previewFailed && <img src={ipfsToHttp(value)} alt={`${label} preview`} referrerPolicy="no-referrer" onError={() => setPreviewFailed(true)} />}
      <div className="creatorMediaActions">
        <label htmlFor={inputId} className={uploading ? "disabled" : ""}>{uploading ? "Uploading to IPFS…" : value ? "Replace image" : "Upload image"}</label>
        <input id={inputId} type="file" accept={CREATOR_IMAGE_TYPES.join(",")} disabled={uploading} onChange={(event) => void selectFile(event)} />
      </div>
      <label className="creatorMediaUrl">Or use an HTTPS/IPFS URL<input maxLength={512} inputMode="url" placeholder="https:// or ipfs://" value={value} onChange={(event) => { onChange(event.target.value); setPreviewFailed(false); setMessage(""); }} /></label>
      <small>{Math.round(CREATOR_IMAGE_MAX_BYTES / 1_000_000)} MB maximum · JPG, PNG or WebP · uploads are public and may be permanent.</small>
      {message && <p role="status">{message}</p>}
    </div>
  );
}

export function CreatorGalleryField({
  projectSlug,
  user,
  values,
  onChange
}: {
  projectSlug: string;
  user: User;
  values: string[];
  onChange: (values: string[]) => void;
}) {
  const inputId = useId();
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");

  const selectFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;
    const available = Math.max(0, 6 - values.filter(Boolean).length);
    if (files.length > available) {
      setMessage(`Choose no more than ${available} additional image${available === 1 ? "" : "s"}.`);
      return;
    }
    const validationError = files.map(validateCreatorImage).find(Boolean);
    if (validationError) {
      setMessage(validationError);
      return;
    }
    setUploading(true);
    setMessage("");
    const uploaded = [...values.filter(Boolean)];
    try {
      for (const file of files) {
        uploaded.push(await uploadCreatorImage(user, projectSlug, file));
        onChange([...uploaded]);
      }
      setMessage(`${files.length} image${files.length === 1 ? "" : "s"} uploaded. Save the project to publish the gallery.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Gallery upload stopped before completion.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="creatorMediaField creatorGalleryField">
      <div className="creatorMediaHeading"><div><strong>Screenshot gallery</strong><span>Show up to six real product, game, art or community images.</span></div><b>{values.filter(Boolean).length}/6</b></div>
      {values.filter(Boolean).length > 0 && <div className="creatorGalleryPreview">{values.filter(Boolean).map((uri, index) => <div key={`${uri}-${index}`}><img src={ipfsToHttp(uri)} alt={`Gallery preview ${index + 1}`} referrerPolicy="no-referrer" /><button type="button" aria-label={`Remove gallery image ${index + 1}`} onClick={() => onChange(values.filter(Boolean).filter((_, candidate) => candidate !== index))}>×</button></div>)}</div>}
      <div className="creatorMediaActions">
        <label htmlFor={inputId} className={uploading || values.filter(Boolean).length >= 6 ? "disabled" : ""}>{uploading ? "Uploading gallery…" : "Add images"}</label>
        <input id={inputId} type="file" multiple accept={CREATOR_IMAGE_TYPES.join(",")} disabled={uploading || values.filter(Boolean).length >= 6} onChange={(event) => void selectFiles(event)} />
      </div>
      <label className="creatorMediaUrl">Or use one HTTPS/IPFS URL per line<textarea maxLength={3077} placeholder={"https://…\nipfs://…"} value={values.join("\n")} onChange={(event) => { onChange(event.target.value.split(/\r?\n/).slice(0, 6)); setMessage(""); }} /></label>
      <small>5 MB per upload · JPG, PNG or WebP · uploaded media is public and may be permanent.</small>
      {message && <p role="status">{message}</p>}
    </div>
  );
}
