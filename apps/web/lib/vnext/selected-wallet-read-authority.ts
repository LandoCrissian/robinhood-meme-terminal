import type { RmtActiveSignerAuthority } from "../wallet-gateway";
import { selectedRmtWalletReadAddress } from "../wallet-gateway";

/** VNext compatibility boundary for connector-qualified portfolio reads. */
export function selectedVNextWalletReadAddress(input: {
  selectedWalletKey?: string | null;
  selectedWalletKind?: "embedded" | "external" | null;
  selectedSignerAuthority?: RmtActiveSignerAuthority | null;
  connectedAddress?: string;
  connectedChainId?: number;
  connectorId?: string;
  connectorType?: string;
  connectorUid?: string;
  requiredChainId: number;
}) {
  return selectedRmtWalletReadAddress(input);
}
