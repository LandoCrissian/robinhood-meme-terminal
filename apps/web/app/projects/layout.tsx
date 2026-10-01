import "../vnext/vnext-terminal.css";
import "./projects.css";
import Link from "next/link";
import { WalletButton } from "../wallet-button";
const primaryLinks = [{ href: "/", label: "Markets" }, { href: "/projects", label: "Projects" }, { href: "/nft", label: "NFTs" }, { href: "/?panel=portfolio", label: "Portfolio" }, { href: "/?panel=distribution", label: "Distribution" }] as const;
function ProjectNavigation({ mobile = false }: { mobile?: boolean }) { return <nav className={`rmtProjectPrimaryNav ${mobile ? "isMobile" : "isDesktop"}`} aria-label="RMT Terminal navigation">{primaryLinks.map(link => <Link key={link.label} href={link.href} aria-current={link.label === "Projects" ? "page" : undefined}>{link.label}</Link>)}</nav>; }
export default function ProjectsLayout({ children }: { children: React.ReactNode }) { return <div className="rmtProjectPage"><header className="rmtProjectHeader"><Link href="/" aria-label="RMT Markets"><img src="/brand/rmt-master-logo.png" alt="" /><strong>RMT</strong></Link><ProjectNavigation /><span>Robinhood Chain · 4663</span><WalletButton target="mainnet" /></header><ProjectNavigation mobile />{children}</div>; }
