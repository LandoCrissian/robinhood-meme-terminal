import React, { type ReactNode } from "react";

// A single 24px, 1.75px-stroke vocabulary; no font glyphs or mixed icon packs.
const paths = {
  copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V4H4v12h4" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  external: <><path d="M14 4h6v6M20 4l-9 9M10 4H4v16h16v-6" /></>,
  website: <><circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="12" rx="4" ry="9" /><path d="M3 12h18" /></>,
  x: <path d="m5 4 14 16h-4L5 8V4Zm14 0L5 20" />,
  telegram: <path d="m3 11 18-7-4 16-6-6 10-10M11 14l-1 5" />,
  discord: <><path d="M7 5 4 7 2 17l5 2 2-3h6l2 3 5-2-2-10-3-2M7 5h10" /><circle cx="8" cy="12" r="1" /><circle cx="16" cy="12" r="1" /></>,
  farcaster: <><path d="M4 20V5h16v15M8 20v-5a4 4 0 0 1 8 0v5M2 20h6m8 0h6" /></>,
  activity: <path d="M2 12h4l3-8 6 16 3-8h4" />,
  holders: <><circle cx="9" cy="8" r="3" /><path d="M3 20v-2a6 6 0 0 1 12 0v2M17 5a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 4v2" /></>,
  project: <><rect x="3" y="3" width="6" height="6" rx="1" /><rect x="15" y="15" width="6" height="6" rx="1" /><path d="M6 9v9h9M9 6h9v9" /></>,
  position: <><path d="M3 6h18v14H3zM3 6V3h14M15 11h6v5h-6z" /></>,
  more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
  market: <path d="M4 20V10m8 10V4m8 16V7M2 20h20" />,
  search: <><circle cx="10" cy="10" r="6" /><path d="m15 15 6 6" /></>,
  chevron: <path d="m6 9 6 6 6-6" />,
  chart: <><path d="M5 4v16M2 8h6v8H2zM17 2v18m-3-14h6v7h-6z" /></>,
} satisfies Record<string, ReactNode>;

export type TerminalIconName = keyof typeof paths;
export function TerminalIcon({ name }: { name: TerminalIconName }) {
  return <svg className="rmtIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[name]}</svg>;
}
