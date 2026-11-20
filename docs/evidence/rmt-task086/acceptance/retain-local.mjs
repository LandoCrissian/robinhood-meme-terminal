// Retain only explicit public/synthetic evidence files, never a directory tree.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const here=dirname(fileURLToPath(import.meta.url)),repo=resolve(here,'../../../..');
const temp=process.argv[2];if(!temp)throw Error('Pass the original task-specific temporary parent directory');
const hash=b=>createHash('sha256').update(b).digest('hex'),members=[];
const selected=[
 ['rmt-task086-acceptance-local4/task086-collection-acceptance.json','local4/task086-collection-acceptance.json'],
 ['rmt-task086-acceptance-local4/task086-real-collection-fork.json','local4/task086-real-collection-fork.json'],
 ['rmt-task086-acceptance-local4/chain/seaport-acquisition-deployment.json','local4/chain/seaport-acquisition-deployment.json'],
 ['rmt-task086-acceptance-local4/chain/seaport-acquisition-fixture-evidence.json','local4/chain/seaport-acquisition-fixture-evidence.json'],
 ['rmt-task086-acceptance-local4.mjs','local4/standalone-runner.mjs'],
 ['rmt-task086-acceptance-local/native-order-admission-evidence.json','failures/local/native-order-admission-evidence.json'],
 ['rmt-task086-acceptance-local2/native-order-admission-evidence.json','failures/local2/native-order-admission-evidence.json'],
 ['rmt-task086-acceptance-local3/task086-collection-acceptance.json','failures/local3/task086-collection-acceptance.json'],
 ['rmt-task086-acceptance-local3/standalone-failure.txt','failures/local3/standalone-failure.txt'],
];
const scan=resolve(temp,'rmt-task086-acceptance-selected-plaintext');mkdirSync(scan,{recursive:true});
for(const [original,path]of selected){
 const raw=readFileSync(resolve(temp,original)),stored=gzipSync(raw,{level:9,mtime:0}),target=resolve(here,path+'.gz');
 mkdirSync(dirname(target),{recursive:true});writeFileSync(target,stored);
 const plain=resolve(scan,path);mkdirSync(dirname(plain),{recursive:true});writeFileSync(plain,raw);
 members.push({original,path:path+'.gz',rawSha256:hash(raw),rawBytes:raw.length,storedSha256:hash(stored),storedBytes:stored.length,encoding:'gzip mtime0 original bytes'});
}
const sourceFiles=['scripts/seaport-acquisition/task086-collection-acceptance.mjs','scripts/seaport-acquisition/task086-collection-acceptance.test.mjs','scripts/seaport-acquisition/fixture-run.mjs','scripts/seaport-acquisition/compiler.mjs','scripts/seaport-acquisition/browser-run.mjs'];
const fixture=JSON.parse(readFileSync(resolve(temp,selected[3][0]))),manifest={
 schemaVersion:1,scope:'LOCAL31337_SYNTHETIC_ACCEPTANCE_AND_READ_ONLY_REAL_NFT_FORK_CALLS',production:false,
 base:'91e7c1914d2fd87287b3b4b0f243c982c1faf36f',sourceState:'UNCOMMITTED_TASK086_SOURCE_CAPTURED_AFTER_SUCCESSFUL_RUN',
 command:'node --max-old-space-size=384 C:/Users/RMT/AppData/Local/Temp/rmt-task086-acceptance-local4.mjs',
 cwd:'C:/Users/RMT/Documents/Codex/2026-11-11/rmt-task086',nodeVersion:process.version,
 sourceFiles:sourceFiles.map(path=>({path,sha256:hash(readFileSync(resolve(repo,path))),executedByStandaloneRunner:path!=='scripts/seaport-acquisition/browser-run.mjs'&& !path.endsWith('.test.mjs')})),
 candidateCompilerInputSha256:fixture.sourceInputs.candidate.inputSha256,
 compilerVersion:fixture.sourceInputs.candidate.compilerVersion,compilerExecutableSha256:fixture.sourceInputs.candidate.executableSha256,
 upstream:fixture.upstream,members,
 limitations:['This is a standalone local fork helper run, not PostgreSQL/browser acceptance.','Source files were hashed after the successful run; source was uncommitted at execution. Browser integration was not invoked by this standalone command.','Early local/local2 reports are incomplete; their original console failure logs were not retained. Reported witness/client and host memory interruptions are not passed tests.','Local3 completes six negatives then fee-recipient configuration while ON correctly reverts InvalidPolicy. The corrected local4 helper uses OFF/configure/ON; the partial local3 attempt remains failed.','No private keys, Anvil state, PostgreSQL data, environment files, authentication logs or broad temporary trees are retained.'],
 privacy:{status:'PENDING_UNCHANGED_GITLEAKS_SCAN',configPath:'.gitleaks.toml',configSha256:hash(readFileSync(resolve(repo,'.gitleaks.toml')))}
};
writeFileSync(resolve(here,'integrity-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({retained:members.length,rawBytes:members.reduce((n,m)=>n+m.rawBytes,0),storedBytes:members.reduce((n,m)=>n+m.storedBytes,0),scanDirectory:scan}));
