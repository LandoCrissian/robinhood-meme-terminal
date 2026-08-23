import { normalizeAddress, type NftMarketOrder } from "../domain.ts";
import {
  assertRmtNftExecutionFeeEconomics,
  type RmtNftExecutionFeeEconomics,
  type RmtNftExecutionFeePolicy
} from "../execution-fee.ts";
import { SEAPORT_1_6 } from "./opensea-seaport.ts";

export type SeaportFeeSettlementRoute =
  | "listing-buy-via-rmt-executor"
  | "offer-sell-via-seller-counterorder";

export type SeaportFeeSettlementDesign = {
  protocolAddress: typeof SEAPORT_1_6;
  route: SeaportFeeSettlementRoute;
  providerFunction: "fulfillAdvancedOrder" | "matchAdvancedOrders";
  walletTarget: "rmt_nft_executor_only";
  signedMakerOrderMutationAllowed: false;
  exactVenueConsiderationRequired: true;
  rmtFeeTransferInSameTransaction: true;
  providerFillAndFeeMustRevertTogether: true;
  directSeaportWalletFallbackAllowed: false;
  directBasicOrderFeePathAllowed: false;
  sellerNftCustodyRequired: false;
  notes: readonly string[];
};

export const SEAPORT_BUY_FEE_SETTLEMENT_DESIGN: SeaportFeeSettlementDesign = Object.freeze({
  protocolAddress: SEAPORT_1_6,
  route: "listing-buy-via-rmt-executor",
  providerFunction: "fulfillAdvancedOrder",
  walletTarget: "rmt_nft_executor_only",
  signedMakerOrderMutationAllowed: false,
  exactVenueConsiderationRequired: true,
  rmtFeeTransferInSameTransaction: true,
  providerFillAndFeeMustRevertTogether: true,
  directSeaportWalletFallbackAllowed: false,
  directBasicOrderFeePathAllowed: false,
  sellerNftCustodyRequired: false,
  notes: Object.freeze([
    "The executor is the Seaport fulfiller and the NFT recipient is the authenticated user, not the executor.",
    "Native buys provide exactly the venue-required msg.value to Seaport and transfer the separate RMT fee to treasury in the same outer transaction.",
    "ERC20 buys pull only the committed total debit, bind provider spend exactly, and must not leave reusable residual approval.",
    "OpenSea fulfillment data is untrusted input until locally decoded, reconciled to the signed order and freshly simulated."
  ])
});

export const SEAPORT_SELL_FEE_SETTLEMENT_DESIGN: SeaportFeeSettlementDesign = Object.freeze({
  protocolAddress: SEAPORT_1_6,
  route: "offer-sell-via-seller-counterorder",
  providerFunction: "matchAdvancedOrders",
  walletTarget: "rmt_nft_executor_only",
  signedMakerOrderMutationAllowed: false,
  exactVenueConsiderationRequired: true,
  rmtFeeTransferInSameTransaction: true,
  providerFillAndFeeMustRevertTogether: true,
  directSeaportWalletFallbackAllowed: false,
  directBasicOrderFeePathAllowed: false,
  sellerNftCustodyRequired: false,
  notes: Object.freeze([
    "Do not make the executor a standard fulfiller that first takes custody of the seller NFT.",
    "Accepting an external ERC20/WETH offer uses the buyer's unchanged signed order plus a seller counter-order whose consideration explicitly accounts for venue fees, required royalties, seller net proceeds and the exact RMT fee.",
    "The seller counter-order is signed only after RMT binds the exact item, offer, recipient set, fee amount, treasury, deadline and policy hash.",
    "matchAdvancedOrders fulfillments must reconcile every offered and considered unit with no unexplained remainder or recipient."
  ])
});

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Seaport NFT fee settlement rejected: ${message}.`);
}

export function seaportSettlementDesignFor(side: "buy" | "sell") {
  return side === "buy" ? SEAPORT_BUY_FEE_SETTLEMENT_DESIGN : SEAPORT_SELL_FEE_SETTLEMENT_DESIGN;
}

export function assertSeaportFeeSettlementAdmission(input: {
  order: NftMarketOrder;
  economics: RmtNftExecutionFeeEconomics;
  policy: RmtNftExecutionFeePolicy;
  protocolAddress: string;
  executionTarget: string;
  pinnedExecutorAddress: string;
  providerFunction: string;
  signedMakerOrderUnmodified: boolean;
  exactVenueConsiderationPreserved: boolean;
  atomicOuterTransaction: boolean;
  directWalletTargetIsSeaport: boolean;
  sellerCounterOrderBound?: boolean;
}) {
  assertRmtNftExecutionFeeEconomics(input.economics, input.policy);
  invariant(input.order.protocolId === "seaport-1.6", "order is not normalized as Seaport 1.6");
  invariant(normalizeAddress(input.protocolAddress) === SEAPORT_1_6, "protocol address is not the pinned Robinhood Seaport 1.6 deployment");
  invariant(normalizeAddress(input.executionTarget) === normalizeAddress(input.pinnedExecutorAddress), "wallet target is not the pinned RMT NFT executor");
  invariant(input.directWalletTargetIsSeaport === false, "direct Seaport wallet fallback would bypass RMT fee settlement");
  invariant(input.signedMakerOrderUnmodified === true, "signed maker order was modified");
  invariant(input.exactVenueConsiderationPreserved === true, "venue consideration changed");
  invariant(input.atomicOuterTransaction === true, "provider fill and RMT fee are not atomic");
  const design = seaportSettlementDesignFor(input.economics.side);
  invariant(input.providerFunction === design.providerFunction, "provider function does not match the admitted side-specific design");
  if (input.economics.side === "sell") {
    invariant(input.sellerCounterOrderBound === true, "seller-side offer acceptance requires a fee-bound seller counter-order");
    invariant(input.order.paymentAsset.kind === "erc20", "Seaport V1 seller-side offer settlement requires ERC20/WETH payment");
    invariant(input.order.kind === "item_offer" || input.order.kind === "collection_offer" || input.order.kind === "trait_offer", "seller-side settlement requires an offer order");
  } else {
    invariant(input.order.kind === "listing", "buyer-side settlement requires a listing order");
  }
  return true;
}

export const SEAPORT_FEE_SETTLEMENT_VERIFICATION_CHECKLIST = Object.freeze([
  "rmt_nft_policy_hash_exact",
  "rmt_nft_treasury_exact",
  "rmt_nft_fee_floor_25bps_of_venue_gross_payment_exact",
  "wallet_target_exact_pinned_rmt_nft_executor",
  "provider_target_exact_pinned_seaport_1_6",
  "provider_selector_side_specific_and_allowlisted",
  "maker_signed_order_hash_and_components_unmodified",
  "all_venue_consideration_recipients_and_amounts_exact",
  "optional_creator_fee_choice_explicit_and_quote_bound",
  "nft_contract_token_id_quantity_and_recipient_exact",
  "buyer_total_or_seller_net_matches_normalized_economics",
  "seller_counterorder_exact_and_user_signed_for_offer_acceptance",
  "no_unexplained_native_or_erc20_remainder",
  "no_residual_reusable_erc20_or_nft_approval_created_by_executor",
  "fresh_order_status_counter_ownership_approval_and_balance",
  "fresh_full_outer_transaction_simulation_success",
  "receipt_proves_provider_fill_and_exact_rmt_fee_same_transaction",
  "failed_or_reverted_execution_settles_zero_rmt_fee"
] as const);
