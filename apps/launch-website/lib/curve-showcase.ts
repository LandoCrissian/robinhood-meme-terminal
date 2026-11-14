export type CurveShowcaseExample = {
  slug: string;
  name: string;
  symbol: string;
  supply: number;
  netSold: number;
  stage: "curve" | "graduated";
};

// Illustrative projects have no onchain identities and never enter the launch index.
export const curveShowcaseExamples: readonly CurveShowcaseExample[] = [
  { slug: "example-alder", name: "Alder Example", symbol: "ALDR", supply: 1_000_000, netSold: 360_000, stage: "curve" },
  { slug: "example-harbor", name: "Harbor Example", symbol: "HBR", supply: 1_000_000, netSold: 600_000, stage: "graduated" },
];

export function curveShowcaseStage(example: CurveShowcaseExample) {
  return example.stage === "curve" ? "Bonding curve" : "Uniswap v4";
}

export function launchExample(slug: string) {
  return curveShowcaseExamples.find((example) => example.slug === slug);
}
