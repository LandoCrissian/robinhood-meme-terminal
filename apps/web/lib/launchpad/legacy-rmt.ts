import type { Address } from "viem";

const legacyTokens = new Set([
  "0xdba33be56c89cc9fc014c4459028d7e5c7878671",
  "0xab374d24afbd943a134adb381d9646e71c6f6c0c",
]);

export function legacyRmtAddress(address: Address) {
  return legacyTokens.has(address.toLowerCase());
}
