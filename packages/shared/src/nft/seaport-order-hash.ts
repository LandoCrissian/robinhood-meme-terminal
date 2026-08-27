import {
  concat,
  encodeAbiParameters,
  getAddress,
  isAddress,
  isHex,
  keccak256,
  toHex,
  type Hex,
} from "viem";
import type {
  RmtSeaportConsiderationItem,
  RmtSeaportItem,
  RmtSeaportOrderComponents,
} from "./marketplace-evidence.js";

const OFFER_ITEM_TYPEHASH = keccak256(
  toHex(
    "OfferItem(uint8 itemType,address token,uint256 identifierOrCriteria,uint256 startAmount,uint256 endAmount)",
  ),
);
const CONSIDERATION_ITEM_TYPEHASH = keccak256(
  toHex(
    "ConsiderationItem(uint8 itemType,address token,uint256 identifierOrCriteria,uint256 startAmount,uint256 endAmount,address recipient)",
  ),
);
const ORDER_COMPONENTS_TYPEHASH = keccak256(
  toHex(
    "OrderComponents(address offerer,address zone,OfferItem[] offer,ConsiderationItem[] consideration,uint8 orderType,uint256 startTime,uint256 endTime,bytes32 zoneHash,uint256 salt,bytes32 conduitKey,uint256 counter)ConsiderationItem(uint8 itemType,address token,uint256 identifierOrCriteria,uint256 startAmount,uint256 endAmount,address recipient)OfferItem(uint8 itemType,address token,uint256 identifierOrCriteria,uint256 startAmount,uint256 endAmount)",
  ),
);
const hashArray = (values: readonly Hex[]) =>
  keccak256(values.length ? concat(values) : "0x");
function hashOfferItem(item: RmtSeaportItem): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "uint8" },
        { type: "address" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
      ],
      [
        OFFER_ITEM_TYPEHASH,
        item.itemType,
        item.token,
        item.identifierOrCriteria,
        item.startAmount,
        item.endAmount,
      ],
    ),
  );
}
function hashConsiderationItem(item: RmtSeaportConsiderationItem): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "uint8" },
        { type: "address" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "address" },
      ],
      [
        CONSIDERATION_ITEM_TYPEHASH,
        item.itemType,
        item.token,
        item.identifierOrCriteria,
        item.startAmount,
        item.endAmount,
        item.recipient,
      ],
    ),
  );
}
export function seaportOrderHash(order: RmtSeaportOrderComponents): Hex {
  if (
    !Number.isInteger(order.orderType) ||
    order.orderType < 0 ||
    order.orderType > 255
  )
    throw new Error("Seaport orderType must fit uint8.");
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "address" },
        { type: "address" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint8" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "uint256" },
      ],
      [
        ORDER_COMPONENTS_TYPEHASH,
        order.offerer,
        order.zone,
        hashArray(order.offer.map(hashOfferItem)),
        hashArray(order.consideration.map(hashConsiderationItem)),
        order.orderType,
        order.startTime,
        order.endTime,
        order.zoneHash,
        order.salt,
        order.conduitKey,
        order.counter,
      ],
    ),
  );
}
type Rec = Record<string, unknown>;
const rec = (v: unknown): v is Rec =>
  !!v && typeof v === "object" && !Array.isArray(v);
function uint(v: unknown, label: string) {
  if (typeof v === "number") {
    if (!Number.isSafeInteger(v) || v < 0)
      throw new Error(`${label} must be a safe non-negative integer.`);
    return BigInt(v);
  }
  if (typeof v !== "string" || !/^\d+$/.test(v))
    throw new Error(`${label} must be an unsigned integer.`);
  return BigInt(v);
}
function uint8(v: unknown, label: string) {
  const parsed = uint(v, label);
  if (parsed > 255n) throw new Error(`${label} must fit uint8.`);
  return Number(parsed);
}
function address(v: unknown, label: string) {
  if (typeof v !== "string" || !isAddress(v, { strict: false }))
    throw new Error(`${label} must be an address.`);
  return getAddress(v);
}
function bytes32(v: unknown, label: string) {
  if (typeof v !== "string" || !isHex(v) || v.length !== 66)
    throw new Error(`${label} must be bytes32.`);
  return v as Hex;
}
function item(v: unknown, label: string): RmtSeaportItem {
  if (!rec(v)) throw new Error(`${label} must be an object.`);
  return {
    itemType: uint8(v.itemType, `${label}.itemType`),
    token: address(v.token, `${label}.token`),
    identifierOrCriteria: uint(
      v.identifierOrCriteria,
      `${label}.identifierOrCriteria`,
    ),
    startAmount: uint(v.startAmount, `${label}.startAmount`),
    endAmount: uint(v.endAmount, `${label}.endAmount`),
  };
}
export function parseSeaportOrderComponents(
  value: unknown,
): RmtSeaportOrderComponents {
  if (
    !rec(value) ||
    !Array.isArray(value.offer) ||
    !Array.isArray(value.consideration)
  )
    throw new Error(
      "ORDER_IDENTITY_UNVERIFIED: complete protocol_data.parameters is required.",
    );
  return {
    offerer: address(value.offerer, "offerer"),
    zone: address(value.zone, "zone"),
    offer: value.offer.map((v, i) => item(v, `offer[${i}]`)),
    consideration: value.consideration.map((v, i) => {
      const parsed = item(v, `consideration[${i}]`);
      if (!rec(v)) throw new Error("invalid consideration");
      return {
        ...parsed,
        recipient: address(v.recipient, `consideration[${i}].recipient`),
      };
    }),
    orderType: uint8(value.orderType, "orderType"),
    startTime: uint(value.startTime, "startTime"),
    endTime: uint(value.endTime, "endTime"),
    zoneHash: bytes32(value.zoneHash, "zoneHash"),
    salt: uint(value.salt, "salt"),
    conduitKey: bytes32(value.conduitKey, "conduitKey"),
    counter: uint(value.counter, "counter"),
  };
}
