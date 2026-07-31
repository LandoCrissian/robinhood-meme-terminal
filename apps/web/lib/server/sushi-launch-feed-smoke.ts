import assert from "node:assert/strict";
import { fetchSushiLaunchSnapshot, parseSushiLaunchProjects } from "./sushi-launch-feed";

const token = ["0xcd38e4c26a62892dfa1e", "26e1395c93111ceaf7e2"].join("");
const creator = "0xe8883884b4e8919863aa0032c31ab45d9dfcb69f";
const pool = "0xb78ba906286cbfa9356d89c3fc9516a30682cd2d";
const launchpad = "0x104f1ab42674565ec3df0bfebccc4186f72fa7ed";

function payload(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      launchpad: {
        tokens: {
          edges: [{
            node: {
              chainId: 4663,
              address: token,
              creator,
              factoryAddress: launchpad,
              name: "TINY AI",
              symbol: "TINY",
              indexingStatus: "CONFIRMED",
              pool: { address: pool },
              metadata: {
                description: "AI-native project",
                links: [
                  { kind: "x", url: "https://x.com/tinyhumansai" },
                  { kind: "homepage", url: "javascript:alert(1)" }
                ]
              },
              createdAt: "2026-07-31T23:08:04.000Z",
              ...overrides
            }
          }]
        }
      }
    }
  };
}

const parsed = parseSushiLaunchProjects([
  payload(),
  payload(),
  payload({ address: "0x0000000000000000000000000000000000000001", factoryAddress: creator }),
  { malformed: true }
]);
assert.equal(parsed.projects.size, 1);
assert.deepEqual(parsed.candidateAddresses.map((address) => address.toLowerCase()), [token]);
const project = parsed.projects.get(token);
assert.equal(project?.sourceId, "sushi");
assert.equal(project?.sourceName, "Sushi Launch");
assert.equal(project?.launchPool.toLowerCase(), pool);
assert.equal(project?.socials.x, "https://x.com/tinyhumansai");
assert.equal(project?.socials.website, null);
assert.match(project?.imageUri ?? "", /\/4663\/0xcd38/);

async function main() {
  let requests = 0;
  const snapshot = await fetchSushiLaunchSnapshot({
    fetch: async (_input, init) => {
      requests += 1;
      const body = JSON.parse(String(init?.body)) as { variables?: { input?: { chainId?: number } } };
      assert.equal(body.variables?.input?.chainId, 4663);
      return requests === 2 ? new Response("delayed", { status: 503 }) : Response.json(payload());
    }
  });
  assert.equal(requests, 3);
  assert.equal(snapshot.delayed, true);
  assert.equal(snapshot.projects.size, 1);
  assert.deepEqual(snapshot.candidateAddresses.map((address) => address.toLowerCase()), [token]);

  console.info("Sushi Launch feed smoke passed");
}

void main();
