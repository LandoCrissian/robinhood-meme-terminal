import { NextResponse } from "next/server";

const MAX_IMAGE_BYTES = 5_000_000;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const jwt = process.env.PINATA_JWT;
  if (!jwt) return NextResponse.json({ error: "Token image storage is not configured yet." }, { status: 503 });

  const body = (await request.json().catch(() => ({}))) as { filename?: string };
  const filename = (body.filename || "token-image").replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 100);
  const response = await fetch("https://uploads.pinata.cloud/v3/files/sign", {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
    body: JSON.stringify({ network: "public", date: Math.floor(Date.now() / 1000), expires: 60, max_file_size: MAX_IMAGE_BYTES, allow_mime_types: IMAGE_TYPES, filename })
  });
  const result = (await response.json().catch(() => null)) as { data?: string; error?: string } | null;
  if (!response.ok || !result?.data) return NextResponse.json({ error: result?.error || "Could not prepare the image upload." }, { status: 502 });
  return NextResponse.json({ url: result.data, maxBytes: MAX_IMAGE_BYTES, types: IMAGE_TYPES });
}
