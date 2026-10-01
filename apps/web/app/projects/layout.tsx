import "../vnext/vnext-terminal.css";
import "./projects.css";
import Link from "next/link";
import { WalletButton } from "../wallet-button";
export default function ProjectsLayout({ children }: { children: React.ReactNode }) { return <div className="rmtProjectPage"><header className="rmtProjectHeader"><Link href="/" aria-label="RMT Markets"><img src="/brand/rmt-master-logo.png" alt="" /><strong>RMT</strong></Link><Link href="/projects">Projects</Link><span>Robinhood Chain · 4663</span><WalletButton target="mainnet" /></header>{children}</div>; }
