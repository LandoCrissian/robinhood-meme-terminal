import assert from "node:assert/strict";
import { POST } from "../../app/api/media/creator-sign/route";

const originalFetch = globalThis.fetch;
const originalProjectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const originalPinataJwt = process.env.PINATA_JWT;
const token = "a".repeat(120);

function request(body: unknown, authorization = `Bearer ${token}`, address = "203.0.113.44") {
  return new Request("https://www.rmtlaunch.fun/api/media/creator-sign", {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json",
      Origin: "https://www.rmtlaunch.fun",
      "Sec-Fetch-Site": "same-origin",
      "X-Forwarded-For": address
    },
    body: JSON.stringify(body)
  });
}

async function main() {
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "rmt-project";
  process.env.PINATA_JWT = "pinata-secret";

  assert.equal((await POST(request({ filename: "logo.png", projectSlug: "runner-studio" }, ""))).status, 401);
  assert.equal((await POST(request({ filename: "logo.png", projectSlug: "Runner Studio" }))).status, 400);

  const calls: Array<{ input: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ input: url, init });
    if (url.includes("firestore.googleapis.com")) {
      assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${token}`);
      assert.match(url, /projectAssignments\/runner-studio$/);
      return new Response('{"name":"verified-assignment"}', { status: 200 });
    }
    assert.equal(url, "https://uploads.pinata.cloud/v3/files/sign");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer pinata-secret");
    assert.match(String(init?.body), /runner-studio-logo\.png/);
    return new Response('{"data":"https://uploads.pinata.cloud/signed"}', {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }) as typeof fetch;

  const approved = await POST(request({ filename: "logo.png", projectSlug: "runner-studio" }, undefined, "203.0.113.45"));
  assert.equal(approved.status, 200);
  assert.equal((await approved.json() as { url?: string }).url, "https://uploads.pinata.cloud/signed");
  assert.equal(calls.length, 2);

  globalThis.fetch = (async () => new Response("forbidden", { status: 403 })) as typeof fetch;
  const denied = await POST(request({ filename: "logo.png", projectSlug: "runner-studio" }, undefined, "203.0.113.46"));
  assert.equal(denied.status, 403);
  assert.match((await denied.json() as { error?: string }).error ?? "", /not assigned/);

  console.info("Creator media ownership route smoke test passed");
}

void main().finally(() => {
  globalThis.fetch = originalFetch;
  if (originalProjectId === undefined) delete process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  else process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = originalProjectId;
  if (originalPinataJwt === undefined) delete process.env.PINATA_JWT;
  else process.env.PINATA_JWT = originalPinataJwt;
});
