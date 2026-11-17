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
  const isCreation = () => configuration?.mode === "CREATE";
  const isGovernance = () => configuration?.mode === "GOVERNANCE_CALL";
  const isProtocol = () => isCreation() || isGovernance();
  const destinationMatches = (actual, expected) => isCreation()
    ? actual == null && expected == null : same(actual, expected);

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
    assert(raw.length < (isCreation() ? 120_000 : 20_000), "Stored transaction journal is too large. Preserve it and use recovery.");
    const value = JSON.parse(raw);
    assert(value.schemaVersion === 1 && value.origin === encrypted.endpoint &&
      same(value.request?.from, configuration.sender) && destinationMatches(value.request?.to, configuration.operation.to) &&
      (!isCreation() || !Object.hasOwn(value.request, "to")) &&
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
  async function verifyOperations(tag, suppliedProof) {
    const proof = suppliedProof ?? configuration.operationsVerification;
    if (!proof) return;
    const receiptTag = hex(proof.receiptBlock);
    const [block, receipt, tx, code] = await Promise.all([
      read("eth_getBlockByNumber", [receiptTag, false]), read("eth_getTransactionReceipt", [proof.hash]),
      read("eth_getTransactionByHash", [proof.hash]), read("eth_getCode", [proof.safe, tag]),
    ]);
    assert(block?.hash === proof.blockHash && block.number === receiptTag && receipt?.status === "0x1" &&
      same(receipt.transactionHash, proof.hash) && receipt.blockHash === proof.blockHash && receipt.blockNumber === receiptTag &&
      tx?.blockHash === proof.blockHash && tx.blockNumber === receiptTag && same(tx.hash, proof.hash) &&
      same(tx.from, proof.transaction.from) && same(tx.to, proof.transaction.to) && tx.input === proof.transaction.input &&
      tx.value === "0x0" && same(tx.chainId, configuration.chainId) &&
      same(receipt.from, tx.from) && same(receipt.to, tx.to),
    "The verified Operations receipt is unavailable or its canonical identity changed. Reserve remains blocked.");
    const matches = receipt.logs?.filter((log) => same(log.address, proof.transaction.to) &&
      log.topics?.[0] === proof.event.topic && same(log.topics?.[1], proof.event.proxyTopic) &&
      same(log.data, proof.event.data) && quantity(log.logIndex) && BigInt(log.logIndex) === BigInt(proof.logIndex) &&
      same(log.transactionHash, proof.hash) && log.blockHash === proof.blockHash && log.blockNumber === receiptTag && !log.removed);
    assert(matches?.length === 1, "The approved Operations creation event is unavailable. Reserve remains blocked.");
    await codeMatches(code, proof.proxy ?? configuration.proxy);
    if (isProtocol()) {
      const pendingCode = await read("eth_getCode", [proof.safe, "pending"]);
      assert(same(code, pendingCode), "A treasury's pending runtime differs from its canonical implementation.");
    }
    for (const state of proof.postState ?? configuration.postState) {
      const result = await read("eth_call", [{ to: proof.safe, data: state.data }, tag]);
      assert(same(result, state.expected), "Operations ownership, approvals or permissions changed. Reserve remains blocked.");
      if (isProtocol()) {
        const pending = await read("eth_call", [{ to: proof.safe, data: state.data }, "pending"]);
        assert(same(result, pending), "A treasury's pending permissions differ from its canonical configuration.");
      }
    }
    if (isGovernance()) {
      for (const at of [tag, "pending"]) {
        const nonce = await read("eth_call", [{ to: proof.safe, data: configuration.safeNonceGetterData }, at]);
        assert(typeof nonce === "string" && /^0x[0-9a-f]{64}$/i.test(nonce) && BigInt(nonce) >= 0n,
          "The treasury's current nonce is unavailable. Preserve its existing permissions and recovery evidence.");
      }
    }
    const rechecked = await read("eth_getBlockByNumber", [receiptTag, false]);
    assert(rechecked?.hash === proof.blockHash, "The Operations receipt was reorganized during verification.");
  }
  async function verifyContractChecks(checks, tag, pendingRequired = false) {
    for (const check of checks ?? []) {
      const code = await read("eth_getCode", [check.address, tag]);
      await codeMatches(code, check.runtime);
      if (pendingRequired) assert(same(code, await read("eth_getCode", [check.address, "pending"])),
        "A required contract's pending runtime changed.");
      for (const state of check.postState ?? []) {
        const result = await read("eth_call", [{ to: check.address, data: state.data }, tag]);
        assert(same(result, state.expected), "A required contract's state differs from the reviewed binding.");
        if (pendingRequired) assert(same(result, await read("eth_call", [{ to: check.address, data: state.data }, "pending"])),
          "A required contract's pending state changed.");
      }
    }
  }
  async function verifyPredecessors(tag) {
    for (const proof of configuration.protocolPrerequisites ?? []) {
      const receiptTag = hex(proof.receiptBlock);
      assert(BigInt(tag) >= BigInt(receiptTag), "The current observation precedes a required deployment receipt.");
      const [block, receipt, tx] = await Promise.all([
        read("eth_getBlockByNumber", [receiptTag, false]), read("eth_getTransactionReceipt", [proof.hash]),
        read("eth_getTransactionByHash", [proof.hash]),
      ]);
      assert(block?.hash === proof.blockHash && block.number === receiptTag && receipt?.status === "0x1" &&
        same(receipt.transactionHash, proof.hash) && receipt.blockHash === proof.blockHash && receipt.blockNumber === receiptTag &&
        same(receipt.contractAddress, proof.address) && receipt.to === null && same(receipt.from, configuration.sender) &&
        tx?.to === null && tx.type === "0x2" && same(tx.chainId, configuration.chainId) && same(tx.from, configuration.sender) &&
        tx.value === "0x0" && tx.input === proof.input && tx.nonce === proof.nonce && same(tx.hash, proof.hash) &&
        tx.blockHash === proof.blockHash && tx.blockNumber === receiptTag &&
        !Object.hasOwn(tx, "authorizationList") && Array.isArray(tx.accessList) && tx.accessList.length === 0 &&
        Array.isArray(receipt.logs) && receipt.logs.length === 0,
      "A required predecessor's canonical CREATE receipt or exact transaction is unavailable or changed.");
      await verifyContractChecks([proof], tag, true);
      assert((await read("eth_getBlockByNumber", [receiptTag, false]))?.hash === proof.blockHash,
        "A required predecessor receipt was reorganized.");
    }
    await verifyContractChecks(configuration.preflightContracts, tag, true);
    for (const address of configuration.childVacancies ?? []) {
      const [code, nonce, pendingCode, pendingNonce] = await Promise.all([
        read("eth_getCode", [address, tag]), read("eth_getTransactionCount", [address, tag]),
        read("eth_getCode", [address, "pending"]), read("eth_getTransactionCount", [address, "pending"]),
      ]);
      assert(code === "0x" && pendingCode === "0x" && nonce === "0x0" && pendingNonce === "0x0",
        "A planned bootstrap child address is occupied or unverified.");
    }
  }
  async function observe() {
    const generation = revision;
    await identify();
    const op = configuration.operation;
    const block = await read("eth_getBlockByNumber", ["latest", false]);
    assert(validBlock(block), "Current canonical block evidence is unavailable.");
    const tag = block.number;
    if (isGovernance()) {
      const gov = configuration.governance, chainTime = BigInt(block.timestamp);
      if (gov.phase === "execute") assert(chainTime >= BigInt(gov.executeAfter) && chainTime <= BigInt(gov.executeBy),
        "The real governance notice is not mature, or its execution window expired. No transaction can be prepared.");
      else assert(BigInt(gov.deadline) >= chainTime + 172800n,
        "The authorization no longer permits the required real two-day notice. Recollect a newly bound authorization.");
      if (configuration.governancePredecessor) {
        const proof = configuration.governancePredecessor;
        const [receipt, tx, header] = await Promise.all([read("eth_getTransactionReceipt", [proof.hash]), read("eth_getTransactionByHash", [proof.hash]),
          read("eth_getBlockByNumber", [proof.blockNumber, false])]);
        assert(receipt?.status === "0x1" && same(receipt.transactionHash, proof.hash) && receipt.blockHash === proof.blockHash &&
          receipt.blockNumber === proof.blockNumber && header?.hash === proof.blockHash && same(receipt.to, op.to) &&
          same(tx?.hash, proof.hash) && same(tx.from, configuration.sender) && same(tx.to, op.to) && tx.input === proof.input &&
          tx.nonce === proof.nonce && tx.value === "0x0" && tx.type === "0x2" && tx.chainId === configuration.chainId &&
          tx.blockHash === proof.blockHash && tx.blockNumber === proof.blockNumber && !Object.hasOwn(tx, "authorizationList") &&
          Array.isArray(tx.accessList) && tx.accessList.length === 0,
        "The canonical governance schedule predecessor is unavailable or changed.");
      }
    }
    if (isProtocol()) {
      assert(configuration.prerequisites?.length === 2, "Both verified treasury receipts are required.");
      for (const proof of configuration.prerequisites) await verifyOperations(tag, proof);
      await verifyPredecessors(tag);
      for (const owner of configuration.operation.owners) {
        const [code, pending] = await Promise.all([read("eth_getCode", [owner, tag]), read("eth_getCode", [owner, "pending"])]);
        assert(code === "0x" && pending === "0x", "A governance signer is not an admitted EOA.");
      }
    } else await verifyOperations(tag);
    const [confirmedNonce, pendingNonce, balance, accountCode, pendingCode, vacancyCode, vacancyNonce, pendingVacancyCode, pendingVacancyNonce] = await Promise.all([
      read("eth_getTransactionCount", [configuration.sender, tag]), read("eth_getTransactionCount", [configuration.sender, "pending"]),
      read("eth_getBalance", [configuration.sender, tag]), read("eth_getCode", [configuration.sender, tag]),
      read("eth_getCode", [configuration.sender, "pending"]), read("eth_getCode", [op.expectedAddress, tag]),
      read("eth_getTransactionCount", [op.expectedAddress, tag]), read("eth_getCode", [op.expectedAddress, "pending"]),
      read("eth_getTransactionCount", [op.expectedAddress, "pending"]),
    ]);
    assert(quantity(confirmedNonce) && quantity(pendingNonce) && BigInt(confirmedNonce) === BigInt(pendingNonce),
      "The sender has a pending transaction. Recover it before preparing another.");
    assert(!isCreation() || BigInt(pendingNonce) === BigInt(op.nonce),
      "The prepared deployment nonce changed. Stop and rebind the exact constructor addresses; do not retry this packet.");
    assert(quantity(balance), "The available balance could not be verified.");
    assert(same(accountCode, configuration.delegate.designator) && same(pendingCode, accountCode),
      "The wallet delegation differs from the reviewed implementation.");
    assert(isGovernance() || (vacancyCode === "0x" && pendingVacancyCode === "0x" && quantity(vacancyNonce) && quantity(pendingVacancyNonce) &&
      BigInt(vacancyNonce) === 0n && BigInt(pendingVacancyNonce) === 0n),
    "The expected Safe address is occupied or its vacancy is unverified.");
    for (const pin of [...configuration.runtimePins, configuration.delegate]) {
      const [code, pending] = await Promise.all([read("eth_getCode", [pin.address, tag]), read("eth_getCode", [pin.address, "pending"])]);
      await codeMatches(code, pin);
      assert(same(code, pending), "A pending runtime differs from the reviewed implementation.");
    }
    const request = { type: "0x2", chainId: configuration.chainId, from: configuration.sender, ...(!isCreation() && { to: op.to }),
      data: op.data, value: "0x0", nonce: hex(pendingNonce) };
    const [simulated, estimatedGas, components, priority, gasPrice] = await Promise.all([
      read("eth_call", [request, tag]), read("eth_estimateGas", [request, tag]),
      read("eth_call", [{ from: configuration.sender, to: "0x00000000000000000000000000000000000000c8", value: "0x0", data: configuration.nitroData }, tag]),
      read("eth_maxPriorityFeePerGas"), read("eth_gasPrice"),
    ]);
    if (isGovernance()) assert(simulated === "0x", "The exact governance call did not return the reviewed empty result.");
    else if (isCreation()) await codeMatches(simulated, configuration.createdContract);
    else assert(same(abiAddress(simulated), op.expectedAddress), "The exact Safe creation simulation returned a different address.");
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
    const rows = [["Sender", configuration.sender], ["Action", isProtocol() ? configuration.operation.label : "Create " + configuration.safeLabel + "L2 1.4.1"],
      ["Value", "0 ETH"], [isGovernance() ? "Governance Directory" : isCreation() ? "Expected contract" : "Expected Safe", configuration.operation.expectedAddress],
      ["Nonce", BigInt(next.request.nonce).toString()], ["Network estimate", ether(next.estimatedWei)],
      ["Maximum network cost", ether(next.maximumWei)], ["Included L1 posting estimate", ether(next.l1Wei)],
      ["Gas limit", BigInt(next.request.gas).toString()], ["Maximum fee per gas", BigInt(next.request.maxFeePerGas).toString() + " wei"],
      ["Priority fee per gas", BigInt(next.request.maxPriorityFeePerGas).toString() + " wei"],
      ["Calldata hash", configuration.operation.dataHash], ["Owners", configuration.operation.owners.join(" ; ")],
      ["Approvals", "2 of 3"]];
    for (const field of configuration.operation.reviewFields ?? []) rows.push(field);
    for (const [label, value] of rows) {
      const dt = document.createElement("dt");
      const dd = document.createElement("dd");
      dt.textContent = label;
      dd.textContent = value;
      dl.append(dt, dd);
    }
    target.append(dl);
    if (configuration.earlierFeeCeilingWei && BigInt(next.maximumWei) > BigInt(configuration.earlierFeeCeilingWei)) {
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
      const sameIdentity = identityFields.every((field) => field === "to"
        ? destinationMatches(next.request.to, review.request.to) : same(next.request[field], review.request[field]));
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
    return tx && destinationMatches(tx.to, request.to) && (!isCreation() || !Object.hasOwn(request, "to")) &&
      ["from", "input", "chainId", "type", "value", "nonce", "gas", "maxFeePerGas", "maxPriorityFeePerGas"]
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
    assert(same(receipt.transactionHash, transactionHash) && same(receipt.from, journal.request.from) && destinationMatches(receipt.to, journal.request.to) &&
      receipt.blockHash === tx.blockHash && receipt.blockNumber === tx.blockNumber, "Receipt identity differs from the original request.");
    const canonical = await read("eth_getBlockByNumber", [receipt.blockNumber, false]);
    assert(canonical?.hash === receipt.blockHash, "The receipt is unverified or was reorganized. Keep the request pending.");
    if (receipt.status === "0x0") {
      storageWrite({ ...journal, phase: "reverted" });
      status("The original transaction reverted. Preserve this receipt before preparing a separately reviewed retry.");
      return;
    }
    assert(receipt.status === "0x1" && Array.isArray(receipt.logs), "Receipt settlement is unavailable.");
    const matches = isCreation() || isGovernance() ? [] : receipt.logs.filter((log) => same(log.address, configuration.operation.to) &&
      log.topics?.[0] === configuration.creationEvent.topic && same(log.topics[1], configuration.creationEvent.proxyTopic) &&
      same(log.data, configuration.creationEvent.data) && !log.removed);
    if (isGovernance()) {
      assert(receipt.contractAddress == null && quantity(canonical.timestamp), "Governance receipt identity or canonical timestamp is unavailable.");
      const gov = configuration.governance;
      const matchesEvent = (log, event) => same(log.address, configuration.operation.to) && log.removed === false &&
        same(log.transactionHash, transactionHash) && log.blockHash === receipt.blockHash && log.blockNumber === receipt.blockNumber &&
        Array.isArray(log.topics) && log.topics.length === event.topics.length && log.topics.every((topic, i) => same(topic, event.topics[i])) &&
        same(log.data, event.data);
      if (gov.phase === "schedule") {
        const executableAt = BigInt(canonical.timestamp) + 172800n, limit = executableAt + 604800n;
        const expiresAt = limit < BigInt(gov.deadline) ? limit : BigInt(gov.deadline);
        assert(expiresAt >= executableAt, "The scheduled authorization cannot preserve its two-day notice.");
        const word = (value) => BigInt(value).toString(16).padStart(64, "0");
        const expected = { topics: gov.scheduleEventTopics, data: "0x" + word(executableAt) + word(expiresAt) };
        assert(receipt.logs.length === 1 && matchesEvent(receipt.logs[0], expected),
          "Canonical ActionScheduled digest, nonce or real notice timestamps differ.");
        const pending = await read("eth_call", [{ to: configuration.operation.to, data: gov.pendingGetterData }, receipt.blockNumber]);
        assert(same(pending, gov.digest + word(executableAt) + word(expiresAt)), "Directory pending authorization differs from the canonical schedule event.");
      } else assert(receipt.logs.length === gov.executionEvents.length &&
        gov.executionEvents.every((event, i) => matchesEvent(receipt.logs[i], event)),
      "Canonical publication or ActionCleared event differs from the approved action.");
    } else if (isCreation()) {
      assert(same(receipt.contractAddress, configuration.operation.expectedAddress), "The CREATE receipt deployed an unexpected contract address.");
      assert(receipt.logs.length === 0, "Unexpected events were emitted by the reviewed constructor.");
    } else assert(matches.length === 1 && matches[0].transactionHash === receipt.transactionHash && matches[0].blockHash === receipt.blockHash,
      "The canonical Safe creation event does not match the reviewed address and singleton.");
    await codeMatches(await read("eth_getCode", [configuration.operation.expectedAddress, receipt.blockNumber]),
      isGovernance() ? configuration.directoryRuntime : isCreation() ? configuration.createdContract : configuration.proxy);
    for (const state of configuration.postState) {
      const result = await read("eth_call", [{ to: configuration.operation.expectedAddress, data: state.data }, receipt.blockNumber]);
      assert(same(result, state.expected), "Safe ownership, approvals or permissions differ from the approved setup.");
    }
    if (isCreation()) await verifyContractChecks(configuration.createdChildren, receipt.blockNumber);
    const rechecked = await read("eth_getBlockByNumber", [receipt.blockNumber, false]);
    assert(rechecked?.hash === receipt.blockHash, "The receipt block changed during verification.");
    storageWrite({ ...journal, phase: "confirmed" });
    status((isProtocol() ? configuration.operation.label : configuration.safeLabel) + " has a verified wallet-observed L2 receipt. Independent RPC and L1 finality acceptance remain required before the next dependent action. Hash " + transactionHash);
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
    assert(configuration.endpoint === encrypted.endpoint && configuration.task === encrypted.task &&
      ["OWNER_CONTROLLED_OPERATIONS_SAFE_1", "OWNER_CONTROLLED_RESERVE_SAFE", "OWNER_CONTROLLED_PROTOCOL_DIRECTORY", "OWNER_CONTROLLED_PROTOCOL_STAGE", "OWNER_CONTROLLED_GOVERNANCE_SCHEDULE", "OWNER_CONTROLLED_GOVERNANCE_EXECUTE"].includes(configuration.task) &&
      (configuration.task === "OWNER_CONTROLLED_RESERVE_SAFE") === Boolean(configuration.operationsVerification), "Unexpected owner action.");
    assert(!isCreation() || (configuration.prerequisites?.length === 2 && configuration.operation.to == null && quantity(configuration.operation.nonce) &&
      ((configuration.task === "OWNER_CONTROLLED_PROTOCOL_DIRECTORY" && configuration.operation.id === "directory") ||
      (configuration.task === "OWNER_CONTROLLED_PROTOCOL_STAGE" && ["registry", "successor-v2", "successor-v3", "bootstrap"].includes(configuration.operation.id) &&
      configuration.protocolPrerequisites?.length === ["directory", "registry", "successor-v2", "successor-v3", "bootstrap"].indexOf(configuration.operation.id)))),
    "Unexpected constructor deployment configuration.");
    assert(!isGovernance() || (configuration.prerequisites?.length === 2 && configuration.protocolPrerequisites?.length === 5 &&
      same(configuration.operation.to, configuration.operation.expectedAddress) && hash(configuration.governance?.digest) &&
      configuration.operation.id === configuration.governance.phase + "-" +
        (configuration.governance.kind === 0 && configuration.governance.version === 1 ? "factory" :
          configuration.governance.kind === 4 && configuration.governance.version === 3 ? "v3-template" : "UNSUPPORTED") &&
      ((configuration.task === "OWNER_CONTROLLED_GOVERNANCE_SCHEDULE" && configuration.governance.phase === "schedule") ||
      (configuration.task === "OWNER_CONTROLLED_GOVERNANCE_EXECUTE" && configuration.governance.phase === "execute" && configuration.governancePredecessor))),
    "Unexpected governance transaction configuration.");
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
