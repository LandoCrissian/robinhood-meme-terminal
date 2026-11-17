// Serialized into the authenticated static artifact. Keep browser dependencies inside this function.
export function ownerSafePage(encrypted) {
  const element = (id) => document.getElementById(id);
  const status = (message) => { element("status").textContent = message; };
  const accessKey = "rmt-owner-safe-access:" + encrypted.endpoint;
  const journalKey = "rmt-owner-safe-request-v1:" + encrypted.endpoint;
  const decode = (value) => Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  const same = (a, b) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
  const quantity = (value) => typeof value === "string" && /^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/i.test(value);
  const hash = (value) => typeof value === "string" && /^0x[0-9a-f]{64}$/i.test(value);
  const hex = (value) => "0x" + BigInt(value).toString(16);
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const abiAddress = (value) => typeof value === "string" && /^0x0{24}[0-9a-f]{40}$/i.test(value)
    ? "0x" + value.slice(-40) : undefined;
  const ether = (value) => {
    const digits = BigInt(value).toString().padStart(19, "0");
    const fraction = digits.slice(-18).replace(/0+$/, "");
    return digits.slice(0, -18) + (fraction ? "." + fraction : "") + " ETH";
  };
  let configuration;
  let provider;
  let revision = 0;
  let busy = false;
  let review;
  let journal;

  function invalidate(message) {
    revision++;
    review = undefined;
    element("approve").checked = false;
    element("send").disabled = true;
    element("approval-label").hidden = true;
    status(message);
  }
  function storageRead() {
    const raw = localStorage.getItem(journalKey);
    if (raw === null) return undefined;
    assert(raw.length < 20_000, "Stored transaction journal is too large. Preserve it and use recovery.");
    const value = JSON.parse(raw);
    assert(value.schemaVersion === 1 && value.origin === encrypted.endpoint &&
      same(value.request?.from, configuration.sender) && same(value.request?.to, configuration.operation.to) &&
      value.request?.data === configuration.operation.data && value.request?.value === "0x0" &&
      value.request?.chainId === configuration.chainId && value.request?.type === "0x2" &&
      ["nonce", "gas", "maxFeePerGas", "maxPriorityFeePerGas"].every((name) => quantity(value.request[name])) &&
      quantity(value.startBlock) && ["requested", "pending", "confirmed", "reverted", "rejected", "mismatch"].includes(value.phase) &&
      (value.hash === null || hash(value.hash)), "Stored journal is invalid. Preserve it and resolve the original transaction.");
    return value;
  }
  function storageWrite(value) {
    localStorage.setItem(journalKey, JSON.stringify(value));
    assert(localStorage.getItem(journalKey) === JSON.stringify(value), "Transaction journal could not be saved.");
    journal = value;
  }
  function renderingAllowed() {
    assert(location.href === encrypted.endpoint, "This page is outside the reviewed HTTPS origin.");
    assert(configuration && window.isSecureContext && navigator.locks, "This wallet browser lacks secure transaction locking.");
  }
  async function run(task) {
    if (busy) return;
    busy = true;
    for (const name of ["connect", "refresh", "recover"]) element(name).disabled = true;
    element("send").disabled = true;
    try { await task(); }
    catch (error) { invalidate(error.message || "The operation could not be verified. Recover before retrying."); }
    finally {
      busy = false;
      for (const name of ["connect", "refresh", "recover"]) element(name).disabled = false;
      element("send").disabled = !review || !element("approve").checked || (journal && journal.phase !== "rejected");
    }
  }
  async function read(method, params = []) {
    assert(provider && provider === window.ethereum, "The selected wallet provider changed.");
    return provider.request({ method, params });
  }
  async function codeMatches(code, pin) {
    assert(typeof code === "string" && /^0x(?:[0-9a-f]{2})+$/i.test(code) &&
      (code.length - 2) / 2 === pin.byteLength, "Contract runtime bytes differ from the reviewed implementation.");
    const bytes = Uint8Array.from(code.slice(2).match(/../g), (pair) => Number.parseInt(pair, 16));
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const actual = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    assert(actual === pin.sha256, "Contract runtime identity changed.");
  }
  function validBlock(block) {
    return block && quantity(block.number) && hash(block.hash) && quantity(block.timestamp) && quantity(block.gasLimit)
      && Math.abs(Date.now() / 1000 - Number(BigInt(block.timestamp))) < 180;
  }
  async function identify() {
    renderingAllowed();
    const [accounts, chain] = await Promise.all([read("eth_accounts"), read("eth_chainId")]);
    assert(Array.isArray(accounts) && accounts.length && same(accounts[0], configuration.sender),
      "Select the approved personal MetaMask account.");
    assert(same(chain, configuration.chainId), "Select Robinhood Chain 4663.");
    return accounts[0];
  }
  async function observe() {
    const generation = revision;
    await identify();
    const op = configuration.operation;
    const block = await read("eth_getBlockByNumber", ["latest", false]);
    assert(validBlock(block), "Current canonical block evidence is unavailable.");
    const tag = block.number;
    const [confirmedNonce, pendingNonce, balance, accountCode, pendingCode, vacancyCode, vacancyNonce, pendingVacancyCode, pendingVacancyNonce] = await Promise.all([
      read("eth_getTransactionCount", [configuration.sender, tag]), read("eth_getTransactionCount", [configuration.sender, "pending"]),
      read("eth_getBalance", [configuration.sender, tag]), read("eth_getCode", [configuration.sender, tag]),
      read("eth_getCode", [configuration.sender, "pending"]), read("eth_getCode", [op.expectedAddress, tag]),
      read("eth_getTransactionCount", [op.expectedAddress, tag]), read("eth_getCode", [op.expectedAddress, "pending"]),
      read("eth_getTransactionCount", [op.expectedAddress, "pending"]),
    ]);
    assert(quantity(confirmedNonce) && quantity(pendingNonce) && BigInt(confirmedNonce) === BigInt(pendingNonce),
      "The sender has a pending transaction. Recover it before preparing another.");
    assert(quantity(balance), "The available balance could not be verified.");
    assert(same(accountCode, configuration.delegate.designator) && same(pendingCode, accountCode),
      "The wallet delegation differs from the reviewed implementation.");
    assert(vacancyCode === "0x" && pendingVacancyCode === "0x" && quantity(vacancyNonce) && quantity(pendingVacancyNonce) &&
      BigInt(vacancyNonce) === 0n && BigInt(pendingVacancyNonce) === 0n,
    "The expected Safe address is occupied or its vacancy is unverified.");
    for (const pin of [...configuration.runtimePins, configuration.delegate]) {
      const [code, pending] = await Promise.all([read("eth_getCode", [pin.address, tag]), read("eth_getCode", [pin.address, "pending"])]);
      await codeMatches(code, pin);
      assert(same(code, pending), "A pending runtime differs from the reviewed implementation.");
    }
    const request = { type: "0x2", chainId: configuration.chainId, from: configuration.sender, to: op.to,
      data: op.data, value: "0x0", nonce: hex(pendingNonce) };
    const [simulated, estimatedGas, components, priority, gasPrice] = await Promise.all([
      read("eth_call", [request, tag]), read("eth_estimateGas", [request, tag]),
      read("eth_call", [{ from: configuration.sender, to: "0x00000000000000000000000000000000000000c8", value: "0x0", data: configuration.nitroData }, tag]),
      read("eth_maxPriorityFeePerGas"), read("eth_gasPrice"),
    ]);
    assert(same(abiAddress(simulated), op.expectedAddress), "The exact Safe creation simulation returned a different address.");
    assert(quantity(estimatedGas) && quantity(priority) && quantity(gasPrice) &&
      typeof components === "string" && /^0x[0-9a-f]{256}$/i.test(components), "Live wallet fee evidence is unavailable.");
    const values = components.slice(2).match(/.{64}/g).map((word) => BigInt("0x" + word));
    const [total, l1, baseFee, l1BaseFee] = values;
    assert(total > 0n && l1 >= 0n && l1 <= total && baseFee > 0n && l1BaseFee >= 0n,
      "The L1/L2 gas components are inconsistent.");
    const estimate = BigInt(estimatedGas) > total ? BigInt(estimatedGas) : total;
    const gas = (estimate * 5n + 3n) / 4n;
    const tip = BigInt(priority);
    const proposed = baseFee * 2n + tip;
    const maxPrice = proposed > BigInt(gasPrice) ? proposed : BigInt(gasPrice);
    assert(gas > 0n && gas <= BigInt(block.gasLimit) && maxPrice > 0n && tip <= maxPrice &&
      BigInt(balance) >= gas * maxPrice, "The proposed fee bounds exceed available funds or network limits.");
    const canonical = await read("eth_getBlockByNumber", [tag, false]);
    const finalPending = await read("eth_getTransactionCount", [configuration.sender, "pending"]);
    await identify();
    assert(canonical?.hash === block.hash && canonical.number === tag && finalPending === pendingNonce && revision === generation,
      "Wallet, nonce or block evidence changed. Review live costs again.");
    return { request: { ...request, gas: hex(gas), maxFeePerGas: hex(maxPrice), maxPriorityFeePerGas: hex(tip) },
      block: { number: tag, hash: block.hash }, currentBaseFeeWei: baseFee.toString(), estimatedWei: (total * baseFee).toString(),
      l1Wei: (l1 * baseFee).toString(), l2Wei: ((total - l1) * baseFee).toString(), maximumWei: (gas * maxPrice).toString() };
  }
  function facts(next) {
    const target = element("facts");
    target.replaceChildren();
    const dl = document.createElement("dl");
    const rows = [["Sender", configuration.sender], ["Action", "Create Operations SafeL2 1.4.1"],
      ["Value", "0 ETH"], ["Expected Safe", configuration.operation.expectedAddress],
      ["Nonce", BigInt(next.request.nonce).toString()], ["Network estimate", ether(next.estimatedWei)],
      ["Maximum network cost", ether(next.maximumWei)], ["Included L1 posting estimate", ether(next.l1Wei)],
      ["Gas limit", BigInt(next.request.gas).toString()], ["Maximum fee per gas", BigInt(next.request.maxFeePerGas).toString() + " wei"],
      ["Priority fee per gas", BigInt(next.request.maxPriorityFeePerGas).toString() + " wei"],
      ["Calldata hash", configuration.operation.dataHash], ["Owners", configuration.operation.owners.join(" · ")],
      ["Approvals", "2 of 3"]];
    for (const [label, value] of rows) {
      const dt = document.createElement("dt");
      const dd = document.createElement("dd");
      dt.textContent = label;
      dd.textContent = value;
      dl.append(dt, dd);
    }
    target.append(dl);
    if (BigInt(next.maximumWei) > BigInt(configuration.earlierFeeCeilingWei)) {
      const p = document.createElement("p");
      p.textContent = "This maximum exceeds the earlier reviewed " + ether(configuration.earlierFeeCeilingWei) +
        " ceiling. Your new explicit approval below applies to the displayed cost.";
      target.append(p);
    }
    element("approval-label").hidden = false;
    element("approve").checked = false;
    element("send").disabled = true;
  }
  async function refresh() {
    renderingAllowed();
    journal = storageRead();
    assert(!journal || journal.phase === "rejected", "The original transaction is pending or recorded. Use recovery.");
    review = await observe();
    facts(review);
    status("Review the live costs, then approve this exact transaction before opening MetaMask.");
  }
  async function send() {
    renderingAllowed();
    assert(review && element("approve").checked, "Approve the displayed maximum cost first.");
    await navigator.locks.request(journalKey, { ifAvailable: true }, async (lock) => {
      assert(lock, "Another tab is processing this transaction.");
      const stored = storageRead();
      assert(!stored || stored.phase === "rejected", "An original request already exists. Use recovery.");
      const next = await observe();
      const reviewedBlock = await read("eth_getBlockByNumber", [review.block.number, false]);
      const identityFields = ["type", "chainId", "from", "to", "data", "value", "nonce"];
      const sameIdentity = identityFields.every((field) => same(next.request[field], review.request[field]));
      const fitsApprovedBounds = BigInt(next.request.gas) <= BigInt(review.request.gas) &&
        BigInt(next.currentBaseFeeWei) + BigInt(review.request.maxPriorityFeePerGas) <= BigInt(review.request.maxFeePerGas);
      if (!sameIdentity || !fitsApprovedBounds || reviewedBlock?.hash !== review.block.hash) {
        review = next;
        facts(next);
        status("The live nonce, canonical block or required cost exceeds the reviewed bounds. Review and approve the updated transaction before opening MetaMask.");
        return;
      }
      // Keep every fee field the owner already approved. A changed recommendation
      // within those bounds never substitutes a higher fee or restarts approval.
      const request = structuredClone(review.request);
      storageWrite({ schemaVersion: 1, origin: encrypted.endpoint, phase: "requested", request,
        startBlock: next.block.number, reviewBlockHash: next.block.hash, hash: null });
      review = undefined;
      element("approve").checked = false;
      element("approval-label").hidden = true;
      status("Confirm the exact transaction and network cost in MetaMask. The wallet signs and broadcasts only with your confirmation.");
      try {
        const result = await read("eth_sendTransaction", [request]);
        if (hash(result)) storageWrite({ ...journal, hash: result, phase: "pending" });
        status(hash(result) ? "Transaction submitted. Check its receipt using recovery." :
          "The wallet returned no hash. The original request is saved. Recover it without submitting again.");
        if (hash(result)) element("recovery-hash").value = result;
      } catch (error) {
        if (error?.code === 4001) {
          storageWrite({ ...journal, phase: "rejected" });
          status("MetaMask rejected the request. Review live costs again when ready.");
        } else status("Wallet submission was interrupted. Recover the saved original request before any retry.");
      }
    });
  }
  function exactTransaction(tx, request) {
    return tx && ["from", "to", "input", "chainId", "type", "value", "nonce", "gas", "maxFeePerGas", "maxPriorityFeePerGas"]
      .every((key) => same(tx[key], request[key === "input" ? "data" : key])) &&
      !Object.hasOwn(tx, "authorizationList") && Array.isArray(tx.accessList) && tx.accessList.length === 0;
  }
  async function recover() {
    renderingAllowed();
    await identify();
    journal = storageRead();
    assert(journal && journal.phase !== "rejected", "No submitted request is stored on this origin.");
    let transactionHash = element("recovery-hash").value.trim() || journal.hash;
    if (!transactionHash) {
      const latest = await read("eth_getBlockByNumber", ["latest", false]);
      assert(quantity(latest?.number) && BigInt(latest.number) >= BigInt(journal.startBlock), "Latest recovery block is unavailable.");
      assert(BigInt(latest.number) - BigInt(journal.startBlock) <= 64n,
        "Paste the original hash from MetaMask activity. Automatic recovery scans at most 65 blocks.");
      const found = [];
      for (let height = BigInt(journal.startBlock); height <= BigInt(latest.number); height++) {
        const block = await read("eth_getBlockByNumber", [hex(height), true]);
        assert(Array.isArray(block?.transactions), "Recovery block transactions are unavailable.");
        for (const tx of block.transactions) {
          if (same(tx.from, journal.request.from) && quantity(tx.nonce) && BigInt(tx.nonce) === BigInt(journal.request.nonce)) found.push(tx);
        }
      }
      assert(found.length <= 1, "Conflicting transaction identities were observed. Preserve the journal.");
      if (!found.length) { status("The original transaction remains pending or unavailable. No new request was sent."); return; }
      assert(exactTransaction(found[0], journal.request), "The sender nonce was used by a different transaction. Preserve the journal.");
      transactionHash = found[0].hash;
    }
    assert(hash(transactionHash), "Enter the exact transaction hash from MetaMask activity.");
    assert(!journal.hash || same(journal.hash, transactionHash), "The hash differs from the saved original transaction.");
    const [tx, receipt] = await Promise.all([read("eth_getTransactionByHash", [transactionHash]), read("eth_getTransactionReceipt", [transactionHash])]);
    assert(exactTransaction(tx, journal.request), "The returned transaction differs from the approved request, including its fee fields.");
    storageWrite({ ...journal, hash: transactionHash, phase: "pending" });
    element("recovery-hash").value = transactionHash;
    if (!receipt) { status("The original transaction receipt is pending. No new request was sent."); return; }
    assert(same(receipt.transactionHash, transactionHash) && same(receipt.from, journal.request.from) && same(receipt.to, journal.request.to) &&
      receipt.blockHash === tx.blockHash && receipt.blockNumber === tx.blockNumber, "Receipt identity differs from the original request.");
    const canonical = await read("eth_getBlockByNumber", [receipt.blockNumber, false]);
    assert(canonical?.hash === receipt.blockHash, "The receipt is unverified or was reorganized. Keep the request pending.");
    if (receipt.status === "0x0") {
      storageWrite({ ...journal, phase: "reverted" });
      status("The original transaction reverted. Preserve this receipt before preparing a separately reviewed retry.");
      return;
    }
    assert(receipt.status === "0x1" && Array.isArray(receipt.logs), "Receipt settlement is unavailable.");
    const matches = receipt.logs.filter((log) => same(log.address, configuration.operation.to) &&
      log.topics?.[0] === configuration.creationEvent.topic && same(log.topics[1], configuration.creationEvent.proxyTopic) &&
      same(log.data, configuration.creationEvent.data) && !log.removed);
    assert(matches.length === 1 && matches[0].transactionHash === receipt.transactionHash && matches[0].blockHash === receipt.blockHash,
      "The canonical Safe creation event does not match the reviewed address and singleton.");
    await codeMatches(await read("eth_getCode", [configuration.operation.expectedAddress, receipt.blockNumber]), configuration.proxy);
    for (const state of configuration.postState) {
      const result = await read("eth_call", [{ to: configuration.operation.expectedAddress, data: state.data }, receipt.blockNumber]);
      assert(same(result, state.expected), "Safe ownership, approvals or permissions differ from the approved setup.");
    }
    const rechecked = await read("eth_getBlockByNumber", [receipt.blockNumber, false]);
    assert(rechecked?.hash === receipt.blockHash, "The receipt block changed during verification.");
    storageWrite({ ...journal, phase: "confirmed" });
    status("Operations Safe has a verified wallet-observed L2 receipt. Independent RPC and L1 finality acceptance remain required before protocol deployment. Hash " + transactionHash);
  }
  async function unlock(code) {
    assert(location.href === encrypted.endpoint, "Use the exact approved deployment URL.");
    assert(/^[A-Za-z0-9_-]{43}$/.test(code), "Enter the owner access code.");
    const bytes = decode(code.replace(/-/g, "+").replace(/_/g, "/") + "=");
    const key = await crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["decrypt"]);
    bytes.fill(0);
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decode(encrypted.iv),
      additionalData: new TextEncoder().encode(encrypted.binding), tagLength: 128 }, key, decode(encrypted.payload));
    configuration = JSON.parse(new TextDecoder().decode(plaintext));
    assert(configuration.endpoint === encrypted.endpoint && configuration.task === "OWNER_CONTROLLED_OPERATIONS_SAFE_1", "Unexpected owner action.");
    sessionStorage.setItem(accessKey, code);
    element("access-code").value = "";
    element("access").hidden = true;
    element("controls").hidden = false;
    journal = storageRead();
    status(journal && journal.phase !== "rejected" ? "An original transaction is saved. Use recovery before any new request." :
      "Connect the approved MetaMask account, then review live costs.");
  }
  element("unlock").onclick = () => run(() => unlock(element("access-code").value.trim()));
  element("connect").onclick = () => run(async () => {
    renderingAllowed();
    provider = window.ethereum;
    assert(provider?.request, "Open this page in your MetaMask in-app browser.");
    const accounts = await provider.request({ method: "eth_requestAccounts" });
    assert(Array.isArray(accounts) && same(accounts[0], configuration.sender), "Select the approved personal MetaMask account.");
    await identify();
    if (provider.on) for (const event of ["accountsChanged", "chainChanged", "disconnect"]) provider.on(event,
      () => invalidate("Wallet selection changed. Review live costs for the approved account again."));
    status("Wallet connected. Review live transaction costs.");
  });
  element("refresh").onclick = () => run(refresh);
  element("send").onclick = () => run(send);
  element("recover").onclick = () => run(recover);
  element("approve").onchange = () => {
    element("send").disabled = busy || !review || !element("approve").checked || (journal && journal.phase !== "rejected");
  };
  element("logout").onclick = () => {
    sessionStorage.removeItem(accessKey);
    configuration = undefined;
    provider = undefined;
    invalidate("Owner session locked. The original transaction journal is retained.");
    element("controls").hidden = true;
    element("access").hidden = false;
  };
  window.addEventListener("storage", (event) => {
    if (event.key === journalKey || event.key === null) invalidate("Another tab changed the transaction journal. Use recovery.");
  });
  try {
    const remembered = sessionStorage.getItem(accessKey);
    if (remembered) void run(() => unlock(remembered));
  } catch { status("Owner session storage is unavailable."); }
}
