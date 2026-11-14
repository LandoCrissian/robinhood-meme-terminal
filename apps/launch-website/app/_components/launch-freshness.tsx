import type { LaunchDirectoryData } from "../../lib/launch-data";
import { robinhoodExplorer } from "./launch-evidence";

const utc = new Intl.DateTimeFormat("en", {
  dateStyle: "medium", timeStyle: "short", timeZone: "UTC",
});

export function ChainTime({ value }: { value: string }) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? <time dateTime={value}>{utc.format(date)} UTC</time> : <>Unavailable</>;
}

export function LaunchFreshness({ data }: { data: LaunchDirectoryData }) {
  const { status, checkpoint, observedAt, coverage } = data;
  const checkpointLabel = coverage === "v6-indexed" ? "V6 index checkpoint" : "Historical snapshot block";
  const message = status === "unavailable"
    ? "Chain data unavailable. No unverified launches are shown."
    : status === "stale"
      ? "Chain data is stale. Showing the last verified records."
      : coverage === "verified-snapshot" ? "Verified historical snapshot." : "Verified legacy RMT index.";
  return <div className="lpNotice lpProjectLink" role="status">
    <span>{message}</span>
    {checkpoint && <span>{checkpointLabel} <a href={`${robinhoodExplorer}/block/${checkpoint.blockNumber}`}>{checkpoint.blockNumber}</a> · <ChainTime value={checkpoint.timestamp} /></span>}
    {observedAt && observedAt !== checkpoint?.timestamp && <span>Evidence checked <ChainTime value={observedAt} /></span>}
  </div>;
}
