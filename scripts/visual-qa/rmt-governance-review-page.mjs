// Serialized into an encrypted owner-only static page. This function has no transaction method.
export function governanceReviewPage(encrypted) {
  const el = (id) => document.getElementById(id), status = (message) => { el("status").textContent = message; };
  const equal = (a, b) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
  const quantity = (v) => typeof v === "string" && /^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(v);
  const hash = (v) => typeof v === "string" && /^0x[0-9a-f]{64}$/i.test(v);
  const hex = (v) => "0x" + BigInt(v).toString(16);
  const assert = (value, message, invalidateAll = false) => { if (!value) { const error = new Error(message); error.invalidateAll = invalidateAll; throw error; } };
  const decode = (v) => Uint8Array.from(atob(v), (c) => c.charCodeAt(0));
  const encode = (v) => btoa(String.fromCharCode(...new Uint8Array(v)));
  const accessKey = "rmt-gov-access:" + encrypted.endpoint, collectionKey = "rmt-gov-responses:" + encrypted.endpoint;
  const reads = new Set(["eth_accounts", "eth_chainId", "eth_getBlockByNumber", "eth_getCode", "eth_call", "eth_getTransactionReceipt", "eth_getTransactionByHash"]);
  let config, provider, cryptoKey, collection, review, busy = false;
  const aad = () => new TextEncoder().encode("RMT governance responses\n" + encrypted.endpoint + "\n" + config.digest);
  function invalidate(message) { review = null; el("approve").checked = false; el("sign").disabled = true; el("download").disabled = true; status(message); }
  async function loadCollection() {
    const raw = localStorage.getItem(collectionKey);
    if (!raw) return { schemaVersion: 1, digest: config.digest, signatureResponses: [], invalidated: false };
    assert(raw.length < 20000, "Stored signature evidence is too large; preserve it for recovery.");
    const sealed = JSON.parse(raw);
    const bytes = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decode(sealed.iv), additionalData: aad() }, cryptoKey, decode(sealed.payload));
    const value = JSON.parse(new TextDecoder().decode(bytes));
    assert(value.schemaVersion === 1 && value.digest === config.digest && Array.isArray(value.signatureResponses) && value.signatureResponses.length <= 2 &&
      typeof value.invalidated === "boolean" && value.signatureResponses.every((r) => config.owners.some((owner) => equal(owner, r.signer)) && /^0x[0-9a-f]{130}$/i.test(r.signature)),
    "Stored responses do not match this exact authorization; preserve the evidence.");
    return value;
  }
  async function saveCollection(value) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const payload = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad() }, cryptoKey, new TextEncoder().encode(JSON.stringify(value)));
    const raw = JSON.stringify({ iv: encode(iv), payload: encode(payload) });
    localStorage.setItem(collectionKey, raw); assert(localStorage.getItem(collectionKey) === raw, "Private signature evidence could not be saved."); collection = value;
  }
  async function run(task) {
    if (busy) return; busy = true;
    for (const id of ["connect", "review", "sign", "download"]) el(id).disabled = true;
    try { await task(); } catch (error) {
      if (error.invalidateAll && collection && config) await saveCollection({ ...collection, invalidated: true, invalidationReason: error.message });
      invalidate(error.message || "Required evidence is unavailable. No signature was requested.");
    } finally {
      busy = false; el("connect").disabled = false; el("review").disabled = false;
      el("sign").disabled = !review || !el("approve").checked || collection?.invalidated || collection?.signatureResponses.length >= 2 ||
        collection?.signatureResponses.some((r) => equal(r.signer, review.account));
      el("download").disabled = !review || collection?.invalidated || collection?.signatureResponses.length !== 2;
    }
  }
  async function read(method, params = []) {
    assert(reads.has(method) && provider && provider === window.ethereum, "Unexpected wallet provider or read method.");
    return provider.request({ method, params });
  }
  async function identify() {
    assert(config && location.href === encrypted.endpoint && window.isSecureContext && navigator.locks,
      "Use the exact secure governance review URL in a compatible wallet browser.");
    const [accounts, chain] = await Promise.all([read("eth_accounts"), read("eth_chainId")]);
    assert(Array.isArray(accounts) && config.owners.some((owner) => equal(owner, accounts[0])), "Select one of the three approved RMT governance accounts in Rabby.");
    assert(chain === "0x1237", "Select Robinhood Chain 4663 in Rabby. Unsupported networks stay blocked.");
    return accounts[0];
  }
  async function codeMatches(code, pin) {
    assert(typeof code === "string" && /^0x(?:[0-9a-f]{2})+$/i.test(code) && (code.length - 2) / 2 === pin.byteLength,
      "A required contract runtime changed; all collected responses are invalidated.", true);
    const data = Uint8Array.from(code.slice(2).match(/../g), (p) => parseInt(p, 16));
    const actual = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", data)), (b) => b.toString(16).padStart(2, "0")).join("");
    assert(actual === pin.sha256, "A required runtime identity changed; all collected responses are invalidated.", true);
  }
  async function observe() {
    const account = await identify(); collection = await loadCollection();
    assert(!collection.invalidated, "This authorization was invalidated. Preserve its encrypted evidence and obtain a newly bound review.");
    const block = await read("eth_getBlockByNumber", ["latest", false]);
    assert(quantity(block?.number) && quantity(block.timestamp) && hash(block.hash) && Math.abs(Date.now() / 1000 - Number(BigInt(block.timestamp))) < 180,
      "Current canonical governance evidence is unavailable.");
    const remaining = BigInt(config.typedData.message.deadline) - BigInt(block.timestamp);
    assert(remaining >= 172800n && remaining <= 777600n, "This action no longer has the required notice window. Obtain a fresh authorization and both signatures.", true);
    for (const owner of config.owners) {
      const [code, pending] = await Promise.all([read("eth_getCode", [owner, block.number]), read("eth_getCode", [owner, "pending"])]);
      assert(code === "0x" && pending === "0x", "A governance account's admitted type changed; all collected responses are invalidated.", true);
    }
    for (const pin of config.runtimePins) {
      const [code, pending] = await Promise.all([read("eth_getCode", [pin.address, block.number]), read("eth_getCode", [pin.address, "pending"])]);
      await codeMatches(code, pin); assert(equal(code, pending), "A pending runtime changed; all collected responses are invalidated.", true);
    }
    for (const check of config.directoryChecks) {
      const request = { to: config.directory, data: check.data };
      const [actual, pending] = await Promise.all([read("eth_call", [request, block.number]), read("eth_call", [request, "pending"])]);
      assert(equal(actual, check.expected) && equal(pending, check.expected),
        "Directory authority, nonce, epoch, suspension, pending action or actionDigest changed. All collected responses are invalidated.", true);
    }
    for (const proof of config.protocolReceipts) {
      const [receipt, tx, canonical] = await Promise.all([read("eth_getTransactionReceipt", [proof.hash]), read("eth_getTransactionByHash", [proof.hash]),
        read("eth_getBlockByNumber", [hex(proof.blockNumber), false])]);
      assert(receipt && tx && canonical, "A required deployment receipt is unavailable; review stays pending.");
      assert(receipt.status === "0x1" && receipt.to === null && equal(receipt.contractAddress, proof.address) &&
        receipt.blockHash === proof.blockHash && BigInt(receipt.blockNumber) === BigInt(proof.blockNumber) && canonical.hash === proof.blockHash &&
        equal(receipt.transactionHash, proof.hash) && tx.to === null && tx.type === "0x2" && tx.chainId === "0x1237" &&
        tx.blockHash === proof.blockHash && BigInt(tx.blockNumber) === BigInt(proof.blockNumber) && equal(tx.hash, proof.hash) &&
        tx.nonce === proof.nonce && tx.input === proof.input && tx.value === "0x0" && equal(tx.from, config.protocolSender) &&
        !Object.hasOwn(tx, "authorizationList") && Array.isArray(tx.accessList) && tx.accessList.length === 0,
      "A canonical protocol deployment identity changed. All collected responses are invalidated.", true);
    }
    assert((await read("eth_getBlockByNumber", [block.number, false]))?.hash === block.hash,
      "The review anchor reorganized. Recheck the exact authorization before signing.");
    await identify();
    return { account, blockHash: block.hash, blockNumber: block.number };
  }
  function facts() {
    const area = el("facts"); area.replaceChildren(); const dl = document.createElement("dl");
    const rows = [["Action", config.action], ["Network", "Robinhood Chain 4663"], ["Directory", config.directory],
      ["Target", config.typedData.message.factory], ["Target runtime hash", config.typedData.message.runtimeHash],
      ["Action kind / version", config.typedData.message.kind + " / " + config.typedData.message.version],
      ["Governance nonce", config.typedData.message.nonce], ["Signer epoch", config.typedData.message.signerSetEpoch],
      ["Signing deadline (UTC)", config.signingDeadlineUtc], ["Required real notice", "2 days after the later schedule transaction"],
      ["Action digest", config.digest], ["Current account", review.account],
      ["Wallet responses collected", collection.signatureResponses.length + " of 2; operator cryptographic verification remains required"]];
    for (const [label, value] of rows) { const dt = document.createElement("dt"), dd = document.createElement("dd"); dt.textContent = label; dd.textContent = value; dl.append(dt, dd); }
    area.append(dl); el("approval-label").hidden = false; el("approve").checked = false;
  }
  async function reviewAction() { review = await observe(); facts(); status("Review the exact publication action. Signing authorizes a later schedule call; it is not a connection-only signature."); }
  async function sign() {
    assert(review && el("approve").checked, "Approve this exact typed action before requesting a signature.");
    await navigator.locks.request(collectionKey, { ifAvailable: true }, async (lock) => {
      assert(lock, "Another tab is collecting this authorization.");
      const next = await observe(); assert(equal(next.account, review.account), "Selected account changed. Review again before signing.");
      assert(collection.signatureResponses.length < 2 && !collection.signatureResponses.some((r) => equal(r.signer, next.account)), "This signer already responded or two responses are saved.");
      status("Review and personally confirm this exact EIP-712 publication authorization in Rabby. No transaction or gas payment is requested.");
      try {
        const signature = await provider.request({ method: "eth_signTypedData_v4", params: [next.account, JSON.stringify(config.typedData)] });
        assert(/^0x[0-9a-f]{128}(?:1b|1c)$/i.test(signature), "The wallet returned an unsupported signature format; no schedule transaction was prepared.");
        await saveCollection({ ...collection, signatureResponses: [...collection.signatureResponses, { signer: next.account, signature }], pendingValidation: true });
        review = await observe(); await saveCollection({ ...collection, pendingValidation: false }); facts();
        status(collection.signatureResponses.length === 2 ? "Two wallet responses saved privately. Download the JSON for cryptographic operator verification before any schedule transaction." :
          "First response saved privately. Switch to a different approved Rabby governance account, connect and review the same action again.");
      } catch (error) {
        if (error?.code === 4001) { invalidate("Rabby rejected this signature request. Existing saved responses remain intact."); return; }
        throw error;
      }
    });
  }
  async function download() {
    review = await observe(); assert(collection.signatureResponses.length === 2 && !collection.invalidated, "Two current responses are required.");
    const body = JSON.stringify({ schemaVersion: 1, scope: "OWNER_COLLECTED_DIRECTORY_TYPED_SIGNATURES", directory: config.directory,
      digest: config.digest, typedData: config.typedData, signatureResponses: collection.signatureResponses }, null, 2) + "\n";
    const url = URL.createObjectURL(new Blob([body], { type: "application/json" })), anchor = document.createElement("a");
    anchor.href = url; anchor.download = "rmt-publication-authorization-" + config.digest.slice(2, 10) + ".json"; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status("Private authorization JSON downloaded. Return that file for verification. Never send seed phrases or private keys.");
  }
  async function unlock(code) {
    assert(location.href === encrypted.endpoint && /^[A-Za-z0-9_-]{43}$/.test(code), "Use the exact approved HTTPS URL and access code.");
    const bytes = decode(code.replace(/-/g, "+").replace(/_/g, "/") + "=");
    cryptoKey = await crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["decrypt", "encrypt"]); bytes.fill(0);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decode(encrypted.iv), additionalData: new TextEncoder().encode(encrypted.binding) }, cryptoKey, decode(encrypted.payload));
    config = JSON.parse(new TextDecoder().decode(plain));
    assert(config.endpoint === encrypted.endpoint && config.scope === "UNSIGNED_DIRECTORY_PUBLICATION_AUTHORIZATION" && config.chainId === 4663 && config.requiredSignatures === 2,
      "Unexpected governance authorization configuration.");
    sessionStorage.setItem(accessKey, code); el("access-code").value = ""; el("access").hidden = true; el("controls").hidden = false;
    collection = await loadCollection(); invalidate(collection.invalidated ? "This exact action was invalidated. Fresh preparation is required." : "Connect one of the approved Rabby governance accounts. No signature is requested on connection.");
  }
  el("unlock").onclick = () => run(() => unlock(el("access-code").value.trim()));
  el("connect").onclick = () => run(async () => {
    provider = window.ethereum; assert(provider?.request, "No injected wallet is available. Open the exact page in Rabby's built-in dapp browser; unsupported connectors remain blocked.");
    const accounts = await provider.request({ method: "eth_requestAccounts" });
    assert(config.owners.some((owner) => equal(owner, accounts?.[0])), "Select an existing approved RMT governance account.");
    await identify(); if (provider.on) for (const event of ["accountsChanged", "chainChanged", "disconnect"]) provider.on(event,
      () => invalidate("Wallet selection changed. Saved responses for the exact action are retained; review again before signing."));
    invalidate("Governance wallet connected. Review the exact action before any signature request.");
  });
  el("review").onclick = () => run(reviewAction); el("sign").onclick = () => run(sign); el("download").onclick = () => run(download);
  el("approve").onchange = () => { el("sign").disabled = busy || !review || !el("approve").checked || collection?.invalidated || collection?.signatureResponses.length >= 2 ||
    collection?.signatureResponses.some((r) => equal(r.signer, review.account)); };
  el("logout").onclick = () => { sessionStorage.removeItem(accessKey); config = null; provider = null; cryptoKey = null; invalidate("Session locked. Encrypted signature evidence is retained."); el("controls").hidden = true; el("access").hidden = false; };
  window.addEventListener("storage", (event) => { if (event.key === collectionKey || event.key === null) invalidate("Another tab changed private responses. Review current authority again."); });
  try { const remembered = sessionStorage.getItem(accessKey); if (remembered) void run(() => unlock(remembered)); } catch { status("Secure session storage is unavailable."); }
}
