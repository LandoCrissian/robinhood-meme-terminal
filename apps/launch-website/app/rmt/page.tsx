import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Legacy RMT | RMT Launch" };

const explorer = "https://robinhoodchain.blockscout.com";
const issuances = [
  {
    title: "Official RMT V6 issuance",
    token: "0xdBa33be56C89CC9fc014c4459028d7e5c7878671",
    curve: "0xb26Fb775c0ac365d369BEe9ac2E044C5D90FfBee",
    block: "10387857",
    transaction: "0x4eb7b596ccdf5d0aa5e4c8d0d50311df5108b44f47d9d39d09b1916524d825d5",
    note: "The V6 launch 0 receipt records the original V4 token and the official V6 issuance.",
  },
  {
    title: "Original RMT V4 issuance",
    token: "0xaB374D24aFBD943a134AdB381D9646e71C6f6C0C",
    curve: "0xfeee90288a7037fbdb4ec5b05dc7cc5e762d5fb7",
    block: "9156510",
    transaction: "0xe5cd6ed09a3cccae743b7c29c0ee0971f3797986bce171eadc3642de60b3410b",
    note: "V4 launch 1 is the legacy identity recorded by the V6 factory. Each issuance has its own token supply and curve.",
  },
] as const;

export default function LegacyRmtPage() {
  return <>
    <header className="lpPageHeading">
      <div><h1>Legacy RMT</h1><p>Recorded issuances on Robinhood Chain · Chain ID 4663</p></div>
      <Link className="lpButton lpSecondary" href="/">Browse examples</Link>
    </header>
    <p className="lpNotice">Read-only preview. These records are separate from the sample launches. Verify RMT by network and contract address.</p>
    <div className="lpColumns">
      {issuances.map(({ title, token, curve, block, transaction, note }) => (
        <section className="lpPanel lpForm" key={token}>
          <h2>{title}</h2>
          <p>{note}</p>
          <dl className="lpFacts lpProjectLink">
            <dt>Token</dt><dd><a href={`${explorer}/address/${token}`}><code className="lpAddress">{token}</code></a></dd>
            <dt>Curve</dt><dd><a href={`${explorer}/address/${curve}`}><code className="lpAddress">{curve}</code></a></dd>
            <dt>Creation receipt</dt><dd><a href={`${explorer}/tx/${transaction}`}>Open on Blockscout</a></dd>
            <dt>Block</dt><dd><a href={`${explorer}/block/${block}`}>{block}</a></dd>
          </dl>
        </section>
      ))}
    </div>
  </>;
}
