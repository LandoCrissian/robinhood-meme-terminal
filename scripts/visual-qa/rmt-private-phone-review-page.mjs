// Serialized into an isolated static artifact. Keep all runtime dependencies inside this function.
export function privateReviewPage(config) {
  const field = (id) => document.getElementById(id);
  const panel = field("unlock-panel");
  const keyInput = field("unlock-key");
  const unlock = field("unlock");
  const connect = field("connect");
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
    keyInput.disabled = unlock.disabled = connect.disabled = true;
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
    if (ready()) hide("Wallet selection changed. Check the connection again.");
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
  function renderReview(verificationBlock) {
    const row = packet.operation;
    const verifiedAt = performance.now();
    const verifiedBlockTime = Number(BigInt(verificationBlock.timestamp)) * 1000;
    const quote = insert(review, "p");
    quote.id = "fee-status";
    quote.setAttribute("aria-live", "polite");
    const updateQuote = () => {
      const now = Math.max(Date.now(), verifiedBlockTime + performance.now() - verifiedAt);
      const expired = now >= Date.parse(packet.expiresAt);
      if (quote.dataset.expired === String(expired)) return;
      quote.dataset.expired = String(expired);
      quote.textContent = expired
        ? "Fee quote expired. Get a fresh quote before transaction approval."
        : "Unsigned review. Separate transaction approval is required.";
      price.textContent = expired ? "Expired · see recorded estimate" : eth(row.gas.estimatedFeeWei);
    };
    properties(review, [
      ["Sender", row.sender], ["Pending nonce", row.nonce], ["Proxy factory", row.destination], ["Value", eth(row.valueWei)],
      ["Est. network cost", "", "fee-value"], ["Expected Safe", row.predictedAddress],
      ["Safe setup", row.safeVersion + " · " + row.threshold + " of " + row.owners.length],
    ]);
    const price = field("fee-value");
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
      ["Wallet check block", BigInt(verificationBlock.number).toString()],
      ["Review digest", packet.planId],
    ]);
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
    status.textContent = "Wallet, pending nonce and Safe vacancy verified.";
    const refreshUntil = Math.min(config.expiryMs, Date.now() + 120_000);
    const tick = () => {
      if (!ready()) return;
      if (Date.now() >= refreshUntil) hide("Wallet verification expired. Check the current nonce again.");
      else {
        updateQuote();
        reviewTimeout = setTimeout(tick, Math.min(refreshUntil - Date.now(), 1000));
      }
    };
    reviewTimeout = setTimeout(tick, 1000);
  }

  if (!window.isSecureContext || window.top !== window || location.href !== config.url || !crypto.subtle) {
    hide("Open the exact approved HTTPS review address in the wallet browser.");
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
      connect.hidden = connect.disabled = false;
      status.textContent = "Review unlocked. Connect MetaMask on Robinhood Chain 4663 to check the pending nonce.";
    } catch {
      if (ready()) status.textContent = "Review could not be unlocked. Check the access code.";
    } finally {
      working = false;
      if (ready() && !packet) unlock.disabled = false;
    }
  };

  connect.onclick = async () => {
    if (working || !packet || !ready()) return;
    const provider = window.ethereum;
    if (!provider || typeof provider.request !== "function" || typeof provider.on !== "function") {
      hide("Open this review in MetaMask Mobile to check the account.");
      return;
    }
    working = true;
    connect.disabled = true;
    hide("Checking the account and deployment nonce.");
    let snapshot = ++revision;
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
      if (!providers.has(provider)) {
        for (const event of ["accountsChanged", "chainChanged", "disconnect"]) provider.on(event, selectionChanged);
        providers.add(provider);
      }
      await read("eth_requestAccounts");
      // Permission dialogs may emit a selection event before returning. Bind the reads after it returns.
      snapshot = revision;
      if (!accountMatches(await read("eth_accounts"))) return hide("Select the proposed deployment account in MetaMask.");
      if (!chainMatches(await read("eth_chainId"))) return hide("Select Robinhood Chain 4663 in MetaMask.");
      const anchorTag = "0x" + BigInt(packet.anchor.number).toString(16);
      const anchor = await read("eth_getBlockByNumber", [anchorTag, false]);
      if (!block(anchor) || anchor.number !== anchorTag || !matches(anchor.hash, packet.anchor.hash) ||
          BigInt(anchor.timestamp) * 1000n !== BigInt(Date.parse(packet.anchor.blockTimeUtc))) {
        return hide("The package observation block did not match. Refresh the unsigned package.");
      }
      const tip = await read("eth_getBlockByNumber", ["latest", false]);
      if (!currentBlock(tip) || BigInt(tip.number) < BigInt(anchorTag)) return hide("Current wallet block evidence is unavailable.");
      const [confirmed, pending, accountCode, delegateCode] = await Promise.all([
        read("eth_getTransactionCount", [packet.sender, tip.number]),
        read("eth_getTransactionCount", [packet.sender, "pending"]),
        read("eth_getCode", [packet.sender, tip.number]),
        read("eth_getCode", [packet.delegation.address, tip.number]),
      ]);
      if (!nonceMatches(confirmed) || !nonceMatches(pending)) return hide("The wallet nonce changed. Refresh the unsigned package.");
      if (!matches(accountCode, packet.delegation.designator)) return hide("The wallet delegation changed. Refresh the unsigned package.");
      if (typeof delegateCode !== "string" || delegateCode.length !== 2 + config.runtimeBytes * 2 ||
        !/^0x[0-9a-f]+$/i.test(delegateCode)) return hide("The wallet delegate runtime did not match.");
      const runtime = Uint8Array.from(delegateCode.slice(2).match(/../g), (byte) => Number.parseInt(byte, 16));
      const digest = await crypto.subtle.digest("SHA-256", runtime);
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
      renderReview(tip);
    } catch (error) {
      if (!ready()) return;
      if (!bound()) return selectionChanged();
      hide(error?.code === 4001 ? "Wallet connection was declined." : "Wallet evidence is unavailable. Check the connection again.");
    } finally {
      working = false;
      if (ready()) connect.disabled = false;
    }
  };
  window.addEventListener("pagehide", () => {
    revision++;
    if (ready() && packet) hide("Check the current nonce to view this review again.");
  });
}
