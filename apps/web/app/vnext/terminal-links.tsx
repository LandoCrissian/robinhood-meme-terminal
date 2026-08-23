"use client";

import React, { useState, type ReactNode } from "react";
import {
  canonicalRobinhoodAddress,
  robinhoodExplorerAddress,
  robinhoodExplorerBlock,
  robinhoodExplorerPool,
  robinhoodExplorerToken,
  robinhoodExplorerTransaction
} from "../../lib/vnext/robinhood-chain-links";
import {
  safeExternalNavigationUrl,
  safeExternalSocialNavigationUrl,
  type ExternalSocialNavigationKind
} from "../../lib/vnext/external-navigation";

type ExplorerKind = "token" | "address" | "pool" | "transaction" | "block";

function explorerHref(kind: ExplorerKind, value: string) {
  if (kind === "token") return robinhoodExplorerToken(value);
  if (kind === "address") return robinhoodExplorerAddress(value);
  if (kind === "pool") return robinhoodExplorerPool(value);
  if (kind === "transaction") return robinhoodExplorerTransaction(value);
  return robinhoodExplorerBlock(value);
}

export function ExplorerLink({ kind, value, children, className, accessibleName }: {
  kind: ExplorerKind;
  value: string;
  children: ReactNode;
  className?: string;
  accessibleName?: string;
}) {
  let href: string;
  try {
    href = explorerHref(kind, value);
  } catch {
    return null;
  }
  return <a href={href} className={className} target="_blank" rel="noopener noreferrer" aria-label={accessibleName}>{children}</a>;
}

export function ExternalProjectLink({ href: rawHref, children, className, accessibleName, socialKind }: {
  href: unknown;
  children: ReactNode;
  className?: string;
  accessibleName?: string;
  socialKind?: ExternalSocialNavigationKind;
}) {
  const href = socialKind
    ? safeExternalSocialNavigationUrl(rawHref, socialKind)
    : safeExternalNavigationUrl(rawHref);
  if (!href) return null;
  return <a href={href} className={className} target="_blank" rel="noopener noreferrer" aria-label={accessibleName}>{children}</a>;
}

export function CopyAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  let normalized: string;
  try {
    normalized = canonicalRobinhoodAddress(address);
  } catch {
    return null;
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(normalized);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      setCopied(false);
    }
  };
  return <span className="vnCopyAddress">
    <code title={normalized}>{normalized}</code>
    <button type="button" onClick={() => void copy()} aria-live="polite" aria-label={copied ? "Full token contract copied" : `Copy full token contract ${normalized}`}>{copied ? "Copied" : "Copy"}</button>
  </span>;
}
