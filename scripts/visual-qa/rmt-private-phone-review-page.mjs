// Serialized into an isolated static artifact. Keep all runtime dependencies inside this function.
export function privateReviewPage(config) {
  const field = (id) => document.getElementById(id);
  const panel = field("unlock-panel");
  const keyInput = field("unlock-key");
  const unlock = field("unlock");
  const connect = field("connect");
  const status = field("status");
  const review = field("review");
  const unavailable = "Awaiting verified inputs";
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
    for (const [label, value] of rows) {
      insert(list, "dt", label);
      insert(list, "dd", value ?? unavailable);
    }
  }
  function eth(value) {
    if (value === null) return null;
    const amount = BigInt(value);
    const units = amount.toString().padStart(19, "0");
    const fraction = units.slice(-18).replace(/0+$/, "");
    return units.slice(0, -18) + (fraction ? "." + fraction : "") + " ETH";
  }
  function renderReview(number) {
    insert(review, "h2", "Unsigned deployment sequence");
    const quote = insert(review, "p");
    const updateQuote = () => {
      quote.textContent = Date.now() >= Date.parse(packet.expiresAt)
        ? "The fee snapshot has expired. Refresh the package before using any fee estimate."
        : "Fees reflect the recorded observation. Refresh the package before any owner-approved transaction.";
    };
    updateQuote();
    properties(review, [
      ["Wallet", packet.sender], ["Chain", "Robinhood Chain 4663"], ["Verified pending nonce", packet.pendingNonce],
      ["Wallet verification block", BigInt(number).toString()], ["Package observation block", packet.anchor.number + " · " + packet.anchor.hash],
      ["Fee snapshot captured", packet.observedAt], ["Fee snapshot expires", packet.expiresAt],
      ["Recorded balance", eth(packet.balanceWei)], ["Review digest", packet.planId],
    ]);
    insert(review, "h3", "Proposed first project terms");
    const terms = packet.terms;
    properties(review, [
      ["Fixed supply", terms.fixedSupplyTokens + " tokens · " + terms.decimals + " decimals"],
      ["Allocation", terms.curveTokens + " curve · " + terms.liquidityTokens + " locked initial liquidity"],
      ["Revenue share", terms.projectShareBps / 100 + "% project · " + terms.operationsShareBps / 100
        + "% Operations · " + terms.reserveShareBps / 100 + "% Reserve"],
      ["Creation fee", eth(terms.creationFeeWei)],
      ["Graduation backing", eth(terms.graduationBackingWei)],
      ["Curve fee", terms.curveFeeBps / 100 + "%"],
    ]);
    const label = new Map(packet.rows.map((row) => [row.id, row.label]));
    for (const [index, row] of packet.rows.entries()) {
      const stage = insert(review, "details");
      insert(stage, "summary", index + 1 + ". " + row.label);
      properties(stage, [
        ["Action", row.action], ["Status", row.status], ["Sender", row.sender], ["Nonce", row.nonce],
        ["Destination", row.destination ?? (row.predictedAddress ? "Direct contract creation" : null)],
        ["Predicted address", row.predictedAddress], ["Value", eth(row.valueWei)], ["Calldata hash", row.inputHash],
        ["Expected runtime hash", row.expectedRuntimeHash], ["Gas units", row.gas.gasUnits],
        ["L2 gas units", row.gas.l2GasUnits], ["L1 posting gas units", row.gas.l1PosterGasUnits],
        ["Estimated fee", eth(row.gas.estimatedFeeWei)], ["Fee evidence", row.gas.provenance],
        ["Prerequisites", row.dependsOn.map((id) => label.get(id)).join(", ") || "None"],
      ]);
      if (row.checks.length) {
        const list = insert(stage, "ul");
        for (const check of row.checks) insert(list, "li", check);
      }
    }
    if (packet.approvals.length) {
      insert(review, "h3", "Owner decisions pending");
      const list = insert(review, "ul");
      for (const approval of packet.approvals) insert(list, "li", approval.label);
    }
    review.hidden = false;
    status.textContent = "Wallet and pending nonce verified. This review is read-only.";
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
      if (!block(anchor) || anchor.number !== anchorTag || !matches(anchor.hash, packet.anchor.hash)) {
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
      const [canonical, canonicalAnchor, finalPending, finalAccounts, finalChain, liveCode] = await Promise.all([
        read("eth_getBlockByNumber", [tip.number, false]), read("eth_getBlockByNumber", [anchorTag, false]),
        read("eth_getTransactionCount", [packet.sender, "pending"]), read("eth_accounts"), read("eth_chainId"),
        read("eth_getCode", [packet.sender, "latest"]),
      ]);
      if (!ready()) return;
      if (!bound() || !accountMatches(finalAccounts) || !chainMatches(finalChain)) return selectionChanged();
      if (!sameBlock(tip, canonical) || !sameBlock(anchor, canonicalAnchor)) return hide("The observed block changed. Refresh the unsigned package.");
      if (!currentBlock(canonical)) return hide("Current wallet block evidence is unavailable.");
      if (!nonceMatches(finalPending)) return hide("The wallet nonce changed. Refresh the unsigned package.");
      if (!matches(liveCode, packet.delegation.designator)) return hide("The wallet delegation changed. Refresh the unsigned package.");
      renderReview(tip.number);
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
