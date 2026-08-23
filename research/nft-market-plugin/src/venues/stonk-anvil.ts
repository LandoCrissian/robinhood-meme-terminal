import type { SourceRegistration } from "../adapters.ts";
import { normalizeAddress } from "../domain.ts";

export const STONKBROKERS_COLLECTION = "0x539cdd042c2f3d93ebc5be7dfff0c79f3b4fabf0" as const;
export const STONKBROKER_TOKEN = normalizeAddress([
  "0xe934e36a43",
  "9c94017b64a",
  "3fece66af1",
  "2099abf50",
].join(""));
export const STONK_ANVIL_VAULT = "0xe302733accf4800146e55fc45b46b4e4ffc032d2" as const;

export const STONK_ANVIL_RESEARCH: SourceRegistration = {
  sourceId: "stonkbrokers-anvil",
  displayName: "StonkBrokers / Anvil NFT AMM",
  chainId: 4663,
  admission: "candidate",
  identityState: "candidate",
  capabilities: ["catalogue", "listings", "item_offers", "amm_liquidity"],
  protocol: "stonk-nft-amm-vault",
  contractAddresses: [STONKBROKERS_COLLECTION, STONKBROKER_TOKEN, STONK_ANVIL_VAULT],
  apiKind: "onchain",
  evidence: [
    "https://www.stonkbrokers.cash/docs",
    "https://robinhoodchain.blockscout.com/address/0xe302733accf4800146e55fc45b46b4e4ffc032d2"
  ],
  blockers: [
    "Pin exact deployment transaction/block and runtime bytecode hash.",
    "Retrieve and independently review the deployed vault ABI and event set.",
    "Prove buy/sell/snipe quote math and fee basis against live state.",
    "Rehearse vault inventory changes, approval revocation, sold-item races and insufficient token/ETH paths.",
    "Build a provider-specific verifier; do not route this protocol through generic Seaport logic."
  ]
};

export const STONK_ANVIL_DOCUMENTED_BEHAVIOR = Object.freeze({
  collectionSupply: 4_444,
  collectionStandard: "erc721",
  tokenBoundAccounts: "erc6551",
  flatTokenPrincipal: "666666 STONKBROKER",
  swapNativeFee: "10% documented ETH trade fee",
  snipeNativeFee: "15% documented ETH trade fee",
  integratorFunctions: ["buy", "sell", "snipe"] as const
});

export const STONK_ANVIL_VERIFICATION_CHECKLIST = Object.freeze([
  "vault_runtime_hash_and_deployment_boundary_exact",
  "collection_and_stonk_token_immutables_or_bindings_exact",
  "inventory_token_id_current_owner_is_vault_for_buy",
  "seller_current_owner_and_vault_operator_approval_for_sell",
  "documented_principal_read_from_live_contract_not_ui_constant",
  "native_eth_fee_read_or_recomputed_from_verified_contract_state",
  "snipe_vs_regular_buy_semantics_distinct",
  "input_stonk_balance_and_allowance_exact",
  "output_token_id_exact_for_snipe",
  "minimum_output_or_price_max_protection_exact_if_supported",
  "recipient_exact",
  "no_implicit_rmt_fee",
  "fresh_simulation_successful",
  "receipt_reconciles_nft_and_stonk_eth_transfers"
] as const);
