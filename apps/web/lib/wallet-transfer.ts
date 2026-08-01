import { getAddress, isAddress, parseEther, zeroAddress, type Address } from "viem";

export type PreparedNativeTransfer = {
  recipient: Address;
  value: bigint;
};

export function prepareNativeTransfer(input: {
  recipient: string;
  amount: string;
  sender: string;
  balance?: bigint;
}): PreparedNativeTransfer {
  const recipientInput = input.recipient.trim();
  if (!isAddress(recipientInput, { strict: false })) {
    throw new Error("Enter a valid EVM wallet address.");
  }

  const recipient = getAddress(recipientInput);
  if (recipient.toLowerCase() === zeroAddress) {
    throw new Error("The zero address cannot receive this transfer.");
  }
  if (recipient.toLowerCase() === input.sender.toLowerCase()) {
    throw new Error("Choose a destination other than the active wallet.");
  }

  const amount = input.amount.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(amount)) {
    throw new Error("Enter an ETH amount with no more than 18 decimal places.");
  }

  const value = parseEther(amount);
  if (value <= 0n) throw new Error("Enter an ETH amount greater than zero.");
  if (input.balance !== undefined && value >= input.balance) {
    throw new Error("Leave some ETH in the wallet for the network fee.");
  }

  return { recipient, value };
}

export function safeTransferMessage(message: string) {
  if (/rejected|denied|cancelled|canceled/i.test(message)) {
    return "Transfer cancelled. No funds were moved.";
  }
  if (/insufficient funds|exceeds the balance|network fee|gas/i.test(message)) {
    return "The wallet needs more ETH to cover this transfer and the network fee.";
  }
  if (/chain|network/i.test(message)) {
    return "Switch the active wallet to Robinhood Chain and try again.";
  }
  return "The transfer did not complete. Review the destination and try again.";
}
