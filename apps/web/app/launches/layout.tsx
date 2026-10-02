import Link from "next/link";
import { WalletButton } from "../wallet-button";
import "../vnext/vnext-terminal.css";
import "../projects/projects.css";
import "./launches.css";
const links = [
  { href: "/", label: "Markets" },
  { href: "/projects", label: "Projects" },
  { href: "/nft", label: "NFTs" },
  { href: "/?panel=portfolio", label: "Portfolio" },
  { href: "/?panel=distribution", label: "Distribution" },
];
function Navigation({ mobile = false }: { mobile?: boolean }) {
  return (
    <nav
      className={`rmtProjectPrimaryNav ${mobile ? "isMobile" : "isDesktop"}`}
      aria-label="RMT Terminal navigation"
    >
      {links.map((link) => (
        <Link
          key={link.label}
          href={link.href}
          aria-current={link.label === "Markets" ? "page" : undefined}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
export default function LaunchesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="rmtProjectPage rmtVnext rmtTerminal">
      <header className="rmtProjectHeader">
        <Link href="/" aria-label="RMT Markets">
          <img src="/brand/rmt-master-logo.png" alt="" />
          <strong>RMT</strong>
        </Link>
        <Navigation />
        <span>Robinhood Chain · 4663</span>
        <WalletButton target="mainnet" />
      </header>
      <Navigation mobile />
      {children}
    </div>
  );
}
