// Collect only the bounded, sanitized output of the short-lived Preview probe.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const deployment = process.argv[2];
const cli = process.env.RMT_VERCEL_CLI_PATH;
if (!/^dpl_[a-zA-Z0-9]+$/.test(deployment || '') || !cli) throw Error('EXPLICIT_PREVIEW_AND_CLI_REQUIRED');
const out = path.join(root, 'evidence/live-trading-journey');
fs.mkdirSync(out, { recursive: true });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  for (const [kind, count] of [['peep', 20], ['matrix', 50]]) {
    const evidence = { baseSha: 'a79a78fd0025eb12456c4adbdde713a237439dba', previewDeployment: deployment,
      seed: 5272840, startedAt: new Date().toISOString(), kind, rows: [], legacyExecutorCalls: 0,
      realWalletRequests: 0, signatures: 0, realTransactions: 0 };
    for (let index = 0; index < count; index++) {
      let body;
      try {
        const output = execFileSync(process.execPath, [cli, 'curl', `/api/journey-proof/${kind}/${index}`,
          '--deployment', deployment, '--scope', 'team_S3IkMdoAkIRdvDsXY5XZni0w', '--', '--silent', '--max-time', '180'],
        { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 190000, maxBuffer: 1024 * 1024 });
        body = JSON.parse(output);
      } catch { throw Error(`SANITIZED_PREVIEW_COLLECTION_FAILED_${kind}_${index}`); }
      if (body.diagnosticOnly !== true || body.seed !== 5272840 || body.index !== index
        || body.rows.length !== (kind === 'matrix' ? 2 : 4)
        || body.walletRequests !== 0 || body.signatures !== 0 || body.transactions !== 0) throw Error('PROBE_CONTRACT_INVALID');
      if (body.rows.some(row => row.configuration === 'ZEROX_CREDENTIAL_NOT_PRESENT')) throw Error('PREVIEW_PROVIDER_NOT_CONFIGURED');
      evidence.rows.push(...body.rows.map(row => ({ observation: index + 1, ...row })));
      evidence.finishedAt = new Date().toISOString();
      fs.writeFileSync(path.join(out, `${kind}-live.json`), JSON.stringify(evidence, null, 2) + '\n');
      console.log(JSON.stringify({ kind, observation: index + 1, results: body.rows.map(row => row.status) }));
      await delay(1000);
    }
    const keys = [...new Set(evidence.rows.flatMap(row => Object.keys(row)))];
    const cell = value => JSON.stringify(value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value));
    fs.writeFileSync(path.join(out, `${kind}-live.csv`), [keys.map(cell).join(','), ...evidence.rows.map(row => keys.map(key => cell(row[key])).join(','))].join('\n') + '\n');
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
