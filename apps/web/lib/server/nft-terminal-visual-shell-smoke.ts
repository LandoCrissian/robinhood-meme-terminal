import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const chrome = read("../../app/public-chrome.tsx");
const layout = read("../../app/nft/layout.tsx");
const shell = read("../../app/nft/_components/nft-terminal-chrome.tsx");
const shellStyles = read("../../app/nft/nft-terminal-shell.module.css");
const catalog = read("../../app/nft/page.tsx");
const catalogStyles = read("../../app/nft/nft-terminal.module.css");
const project = read("../../app/nft/[projectId]/page.tsx");
const projectStyles = read("../../app/nft/[projectId]/project-market.module.css");
const inventoryStyles = read("../../app/nft/[projectId]/inventory.module.css");
const item = read("../../app/nft/[projectId]/[tokenId]/page.tsx");
const wallet = read("../../app/vnext/vnext-wallet-connection.tsx");

assert.match(chrome, /HIDDEN_PREFIXES[\s\S]*"\/nft"/);
assert.match(chrome, /pathname === prefix \|\| pathname\.startsWith\(`\$\{prefix\}\/(?:`|\$\{)/);
assert.match(layout, /data-nft-terminal-shell="v1"/);
assert.match(layout, /<NftTerminalChrome \/>/);
assert.match(layout, /id="nft-terminal-content"/);
assert.match(shell, /data-nft-terminal-header/);
assert.match(shell, /RMT Markets/);
assert.match(shell, /Robinhood Chain 4663/);
assert.match(shell, /Markets[\s\S]*NFTs[\s\S]*Portfolio[\s\S]*Distribution/);
assert.match(shell, /aria-current=\{link\.active \? "page"/);
assert.match(shell, /VNextRouteWalletConnection/);
assert.match(wallet, /<WalletButton target="mainnet" returnTo=\{returnTo\}/);
assert.match(shellStyles, /grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/);
assert.match(shellStyles, /env\(safe-area-inset-top\)/);
assert.match(shellStyles, /env\(safe-area-inset-bottom\)/);
assert.doesNotMatch(shell, /three-dot|mobileDock|publicHeader|publicMore/i);
assert.doesNotMatch(shellStyles, /position:fixed[\s\S]{0,100}bottom:0/);

assert.match(catalog, /<h1>NFTs<\/h1>/);
assert.match(catalog, /Active[\s\S]*Recently Added[\s\S]*Collections/);
assert.match(catalog, /catalog\.projects\.length/);
assert.match(catalog, /canonical inventory preview/);
assert.match(catalogStyles, /\.metrics\{[\s\S]*grid-template-columns:repeat\(4/);
assert.doesNotMatch(catalogStyles, /font-size:clamp\([^)]*5(?:\.|rem)/);

assert.match(project, /limit: 24/);
assert.match(project, /LOWEST OPENSEA LISTING/);
assert.match(project, /OPENSEA REPORTED SALE/);
assert.match(project, /market meaning not established/);
assert.match(projectStyles, /grid-template-columns:repeat\(4/);
assert.match(inventoryStyles, /grid-template-columns:repeat\(6/);
assert.match(inventoryStyles, /@media\(max-width:700px\)[\s\S]*grid-template-columns:repeat\(2/);
assert.match(item, /TOKENURI|Metadata provenance/);
assert.match(item, /ERC-6551 account/);
assert.doesNotMatch([catalog, project, item].join("\n"), />\s*(BUY|LIST|OFFER|ACCEPT|SWEEP)\s*</i);

console.info("NFT Terminal VNext visual route shell smoke: PASS");
