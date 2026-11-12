import React, { type ReactNode } from "react";
// Presentation wrapper for the original RMT legal documents. Content stays in
// app/{terms,risks,privacy}/page.tsx; only the terminal navigation is excluded.
export function LegalShell({ title, updated, children }: { eyebrow?: string; title: string; updated: string; children: ReactNode }) {
  return <article className="rmtcat-legal" aria-label={title} tabIndex={0}><p><strong>{title}</strong> · Updated {updated}</p>{children}</article>;
}
