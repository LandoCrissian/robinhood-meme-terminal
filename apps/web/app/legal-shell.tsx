import Link from "next/link";
import type { ReactNode } from "react";

export function LegalShell({ eyebrow, title, updated, children }: { eyebrow: string; title: string; updated: string; children: ReactNode }) {
  return (
    <main className="legalPage">
      <header className="legalHero panel">
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>Last updated: {updated}</p>
      </header>
      <article className="legalDocument panel">{children}</article>
      <footer className="legalFooter">
        <Link href="/terms">Terms</Link><Link href="/privacy">Privacy</Link><Link href="/risks">Risks</Link><Link href="/support">Support</Link><Link href="/status">System status</Link>
      </footer>
    </main>
  );
}
