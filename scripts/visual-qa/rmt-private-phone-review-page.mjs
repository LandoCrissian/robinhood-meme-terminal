// Serialized into an isolated static artifact. Keep all runtime dependencies inside this function.
export function privateReviewPage(config) {
  const field = (id) => document.getElementById(id);
  const panel = field("unlock-panel");
  const keyInput = field("unlock-key");
  const unlock = field("unlock");
  const status = field("status");
  const review = field("review");
  const providers = new WeakSet();
  const encoder = new TextEncoder();
  let packet;
  let revision = 0;
  let working = false;
  let reviewTimeout;

  const matches = (value, expected) => typeof value === "string" && value.toLowerCase() === expected.toLowerCase();
  const quantity = (value) => typeof value === "string" && /^0x(?:0|[1-9a-f][0-9a-f]{0,15})$/i.test(value);
  const hash = (value) => typeof value === "string" && /^0x[0-9a-f]{64}$/i.test(value);
  const block = (value) => value && quantity(value.number) && hash(value.hash) && quantity(value.timestamp);
  const currentBlock = (value) => block(value) && Math.abs(Date.now() / 1000 - Number(BigInt(value.timestamp))) <= 180;
  const sameBlock = (a, b) => block(b) && a.number === b.number && matches(a.hash, b.hash) && a.timestamp === b.timestamp;
  const decode = (value) => Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  const ready = () => {
    if (Date.now() < config.expiryMs) return true;
    packet = undefined;
    keyInput.value = "";
    keyInput.disabled = unlock.disabled = true;
    hide("This private review copy has expired.");
    return false;
  };
  function hide(message) {
    clearTimeout(reviewTimeout);
    review.hidden = true;
    review.replaceChildren();
    status.textContent = message;
  }
  function selectionChanged() {
    revision++;
    if (packet && ready()) hide("Wallet selection changed. Refresh the unsigned review.");
  }
  function insert(target, tag, content) {
    const element = document.createElement(tag);
    if (content !== undefined) element.textContent = content;
    target.append(element);
    return element;
  }
  function properties(target, rows) {
    const list = insert(target, "dl");
    for (const [label, value, id] of rows) {
      insert(list, "dt", label);
      const data = insert(list, "dd", value);
      if (id) data.id = id;
    }
  }
  function details(target, label) {
    const item = insert(target, "details");
    insert(item, "summary", label);
    return item;
  }
  function eth(value) {
    const amount = BigInt(value);
    const units = amount.toString().padStart(19, "0");
    const fraction = units.slice(-18).replace(/0+$/, "");
    return units.slice(0, -18) + (fraction ? "." + fraction : "") + " ETH";
  }
  function renderReview() {
    const row = packet.operation;
    const verifiedAt = performance.now();
    const verifiedBlockTime = Date.parse(packet.observedAt);
    const quote = insert(review, "p");
    quote.id = "fee-status";
    quote.setAttribute("aria-live", "polite");
    const archivedMessage = row.feeCap ? "Fee quote expired. Get a fresh quote before transaction approval."
      : "Archived quote without a fee cap. Get a fresh quote before transaction approval.";
    const updateQuote = () => {
      const now = Math.max(Date.now(), verifiedBlockTime + performance.now() - verifiedAt);
      const expired = !row.feeCap || now >= Date.parse(packet.expiresAt);
      if (quote.dataset.expired === String(expired)) return;
      quote.dataset.expired = String(expired);
      quote.textContent = expired ? archivedMessage : "Unsigned review. Separate transaction approval is required.";
      const recorded = expired ? " · recorded" : "";
      price.textContent = eth(row.gas.estimatedFeeWei) + recorded;
      cap.textContent = row.feeCap ? eth(row.feeCap.maxNetworkFeeWei) + recorded : "Unavailable";
    };
    properties(review, [
      ["Sender", row.sender], ["Pending nonce", row.nonce], ["Proxy factory", row.destination], ["Value", eth(row.valueWei)],
      ["Est. network cost", "", "fee-value"], ["Proposed fee cap", "", "fee-cap"], ["Expected Safe", row.predictedAddress],
      ["Safe setup", row.safeVersion + " · " + row.threshold + " of " + row.owners.length],
    ]);
    const price = field("fee-value");
    const cap = field("fee-cap");
    updateQuote();
    const safeDetails = details(review, "Calldata hash and Safe owners");
    properties(safeDetails, [
      ["Action", row.action], ["Calldata hash", row.inputHash], ["Salt nonce", row.saltNonce],
      ["Initializer hash", row.initializerHash], ["Expected Safe runtime hash", row.expectedRuntimeHash],
    ]);
    const owners = insert(safeDetails, "ol");
    for (const owner of row.owners) insert(owners, "li", owner);
    const evidence = details(review, "Gas and on-chain evidence");
    properties(evidence, [
      ["Recorded network estimate", eth(row.gas.estimatedFeeWei)], ["Recorded L2 cost", eth(row.gas.estimatedL2FeeWei)],
      ["Recorded L1 posting cost", eth(row.gas.estimatedL1FeeWei)], ["Estimated total gas", row.gas.gasUnits],
      ["L2 gas units", row.gas.l2GasUnits], ["L1 posting gas units", row.gas.l1PosterGasUnits],
      ["Estimated at", packet.observedAt], ["Quote expiry", packet.expiresAt],
      ["Quote block", packet.anchor.number + " · " + packet.anchor.hash],
      ["Wallet check block", "Unavailable", "wallet-check-block"],
      ["Review digest", packet.planId],
    ]);
    if (row.feeCap) {
      properties(evidence, [
        ["Proposed gas limit", row.feeCap.gasLimit], ["Max fee per gas", row.feeCap.maxFeePerGasWei + " wei"],
        ["Max priority fee per gas", row.feeCap.maxPriorityFeePerGasWei + " wei"],
      ]);
      insert(evidence, "p", "The gas limit adds 25% to the larger of the RPC and Nitro gas estimates. The gas estimate accounts for L1 posting gas. The fee per gas cap uses twice the sampled L2 base fee, with a zero priority fee.");
    }
    const checks = insert(evidence, "ul");
    for (const check of row.checks) insert(checks, "li", check);

    const terms = packet.terms;
    const project = packet.firstProject;
    properties(details(review, "Approved RMT project configuration"), [
      ["Name and ticker", project.name + " · " + project.symbol], ["Creator", project.creator], ["Project URI", "Empty"],
      ["Separate project treasury", project.treasuryShareBpsOfEligibleFees / 100 + "%"],
      ["Fixed supply", Number(terms.fixedSupplyTokens).toLocaleString("en-US") + " tokens · " + terms.decimals + " decimals"],
      ["Allocation", Number(terms.curveTokens).toLocaleString("en-US") + " curve · "
        + Number(terms.liquidityTokens).toLocaleString("en-US") + " locked initial liquidity"],
      ["Revenue share", terms.projectShareBps / 100 + "% project · " + terms.operationsShareBps / 100
        + "% Operations · " + terms.reserveShareBps / 100 + "% Reserve"],
      ["Creation fee", eth(terms.creationFeeWei)],
      ["Graduation backing", eth(terms.graduationBackingWei)],
      ["Curve fee", terms.curveFeeBps / 100 + "%"], ["v4 pool fee", (terms.v4PoolFeeBps / 100).toFixed(2) + "%"],
    ]);
    review.hidden = false;
    status.textContent = "Recorded chain evidence. Current wallet state is unverified.";
    const tick = () => {
      if (!ready()) return;
      updateQuote();
      reviewTimeout = setTimeout(tick, 1000);
    };
    reviewTimeout = setTimeout(tick, 1000);
  }

  if (!window.isSecureContext || window.top !== window || location.href !== config.url || !crypto.subtle) {
    hide("Open the exact approved HTTPS review address.");
    return;
  }
  if (!ready()) return;
  keyInput.disabled = unlock.disabled = false;
  status.textContent = "Enter the access code supplied separately for this review.";
  unlock.onclick = async () => {
    if (working || packet || !ready()) return;
    working = true;
    unlock.disabled = true;
    const code = keyInput.value.trim();
    keyInput.value = "";
    try {
      if (!/^[A-Za-z0-9_-]{43}$/.test(code)) throw new Error("Invalid access code");
      const bytes = decode(code.replace(/-/g, "+").replace(/_/g, "/") + "=");
      const key = await crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["decrypt"]);
      bytes.fill(0);
      const plaintext = await crypto.subtle.decrypt({
        name: "AES-GCM", iv: decode(config.iv), additionalData: encoder.encode(config.binding), tagLength: 128,
      }, key, decode(config.payload));
      if (!ready()) return;
      packet = JSON.parse(new TextDecoder().decode(plaintext));
      panel.hidden = true;
      renderReview();
      void checkExposedWallet();
    } catch {
      if (ready()) status.textContent = "Review could not be unlocked. Check the access code.";
    } finally {
      working = false;
      if (ready() && !packet) unlock.disabled = false;
    }
  };

  async function checkExposedWallet() {
    if (!packet || !ready()) return;
    const provider = window.ethereum;
    if (!provider || typeof provider.request !== "function") return;
    const snapshot = ++revision;
    const request = provider.request;
    const bound = () => snapshot === revision && provider === window.ethereum && request === provider.request;
    const read = (method, params) => {
      if (!ready() || !bound()) throw new Error("Wallet selection changed");
      return request.call(provider, { method, ...(params && { params }) });
    };
    const accountMatches = (accounts) => Array.isArray(accounts) && matches(accounts[0], packet.sender);
    const chainMatches = (chain) => matches(chain, "0x1237");
    const nonceMatches = (nonce) => quantity(nonce) && BigInt(nonce).toString() === packet.pendingNonce;
    try {
      if (typeof provider.on === "function" && !providers.has(provider)) {
        for (const event of ["accountsChanged", "chainChanged", "disconnect"]) provider.on(event, selectionChanged);
        providers.add(provider);
      }
      const accounts = await read("eth_accounts");
      if (!ready() || !bound()) return;
      if (!Array.isArray(accounts)) throw new Error("Wallet account evidence is malformed");
      if (accounts.length === 0) {
        status.textContent = "Recorded chain evidence. This wallet has no existing review access.";
        return;
      }
      if (!accountMatches(accounts)) return hide("The selected wallet account differs from the reviewed sender.");
      const chain = await read("eth_chainId");
      if (!ready() || !bound()) return;
      if (!chainMatches(chain)) return hide("The selected wallet chain differs from Robinhood Chain 4663.");
      const anchorTag = "0x" + BigInt(packet.anchor.number).toString(16);
      const anchor = await read("eth_getBlockByNumber", [anchorTag, false]);
      if (!ready() || !bound()) return;
      if (!block(anchor) || anchor.number !== anchorTag || !matches(anchor.hash, packet.anchor.hash) ||
          BigInt(anchor.timestamp) * 1000n !== BigInt(Date.parse(packet.anchor.blockTimeUtc))) {
        return hide("The package observation block did not match. Refresh the unsigned package.");
      }
      const tip = await read("eth_getBlockByNumber", ["latest", false]);
      if (!ready() || !bound()) return;
      if (!currentBlock(tip) || BigInt(tip.number) < BigInt(anchorTag)) return hide("Current wallet block evidence is unavailable.");
      const [confirmed, pending, accountCode, delegateCode] = await Promise.all([
        read("eth_getTransactionCount", [packet.sender, tip.number]),
        read("eth_getTransactionCount", [packet.sender, "pending"]),
        read("eth_getCode", [packet.sender, tip.number]),
        read("eth_getCode", [packet.delegation.address, tip.number]),
      ]);
      if (!ready() || !bound()) return;
      if (!nonceMatches(confirmed) || !nonceMatches(pending)) return hide("The wallet nonce changed. Refresh the unsigned package.");
      if (!matches(accountCode, packet.delegation.designator)) return hide("The wallet delegation changed. Refresh the unsigned package.");
      if (typeof delegateCode !== "string" || delegateCode.length !== 2 + config.runtimeBytes * 2 ||
        !/^0x[0-9a-f]+$/i.test(delegateCode)) return hide("The wallet delegate runtime did not match.");
      const runtime = Uint8Array.from(delegateCode.slice(2).match(/../g), (byte) => Number.parseInt(byte, 16));
      const digest = await crypto.subtle.digest("SHA-256", runtime);
      if (!ready() || !bound()) return;
      const actual = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
      if (actual !== config.runtimeSha256) return hide("The wallet delegate runtime did not match.");
      const [canonical, canonicalAnchor, finalPending, finalAccounts, finalChain, liveCode, safeCode, safeNonce] = await Promise.all([
        read("eth_getBlockByNumber", [tip.number, false]), read("eth_getBlockByNumber", [anchorTag, false]),
        read("eth_getTransactionCount", [packet.sender, "pending"]), read("eth_accounts"), read("eth_chainId"),
        read("eth_getCode", [packet.sender, "latest"]), read("eth_getCode", [packet.operation.predictedAddress, "pending"]),
        read("eth_getTransactionCount", [packet.operation.predictedAddress, "pending"]),
      ]);
      if (!ready()) return;
      if (!bound() || !accountMatches(finalAccounts) || !chainMatches(finalChain)) return selectionChanged();
      if (!sameBlock(tip, canonical) || !sameBlock(anchor, canonicalAnchor)) return hide("The observed block changed. Refresh the unsigned package.");
      if (!currentBlock(canonical)) return hide("Current wallet block evidence is unavailable.");
      if (!nonceMatches(finalPending)) return hide("The wallet nonce changed. Refresh the unsigned package.");
      if (!matches(liveCode, packet.delegation.designator)) return hide("The wallet delegation changed. Refresh the unsigned package.");
      if (safeCode !== "0x" || safeNonce !== "0x0") return hide("The expected Safe vacancy could not be verified. Refresh the unsigned package.");
      field("wallet-check-block").textContent = BigInt(tip.number).toString();
      status.textContent = "Existing wallet selection, nonce and Safe vacancy matched the review.";
    } catch {
      if (!ready()) return;
      if (bound()) status.textContent = "Recorded chain evidence. Current wallet reads are unavailable.";
    }
  }
  window.addEventListener("pagehide", () => {
    revision++;
    if (!ready() || !packet) return;
    packet = undefined;
    panel.hidden = false;
    keyInput.disabled = unlock.disabled = false;
    hide("Enter the access code to reopen this review.");
  });
}
