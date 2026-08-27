import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { robinhoodChain } from "@rmt/shared/chains";
import { readRmtNftItem, readRmtNftProjectMarket } from "../../../../lib/server/nft-project-market";
import { NftItemMedia } from "../../_components/nft-item-media";
import styles from "../project-market.module.css";
import itemStyles from "../inventory.module.css";

export const dynamic = "force-dynamic";

function short(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

export async function generateMetadata({ params }: { params: Promise<{ projectId: string; tokenId: string }> }): Promise<Metadata> {
  const { projectId, tokenId } = await params;
  return projectId.toLowerCase() === "ccff00" && /^(0|[1-9]\d*)$/.test(tokenId)
    ? { title: `CCFF00 Token #${tokenId} | RMT`, description: "Canonical CCFF00 ownership, onchain metadata, and ERC-6551 identity on Robinhood Chain." }
    : { robots: { index: false, follow: false } };
}

export default async function NftItemPage({ params }: { params: Promise<{ projectId: string; tokenId: string }> }) {
  const { projectId, tokenId } = await params;
  if (!/^(0|[1-9]\d*)$/.test(tokenId)) notFound();
  const [model, itemResult] = await Promise.all([readRmtNftProjectMarket(projectId), readRmtNftItem(projectId, tokenId)]);
  if (!model || itemResult === null) notFound();
  if (!("tokenId" in itemResult)) return <main className={styles.page}><section className={itemStyles.itemUnavailable}><p>RMT NFT TERMINAL</p><h1>Item data unavailable</h1><Link href={`/nft/${projectId}`}>Return to Project Market</Link></section></main>;
  const item = itemResult;
  const attribute = item.metadata.attributes.find((candidate) => candidate.traitType === "Color");
  const marketplace = "provider" in model.marketplace ? model.marketplace : null;
  const explorer = robinhoodChain.blockExplorers.default.url;
  const openSeaItem = marketplace ? `https://opensea.io/assets/robinhood/${item.collectionAddress}/${item.tokenId}` : null;

  return <main className={styles.page}>
    <nav className={itemStyles.breadcrumb}><Link href={`/nft/${model.project.projectId}`}>← {model.project.displayName} Project Market</Link></nav>
    <section className={itemStyles.itemWorkspace}>
      <NftItemMedia metadata={item.metadata} alt={`CCFF00 token ${item.tokenId}`} className={itemStyles.itemMedia} />
      <div className={itemStyles.itemDetails}>
        <p className={itemStyles.eyebrow}>RMT CURATED · ONCHAIN ITEM</p>
        <h1>#CCFF00</h1><h2>Token #{item.tokenId}</h2>
        <p className={itemStyles.itemDescription}>{item.metadata.description ?? "Metadata presentation unavailable."}</p>
        {attribute ? <dl className={itemStyles.traits}><div><dt>{attribute.traitType}</dt><dd>{attribute.value}</dd></div></dl> : null}
        <dl className={itemStyles.identityList}>
          <div><dt>Current owner</dt><dd><a href={`${explorer}/address/${item.owner}`} target="_blank" rel="noreferrer">{short(item.owner)} ↗</a></dd></div>
          <div><dt>ERC-6551 account</dt><dd><a href={`${explorer}/address/${item.tokenBoundAccount.accountAddress}`} target="_blank" rel="noreferrer">{short(item.tokenBoundAccount.accountAddress)} ↗</a></dd></div>
          <div><dt>Collection contract</dt><dd><a href={`${explorer}/address/${item.collectionAddress}`} target="_blank" rel="noreferrer">{short(item.collectionAddress)} ↗</a></dd></div>
          <div><dt>Chain</dt><dd>Robinhood Chain · 4663</dd></div>
          <div><dt>Metadata provenance</dt><dd>ONCHAIN TOKENURI</dd></div>
        </dl>
        <div className={itemStyles.itemActions}>{openSeaItem ? <a href={openSeaItem} target="_blank" rel="noreferrer">View on OpenSea ↗</a> : null}<a href={`${explorer}/token/${item.collectionAddress}/instance/${item.tokenId}`} target="_blank" rel="noreferrer">View on Blockscout ↗</a></div>
      </div>
    </section>
  </main>;
}
