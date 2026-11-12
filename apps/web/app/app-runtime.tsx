"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { LaunchShell } from "./(launchpad)/_components/launch-shell";
import { LaunchWalletProvider } from "./(launchpad)/_components/launch-wallet";

export function AppRuntime({ children }: { children: ReactNode }) {
  const path = usePathname();
  const launchpad = path === "/" || path === "/create-token" || path === "/my-launches" || path === "/wallet"
    || path.startsWith("/launches/");
  if (launchpad) return <LaunchWalletProvider><LaunchShell>{children}</LaunchShell></LaunchWalletProvider>;
  return children;
}
