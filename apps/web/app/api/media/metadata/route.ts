import { NextResponse } from "next/server";
import { z } from "zod";

const metadataSchema = z.object({
  name: z.string().trim().min(2).max(40),
  symbol: z.string().trim().min(2).max(10).regex(/^[A-Z0-9]+$/),
  description: z.string().trim().min(10).max(500),
  image: z.string().regex(/^ipfs:\/\/[a-zA-Z0-9]+$/),
  website: z.string().url().startsWith("https://").or(z.literal("")),
  x: z.string().url().startsWith("https://").or(z.literal("")),
  telegram: z.string().url().startsWith("https://").or(z.literal(""))
});

export async function POST(request: Request) {
  const jwt = process.env.PINATA_JWT;
  if (!jwt) return NextResponse.json({ error: "Token metadata storage is not configured yet." }, { status: 503 });
  const parsed = metadataSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "The token metadata is invalid." }, { status: 400 });

  const metadata = { ...parsed.data, website: parsed.data.website || undefined, x: parsed.data.x || undefined, telegram: parsed.data.telegram || undefined, decimals: 18, properties: { category: "image" } };
  const file = new File([JSON.stringify(metadata)], `${parsed.data.symbol.toLowerCase()}-metadata.json`, { type: "application/json" });
  const form = new FormData();
  form.append("file", file);
  form.append("network", "public");
  const response = await fetch("https://uploads.pinata.cloud/v3/files", { method: "POST", headers: { Authorization: `Bearer ${jwt}` }, body: form });
  const result = (await response.json().catch(() => null)) as { data?: { cid?: string }; error?: string } | null;
  const cid = result?.data?.cid;
  if (!response.ok || !cid) return NextResponse.json({ error: result?.error || "Could not save token metadata." }, { status: 502 });
  return NextResponse.json({ uri: `ipfs://${cid}`, cid });
}
