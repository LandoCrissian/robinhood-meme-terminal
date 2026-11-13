"use client";

import type { Address } from "viem";
import { CurveCreate } from "./curve-create";
import { CurveDirectory } from "./curve-directory";
import { CurveToken } from "./curve-token";
import { CreateLaunch } from "./create-launch";
import { LaunchDirectory, MyLaunches } from "./launch-directory";
import { LaunchTokenDetail } from "./launch-token";
import { useLaunchWallet } from "./launch-wallet";

function useHistoricalDirectFixture() {
  const { config } = useLaunchWallet();
  return config?.status === "ready" && !config.curve;
}

export function ProductCreate() {
  return useHistoricalDirectFixture() ? <CreateLaunch /> : <CurveCreate />;
}
export function ProductDirectory({ mine = false }: { mine?: boolean }) {
  const historical = useHistoricalDirectFixture();
  return historical ? mine ? <MyLaunches /> : <LaunchDirectory /> : <CurveDirectory mine={mine} />;
}
export function ProductToken({ token, side }: { token: Address; side: "buy" | "sell" }) {
  return useHistoricalDirectFixture() ? <LaunchTokenDetail token={token} side={side} /> : <CurveToken token={token} initialSide={side} />;
}
