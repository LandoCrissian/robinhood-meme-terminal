export type RuntimeImmutableFields = { creator: `0x${string}`; deploymentFactory: `0x${string}`; intentId: `0x${string}`; treasuryShareBps: number; deploymentChainId: 31337 | 4663 };
export function materializeProjectTreasuryRuntime(template: `0x${string}`, references: Record<string,{ start: number; length: number }[]>, names: Record<string,string>, fields: RuntimeImmutableFields): `0x${string}`;
export const projectTreasuryFactorySignatures: readonly string[];
export const projectTreasurySignatures: readonly string[];
