import { createHash } from "node:crypto";
export const RECORD_LIMIT = 2048;
export const OUTPUT_LIMIT = 65_536;
const END_RESERVE = 8192;
const schema = "RMT_FEE_ACTION_V1";
type Kind = "PROOF_START" | "SOURCE_FINGERPRINT" | "CASE_START" | "QUOTE" | "ACTION" | "FINAL_MINIMUM" | "CASE_END" | "PROOF_END";
export class ProofJsonl {
  private sequence = 0;
  private bytes = 0;
  private active: string | null = null;
  private actions = 0;
  private ended = false;
  private semanticComplete = true;
  private quoteRecords = 0;
  private finalRecords = 0;
  private cases = 0;
  truncated = false;
  constructor(private readonly sink: (line: string) => void) {}
  emit(type: Kind, fields: Record<string, unknown> = {}, terminal = false): boolean {
    if (this.ended) return false;
    if (["schema", "sequence", "type", "caseId", "recordHash"].some(key => key in fields)) throw new Error("RESERVED_PROOF_FIELD");
    const payload = { schema, sequence: this.sequence, type, caseId: this.active, ...fields };
    const text = JSON.stringify(payload);
    const recordHash = createHash("sha256").update(text).digest("hex");
    const line = JSON.stringify({ ...payload, recordHash }) + "\n";
    const size = Buffer.byteLength(line);
    if (size > RECORD_LIMIT || this.bytes + size > OUTPUT_LIMIT - (terminal ? 0 : END_RESERVE)) { this.truncated = true; return false; }
    this.sink(line); this.bytes += size; this.sequence++;
    if (type === "ACTION") { this.actions++; if (fields.semanticsComplete !== true) this.semanticComplete = false; }
    if (type === "QUOTE") this.quoteRecords++;
    if (type === "FINAL_MINIMUM") this.finalRecords++;
    return true;
  }
  beginCase(id: string) {
    if (this.active || this.ended || !["ETH_TO_ERC20", "ERC20_TO_ETH", "ERC20_TO_ERC20"].includes(id)) throw new Error("PROOF_CASE_INVALID");
    this.active = id; this.actions = 0; this.semanticComplete = true; this.quoteRecords = 0; this.finalRecords = 0;
    this.emit("CASE_START", {}, true);
  }
  endCase(outcome: string, expectedActions: number | null = null, interpretationComplete = false) {
    if (!this.active) return;
    const outputComplete = !this.truncated && expectedActions !== null && expectedActions === this.actions && this.quoteRecords === 1 && this.finalRecords === 1;
    this.emit("CASE_END", { outcome, actionRecords: this.actions, quoteRecords: this.quoteRecords, finalRecords: this.finalRecords, expectedActions,
      omittedActions: expectedActions === null ? null : Math.max(0, expectedActions - this.actions),
      outputComplete, semanticsComplete: outputComplete && interpretationComplete && this.semanticComplete, truncated: this.truncated }, true);
    this.active = null; this.cases++;
  }
  finish(status: "COMPLETE" | "BLOCKED" | "TIMEOUT" | "FAILED" | "NOT_RUN") {
    if (this.ended) return;
    this.endCase(status === "TIMEOUT" ? "PROCESS_TIMEOUT" : "INTERRUPTED");
    this.emit("PROOF_END", { status: status === "COMPLETE" && (this.cases !== 3 || this.truncated) ? "INCOMPLETE" : status,
      completedCases: this.cases, expectedCases: 3, truncated: this.truncated, recordCount: this.sequence + 1,
      outputBytesBeforeEnd: this.bytes, authorizationIssuance: 0, walletActions: 0, transactions: 0 }, true);
    this.ended = true;
  }
}

// Use on extracted application JSONL. Missing/altered/redacted records are not evidence.
export function validateProofJsonl(text: string) {
  try {
    const lines = text.trim().split(/\r?\n/); let active: string | null = null, actions = 0, fingerprints = 0;
    let started = false, ended = false, quoteRecords = 0, finalRecords = 0;
    const seen = new Set<string>();
    for (let i = 0; i < lines.length; i++) {
      const record = JSON.parse(lines[i]);
      const { recordHash, ...payload } = record;
      if (record.schema !== schema || record.sequence !== i || ended || Buffer.byteLength(lines[i] + "\n") > RECORD_LIMIT
        || recordHash !== createHash("sha256").update(JSON.stringify(payload)).digest("hex")) return false;
      if (i === 0 && record.type !== "PROOF_START") return false;
      if (!["PROOF_START", "SOURCE_FINGERPRINT", "CASE_START", "QUOTE", "ACTION", "FINAL_MINIMUM", "CASE_END", "PROOF_END"].includes(record.type)) return false;
      if (i > 0 && record.type === "PROOF_START") return false;
      if (record.type === "SOURCE_FINGERPRINT") { if (started) return false; fingerprints++; }
      if (record.type === "CASE_START") {
        if (active || fingerprints === 0 || seen.has(record.caseId) || !["ETH_TO_ERC20", "ERC20_TO_ETH", "ERC20_TO_ERC20"].includes(record.caseId)) return false;
        active = record.caseId; seen.add(record.caseId); actions = 0; quoteRecords = 0; finalRecords = 0; started = true;
      }
      if (["ACTION", "QUOTE", "FINAL_MINIMUM", "CASE_END"].includes(record.type) && (!active || record.caseId !== active)) return false;
      if (record.type === "ACTION") { if (quoteRecords !== 1 || finalRecords || record.index !== actions++) return false; }
      if (record.type === "QUOTE") { if (++quoteRecords !== 1 || actions || finalRecords) return false; }
      if (record.type === "FINAL_MINIMUM") { if (quoteRecords !== 1 || ++finalRecords !== 1) return false; }
      if (record.type === "CASE_END") {
        if (record.actionRecords !== actions || record.quoteRecords !== quoteRecords || record.finalRecords !== finalRecords
          || (record.outputComplete && (record.expectedActions !== actions || quoteRecords !== 1 || finalRecords !== 1))
          || (record.semanticsComplete && !record.outputComplete)) return false;
        active = null;
      }
      if (record.type === "PROOF_END") {
        if (active || record.recordCount !== i + 1 || record.completedCases !== seen.size
          || (record.status === "COMPLETE" && (fingerprints === 0 || seen.size !== record.expectedCases || record.truncated))) return false;
        ended = true;
      }
    }
    return ended && Buffer.byteLength(text) <= OUTPUT_LIMIT;
  } catch { return false; }
}

export function installProofDeadline(writer: ProofJsonl, exit: () => void, durationMs = 180_000) {
  return setTimeout(() => { writer.finish("TIMEOUT"); exit(); }, durationMs);
}
