import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { gunzipSync } from "node:zlib";
import { verifiedRelease } from "../rmt-task041-closeout/verify-release.mjs";

const archive = JSON.parse(
  gunzipSync(readFileSync(new URL("../rmt-task043/slither-4663-full.json.gz", import.meta.url)), {
    maxOutputLength: 12 * 1024 * 1024,
  }),
);

test("the triage covers exactly the frozen closure highs and governance mediums", () => {
  const release = verifiedRelease();
  const document = readFileSync(new URL("./security-triage.md", import.meta.url), "utf8");
  const ids = Array.from(document.matchAll(/^\| `([a-f0-9]{64})` \|/gm), ([, id]) => id);
  const reviewed = archive.detectors.filter(({ impact, elements }) =>
    impact === "High" ||
    (impact === "Medium" &&
      /^src\/RMTLaunch(CurveDirectory|ProjectRegistry)V2\.sol$/.test(elements[0].source_mapping.filename_short)),
  );
  assert.equal(ids.length, release.releaseGate.findings.High + release.releaseGate.governanceMedium);
  assert.deepEqual(ids.sort(), reviewed.map(({ id }) => id).sort());
  assert.match(document, /FAIL_HIGH · BLOCKED_NO_BROADCAST/);
});

const replayPath = process.env.RMT_FRESH_SLITHER_REPORT;
if (replayPath) {
  test("the fresh report preserves all archived ratings and source sites", () => {
    const replay = JSON.parse(readFileSync(replayPath, "utf8"));
    const { detectors: archived, ...archiveMetadata } = archive;
    const { detectors: repeated, ...replayMetadata } = replay;
    assert.deepEqual(replayMetadata, archiveMetadata);
    const findings = (rows) => rows.map(({ id, check, impact, confidence, description, elements }) => ({
      id, check, impact, confidence, description,
      elements: elements.map(({ type, name, source_mapping }) => ({
        type, name, source: source_mapping.filename_short,
        offset: source_mapping.start, length: source_mapping.length, lines: source_mapping.lines,
      })),
    })).sort((left, right) => left.id.localeCompare(right.id));
    const original = findings(archived);
    const fresh = findings(repeated);
    assert.equal(fresh.length, original.length);
    for (const [index, entry] of original.entries()) assert.deepEqual(fresh[index], entry, entry.id);
  });
}
