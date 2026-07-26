import assert from "node:assert/strict";
import { parseLemonProjects, selectLemonCandidates } from "./lemon-project-feed";

const first = {
  address: "0x1c601107492337f6b02d6ce9c50e1de261a5aeb6",
  name: "Lemonhed degen",
  symbol: "LEMONHED",
  image: "https://cdn.example/lemonhed.jpg",
  description: "A live Lemon project.",
  deployer: "0x470977513d0bb596f63f5720e9a1aab9cb1f6f3a",
  createdAt: "2026-07-26T04:25:02.513512+00:00",
  poolAddress: "0x448636e2695f706be985d5cbe406b6186437ce95",
  socials: { twitter: "@lemonhed", telegram: "lemonhed", website: "https://example.com" }
};
const second = {
  ...first,
  address: "0x320e9a19b1f94c204ffb724583f4b2aab6550c26",
  poolAddress: "0x0f49d5a790889a1b7ca5a94d97bf45b835b6e6c7",
  name: "Lemon Face",
  symbol: "BRIAN"
};

const projects = parseLemonProjects({ tokens: [first, second, { ...first, deployer: "invalid" }] });
assert.equal(projects.size, 2);
const project = projects.get(first.address);
assert.equal(project?.sourceId, "lemon");
assert.equal(project?.sourceName, "Lemon");
assert.equal(project?.launchPool.toLowerCase(), first.poolAddress);
assert.equal(project?.imageUri, first.image);
assert.equal(project?.socials.x, "https://x.com/lemonhed");
assert.equal(project?.socials.telegram, "https://t.me/lemonhed");

const candidates = selectLemonCandidates({
  tokens: [
    {
      token_address: first.address,
      graduated_pool_address: first.poolAddress,
      chain_id: 4663,
      volume_24h_eth: 1,
      created_at: "2026-07-26T04:00:00Z"
    },
    {
      token_address: second.address,
      graduated_pool_address: second.poolAddress,
      chain_id: 988,
      volume_24h_eth: 100,
      created_at: "2026-07-26T05:00:00Z"
    }
  ]
}, { tokens: [first, second] });
assert.deepEqual(
  candidates.map((address) => address.toLowerCase()),
  [first.address, second.address]
);

console.info("Lemon project feed smoke passed");
