import fs from "node:fs";
import process from "node:process";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";

const [claimsPath] = process.argv.slice(2);
if (!claimsPath) {
  throw new Error("usage: node verify_openzeppelin.mjs <claims.json>");
}

const claimsArtifact = JSON.parse(fs.readFileSync(claimsPath, "utf8"));
const leafDomain = "0x47313ccea952a5802ce51dd358acf64dacb52c83f873d74fff2bbf6f0fd2eb16";
const leafEncoding = [
  "bytes32",
  "uint256",
  "address",
  "uint256",
  "uint256",
  "address",
  "uint256"
];

const values = claimsArtifact.claims.map((claim) => [
  leafDomain,
  String(claimsArtifact.chainId),
  claimsArtifact.distributor,
  String(claimsArtifact.epochId),
  String(claim.index),
  claim.account,
  claim.amount
]);

const tree = StandardMerkleTree.of(values, leafEncoding);
const normalize = (value) => value.toLowerCase();

if (normalize(tree.root) !== normalize(claimsArtifact.merkleRoot)) {
  throw new Error(`OpenZeppelin root mismatch: ${tree.root} != ${claimsArtifact.merkleRoot}`);
}

for (const [valueIndex, claim] of claimsArtifact.claims.entries()) {
  const value = values[valueIndex];
  const leaf = tree.leafHash(value);
  if (normalize(leaf) !== normalize(claim.leaf)) {
    throw new Error(`OpenZeppelin leaf mismatch at claim ${claim.index}`);
  }

  const proof = tree.getProof(valueIndex);
  const expectedProof = claim.proof.map(normalize);
  const actualProof = proof.map(normalize);
  if (JSON.stringify(actualProof) !== JSON.stringify(expectedProof)) {
    throw new Error(`OpenZeppelin proof mismatch at claim ${claim.index}`);
  }
  if (!StandardMerkleTree.verify(tree.root, leafEncoding, value, proof)) {
    throw new Error(`OpenZeppelin proof rejected at claim ${claim.index}`);
  }
}

console.log(
  JSON.stringify({
    valid: true,
    implementation: "@openzeppelin/merkle-tree@1.0.8",
    merkleRoot: tree.root,
    claimCount: claimsArtifact.claims.length
  })
);
