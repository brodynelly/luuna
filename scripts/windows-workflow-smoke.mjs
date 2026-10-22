// Windows diagnostic smoke on the current working tree. This supplements, and
// does not replace, the stricter clean-revision M3 acceptance harness.
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes, createHash } from 'node:crypto';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const out = path.resolve(option('--out', path.join(process.env.LOCALAPPDATA, 'Luuna', 'verification', `workflow-${Date.now()}`)));
if (existsSync(out)) throw new Error('Use a new output directory');
mkdirSync(out, { recursive: true });
const provider = option('--provider', 'openrouter');
const model = option('--model', 'openai/gpt-4.1-mini');
const token = randomBytes(32).toString('hex');
const base = 'http://127.0.0.1:4252';
const repo = path.join(out, 'fixture');
// Store-packaged hosts may redirect LocalAppData through a long package path.
// Python 3.11 module imports can fail beyond MAX_PATH even when Git can read it.
const dataDir = path.join(process.env.USERPROFILE, '.luuna', 'checks', randomBytes(5).toString('hex'));
const checks = [];
const summaries = [];
const secrets = Object.entries(process.env).filter(([n,v]) => /API_KEY$/.test(n) && v).map(([,v]) => v);
const clean = (text) => secrets.reduce((s, secret) => s.replaceAll(secret, '[REDACTED]'), String(text)).replaceAll(token, '[TOKEN]');
function record(name, ok, detail = '') { checks.push({name, ok: Boolean(ok), detail: clean(detail)}); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${clean(detail)}`); }
function git(...a) { return execFileSync('git', ['-C', repo, '-c', 'core.autocrlf=false', '-c', 'core.hooksPath=' + path.join(out, 'no-hooks'), ...a], {encoding:'utf8', env:{...process.env, GIT_CONFIG_GLOBAL:'NUL', GIT_CONFIG_NOSYSTEM:'1', GIT_AUTHOR_NAME:'Luuna fixture', GIT_AUTHOR_EMAIL:'fixture@example.invalid', GIT_COMMITTER_NAME:'Luuna fixture', GIT_COMMITTER_EMAIL:'fixture@example.invalid'}}).trim(); }
async function api(method, route, body) {
 const response = await fetch(base + '/api/v1' + route, {method, headers:{Authorization:`Bearer ${token}`, 'Content-Type':'application/json'}, body: body ? JSON.stringify(body) : undefined, signal:AbortSignal.timeout(30000)});
 const text = await response.text(); let data; try { data=JSON.parse(text); } catch { data={error:clean(text)}; } return {status:response.status, data};
}
async function requireApi(method, route, body, expected) { const r = await api(method,route,body); if (!(Array.isArray(expected) ? expected : [expected]).includes(r.status)) throw new Error(`${method} ${route}: ${r.status} ${clean(JSON.stringify(r.data))}`); return r.data; }
async function waitFor(fn, seconds = 240) { const end = Date.now()+seconds*1000; while(Date.now()<end) { const result=await fn(); if(result) return result; await sleep(250); } throw new Error('Timed out waiting for runtime state'); }
mkdirSync(path.join(repo,'src'), {recursive:true});
mkdirSync(path.join(out,'no-hooks'));
writeFileSync(path.join(repo,'.gitignore'),'__pycache__/\n');
writeFileSync(path.join(repo,'src','__init__.py'),'');
writeFileSync(path.join(repo,'src','greeting.py'),"def greeting(name):\n    return 'baseline'\n");
writeFileSync(path.join(repo,'test_greeting.py'),`import unittest\nfrom src.greeting import greeting\nclass GreetingTest(unittest.TestCase):\n    def test_greeting(self):\n        self.assertIsInstance(greeting('Ada'), str)\n`);
git('init','-q','-b','main'); git('remote','add','origin','https://example.invalid/windows-workflow.git'); git('add','-A'); git('-c','commit.gpgsign=false','commit','-qm','fixture');
const before = {head:git('rev-parse','HEAD'),status:git('status','--porcelain'),source:readFileSync(path.join(repo,'src','greeting.py'),'utf8')};
const binary=path.resolve(option('--runtime',path.join(root,'target','debug','luuna-runtime.exe')));
const runtime=spawn(binary,[],{cwd:root,env:{...process.env,LUUNA_API_TOKEN:token,LUUNA_DATA_DIR:dataDir,LUUNA_PORT:'4252',LUUNA_PI_COMMAND:option('--pi',process.execPath),LUUNA_PI_PROVIDER:provider,LUUNA_PI_MODEL:model},stdio:['ignore','ignore','pipe'],windowsHide:true});
runtime.stderr.on('data',chunk=>writeFileSync(path.join(out,'runtime.log'),clean(chunk),{flag:'a'}));
runtime.on('error',error=>record('runtime spawn',false,error.message));
let health;
try {
 health=await waitFor(()=>fetch(base+'/health').then(r=>r.json()).catch(()=>null),30);
 record('current Windows runtime connected',health.status==='ok',health.build_identity);
 await requireApi('POST','/projects',{id:'windows',name:'Windows workflow',repositories:[{id:'app',path:repo}]},201);
 const recipe={id:'unit',executable:'python',args:['-m','unittest','-v'],required:true,timeout_seconds:60,capabilities:['python'],cwd:'.'};
 const manifest={schema_version:'0.1',id:'windows',name:'Windows workflow',revision:1,repositories:[{id:'app',remote:'https://example.invalid/windows-workflow.git',default_branch:'main',profiles:['python'],execution:'native',checks:[recipe]}],relationships:[],policy:{approval:'plan',testing_prerequisite:true,publish:'automatic_pr',merge:'human',max_explorers:1,max_implementers:1,max_task_repairs:2}};
 await requireApi('PUT','/projects/windows/manifest',{expected_revision:0,manifest},200);
 const baseline=await requireApi('POST','/projects/windows/baselines',{repository_id:'app'},202);
 const baselineRun=baseline.id ?? baseline.run?.id ?? baseline.run_id;
 const settledBaseline=await waitFor(async()=>{const r=await requireApi('GET',`/runs/${baselineRun}`,null,200);return ['completed','failed','testing_blocked'].includes(r.state)?r:null;});
 record('real Python baseline passed',settledBaseline.state==='completed',settledBaseline.state);
 if(settledBaseline.state!=='completed') throw new Error('Baseline blocked');
 async function scenario(name,intent,criteria,paths) {
  const ticket=await requireApi('POST','/projects/windows/tickets',{idempotency_key:name,title:name,intent,acceptance_criteria:criteria,repository_ids:['app']},201);
  const opened=await requireApi('POST',`/tickets/${ticket.id}/plans`,{task:{repository_id:'app',paths,operations:['read','write']},budgets:{max_attempts:3,timeout_seconds:240,cost_usd_micros:1500000}},201);
  const id=opened.run.id; const p=opened.plan;
  const missing=await api('POST',`/runs/${id}/implement`,{provider,model}); record(`${name}: missing approval refused`,[409,422].includes(missing.status));
  await requireApi('POST',`/plans/${p.id}/approvals`,{plan_revision:p.revision,plan_hash:p.hash,approved_by:'windows-workflow-smoke'},[200,201]);
  await requireApi('POST',`/runs/${id}/implement`,{provider,model},202);
  await waitFor(async()=>{const r=await requireApi('GET',`/runs/${id}`,null,200);return !['implementing','approved'].includes(r.state)?r:null;});
  let candidate=await requireApi('GET',`/runs/${id}/candidate`,null,200);
  record(`${name}: real writer produced a candidate`,candidate.evidence?.status==='pending',candidate.evidence?.reason??candidate.evidence?.status);
  summaries.push({name,run_id:id,plan_hash:p.hash});
  if(!candidate.evidence) return;
  const hash=candidate.evidence.candidate.hash;
  const stale=await api('POST',`/runs/${id}/validate`,{candidate_hash:'sha256:'+'0'.repeat(64),provider,model}); record(`${name}: stale candidate refused`,[409,422].includes(stale.status));
  await requireApi('POST',`/runs/${id}/validate`,{candidate_hash:hash,provider,model},202);
  candidate=await waitFor(async()=>{const r=await requireApi('GET',`/runs/${id}/candidate`,null,200);return r.active?null:r;});
  const first=candidate.evidence;
  if(first.status==='failed' && candidate.repair_allowed && first.results?.some(r=>r.status==='failed')) {
   record(`${name}: actual check failure prevented review`,first.review==null);
   await requireApi('POST',`/runs/${id}/repair`,{candidate_hash:hash,provider,model},202);
   await waitFor(async()=>{const r=await requireApi('GET',`/runs/${id}`,null,200);return r.state==='implementing'?null:r;});
   candidate=await requireApi('GET',`/runs/${id}/candidate`,null,200);
   record(`${name}: repair produced a new candidate revision`,candidate.evidence.candidate.revision===2 && candidate.evidence.candidate.hash!==hash);
   if(candidate.evidence.status==='pending') {
    await requireApi('POST',`/runs/${id}/validate`,{candidate_hash:candidate.evidence.candidate.hash,provider,model},202);
    candidate=await waitFor(async()=>{const r=await requireApi('GET',`/runs/${id}/candidate`,null,200);return r.active?null:r;});
   }
  }
  const ev=candidate.evidence;
  const events=await requireApi('GET',`/runs/${id}/events?after=0`,null,200);
  writeFileSync(path.join(out,name+'-candidate.json'),clean(JSON.stringify(candidate,null,2)));
  record(`${name}: required commands passed`,ev.results?.length===1 && ev.results.every(r=>r.status==='passed'),ev.results?.map(r=>r.status).join(','));
  record(`${name}: independent reviewer accepted the exact candidate`,ev.status==='reviewed' && ev.review?.verdict==='passed' && ev.review.candidate_hash===ev.candidate.hash && ev.review.reviewer_session!==ev.implementer_session,ev.reason??ev.status);
  record(`${name}: original checkout preserved`,git('rev-parse','HEAD')===before.head && git('status','--porcelain')===before.status && readFileSync(path.join(repo,'src','greeting.py'),'utf8')===before.source);
 }
 await scenario('feature',"Change only src/greeting.py so greeting(name) returns 'Hello, <name>!' (for Ada: 'Hello, Ada!').",["greeting('Ada') returns 'Hello, Ada!'","Only src/greeting.py changes"],['src/greeting.py']);
 await scenario('repair',"Change src/greeting.py to return 'hello ' + name. Add a unittest assertion in test_greeting.py expecting greeting('Ada') to equal 'Hello, Ada!'. Perform both requested edits exactly; validation will report the deliberate mismatch for a later repair.",["greeting('Ada') returns 'Hello, Ada!'","The unittest asserts the exact greeting"],['src/greeting.py','test_greeting.py']);
} catch(error) {record('workflow completed without harness error',false,error.message);}
finally {
 if(runtime.exitCode===null && runtime.signalCode===null) {const exited=once(runtime,'exit');runtime.kill();await exited;}
 const report={kind:'Windows current-tree diagnostic; not M3 acceptance',provider,model,health,data_directory:dataDir,binary_sha256:createHash('sha256').update(readFileSync(binary)).digest('hex'),checks,summaries};
 writeFileSync(path.join(out,'report.json'),clean(JSON.stringify(report,null,2)));
 console.log(`Report: ${out}; ${checks.filter(c=>c.ok).length}/${checks.length} passed`);
 process.exitCode=checks.every(c=>c.ok)?0:1;
}
