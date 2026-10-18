import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm, access, mkdir, realpath, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { createApp } from '../src/server.mjs';
async function fixture(t, options = {}) {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), 'xangi-terminal-')));
  const token = 'test-token-'.repeat(4);
  let suggestions = 0;
  if (options.xangi) options = {...options, xangi:{defaultBackend:async()=>({id:'xangi:codex',model:'fixture-model'}),...options.xangi}};
  const server = createApp({ token, cwd, host:'127.0.0.1', model:'fixture', ...options,
    suggest: async input => { suggestions++; return {command:input.text,explanation:'説明',simulation:'未実行',effects:'例'}; } });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const origin=`http://127.0.0.1:${server.address().port}`;let cookie='';
  t.after(async()=>{server.shutdownTerminals();server.closeAllConnections();await new Promise(r=>server.close(r));await rm(cwd,{recursive:true,force:true});});
  const request=(path,data={},headers={})=>fetch(origin+'/api/'+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie,...headers},body:JSON.stringify(data)});
  const login=async()=>{const r=await request('login',{token});cookie=r.headers.get('set-cookie').split(';')[0];};
  const connect=async(headers={}, workspace='')=>{
    const ws=new WebSocket(origin.replace('http','ws')+'/api/terminal'+(workspace?'?workspace='+encodeURIComponent(workspace):''),{headers:{Origin:origin,Cookie:cookie,...headers}});
    const events=[];let output='';
    ws.on('message',raw=>{const event=JSON.parse(raw);events.push(event);if(event.type==='data'){output+=event.data;ws.send(JSON.stringify({type:'ack',count:event.data.length}));}});
    await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});
    const wait=async(predicate)=>{const start=Date.now();while(!predicate(output,events)){if(Date.now()-start>5000)throw Error('PTY wait timeout: '+JSON.stringify(output));await new Promise(r=>setTimeout(r,15));}};
    await wait((_,e)=>e.some(x=>x.type==='ready'));
    return {ws,wait,send:data=>ws.send(JSON.stringify({type:'input',data})),output:()=>output,events};
  };
  return{cwd,origin,request,login,connect,suggestions:()=>suggestions};
}
test('HTTP authentication, origin, Host, content type and login throttling',async t=>{
 const f=await fixture(t);assert.equal((await f.request('info')).status,401);await f.login();
 assert.equal((await f.request('info',{}, {Origin:'https://evil.test'})).status,403);
 const code=await new Promise(resolve=>{const req=http.request(f.origin,{headers:{Host:'evil.test'}},res=>{res.resume();resolve(res.statusCode);});req.end();});assert.equal(code,403);
 assert.equal((await f.request('login',{}, {'Content-Type':'text/plain'})).status,415);
 for(let i=0;i<9;i++)assert.equal((await f.request('login',{token:'bad'})).status,401);
 assert.equal((await f.request('login',{token:'bad'})).status,429);
});
test('WebSocket rejects missing session and wrong origin before spawning a shell',async t=>{
 const f=await fixture(t);await assert.rejects(f.connect(),/403/);await f.login();await assert.rejects(f.connect({Origin:'https://evil.test'}),/403/);
});
test('direct execution needs no AI or confirmation; cd and export persist',async t=>{
 const f=await fixture(t);await f.login();const c=await f.connect();
 c.send("export TERMINAL_VALUE='persistent'; cd /tmp\r");
 c.send("printf '\\n%s\\n' \"$TERMINAL_VALUE\"; pwd\r");
 await c.wait(o=>o.includes('\r\npersistent\r\n/tmp\r\n'));
 assert.equal(f.suggestions(),0);assert.equal((await(await f.request('info')).json()).cwd,await realpath('/tmp'));
});
test('PTY supports interactive input, resize, Ctrl+C and command history',async t=>{
 const f=await fixture(t);await f.login();const c=await f.connect();
 c.ws.send(JSON.stringify({type:'resize',cols:91,rows:31}));c.send('stty size\r');await c.wait(o=>/[\r\n]31 91\r\n/.test(o));
 c.send('read -p "ANSWER: " value; printf "\\nreply:%s\\n" "$value"\r');await c.wait(o=>o.includes('ANSWER: '));c.send('hello\r');await c.wait(o=>o.includes('\r\nreply:hello\r\n'));
 c.send('sleep 60\r');await c.wait(o=>o.includes('sleep 60'));c.send('\x03');await c.wait(o=>o.includes('^C'));c.send("printf '\\nAFTER_INTERRUPT\\n'\r");await c.wait(o=>o.includes('\r\nAFTER_INTERRUPT\r\n'));
 c.send('\x1b[A\r');await c.wait(o=>(o.match(/\r\nAFTER_INTERRUPT\r\n/g)||[]).length>=2);
});
test('reconnect retains shell state; logout closes shell and revokes session',async t=>{
 const f=await fixture(t);await f.login();const c=await f.connect();
 c.send("export KEEP_ME=alive; printf '\\nSET\\n'\r");await c.wait(o=>o.includes('\r\nSET\r\n'));
 await new Promise(r=>{c.ws.once('close',r);c.ws.close();});const next=await f.connect();
 next.send('printf "\\n%s\\n" "$KEEP_ME"\r');await next.wait(o=>o.includes('\r\nalive\r\n'));
 const closed=new Promise(r=>next.ws.once('close',r));await f.request('logout');await closed;
 assert.equal((await f.request('info')).status,401);
});
test('AI preview never executes shell; provider secrets are not inherited',async t=>{
 const f=await fixture(t);await f.login();await f.request('suggest',{text:'touch preview-created'});await assert.rejects(access(join(f.cwd,'preview-created')));
 process.env.TERMINAL_TEST_SECRET='sensitive-value';const c=await f.connect();c.send('printf "\\nsecret=%s\\n" "$TERMINAL_TEST_SECRET"\r');await c.wait(o=>o.includes('\r\nsecret=\r\n'));delete process.env.TERMINAL_TEST_SECRET;
});
test('Tailnet identity is opt-in and restricted to configured owner',async t=>{
 const f=await fixture(t,{tailnetLogin:'owner@example.test'});
 assert.equal((await f.request('login',{}, {'Tailscale-User-Login':'other@example.test'})).status,401);
 assert.equal((await f.request('login',{}, {'Tailscale-User-Login':'owner@example.test'})).status,200);
 const plain=await fixture(t);assert.equal((await plain.request('login',{}, {'Tailscale-User-Login':'owner@example.test'})).status,401);
});
test('disconnect retains the shell until explicitly closed or session expiry',async t=>{
 const f=await fixture(t,{reconnectMs:40});await f.login();const c=await f.connect();
 c.send("export OLD_SHELL=yes; printf '\\nSAVED\\n'\r");await c.wait(o=>o.includes('\r\nSAVED\r\n'));
 await new Promise(r=>{c.ws.once('close',r);c.ws.close();});await new Promise(r=>setTimeout(r,120));
 const next=await f.connect();next.send('printf "\\nOLD:%s\\n" "$OLD_SHELL"\r');await next.wait(o=>o.includes('\r\nOLD:yes\r\n'));
});
test('unknown or out-of-range WebSocket messages close the connection',async t=>{
 const f=await fixture(t);await f.login();const c=await f.connect();
 const closed=new Promise(r=>c.ws.once('close',code=>r(code)));
 c.ws.send(JSON.stringify({type:'resize',cols:100000,rows:1}));assert.equal(await closed,1008);
});

test('workspace switching isolates shells and preserves state; invalid selection rejected',async t=>{
 const f=await fixture(t);await f.login();const first=await f.connect({},'default');
 first.send("export WORK=first; printf '\\nSAVED\\n'\r");await first.wait(o=>o.includes('\r\nSAVED\r\n'));
 const added=await(await f.request('workspace/add',{path:'/tmp'})).json();assert.ok(added.added);
 assert.equal((await f.request('workspace/add',{path:'/no-such-terminal-folder'})).status,400);
 assert.equal((await f.request('workspace/select',{id:'invalid'})).status,404);
 await f.request('workspace/select',{id:added.added});
 const second=await f.connect({},added.added);second.send('printf "\\nEMPTY:%s\\n" "$WORK"\r');await second.wait(o=>o.includes('\r\nEMPTY:\r\n'));
 assert.equal((await f.request('git',{workspace:'default'})).status,409);
 await new Promise(r=>{first.ws.once('close',r);first.ws.close();});
 await f.request('workspace/select',{id:'default'});const back=await f.connect({},'default');
 back.send('printf "\\nBACK:%s\\n" "$WORK"\r');await back.wait(o=>o.includes('\r\nBACK:first\r\n'));
 const a=new Promise(r=>back.ws.once('close',r)),b=new Promise(r=>second.ws.once('close',r));await f.request('logout');await Promise.all([a,b]);
});
test('local launch tickets need a token, expire, and can only be used once',async t=>{
 const f=await fixture(t,{launchMs:80});
 assert.equal((await f.request('launch')).status,401);
 const r=await f.request('launch',{}, {Authorization:'Bearer '+'test-token-'.repeat(4)});assert.equal(r.status,200);
 const ticket=new URL((await r.json()).url).hash.slice(8);
 assert.equal((await f.request('login',{launch:ticket})).status,200);
 assert.equal((await f.request('login',{launch:ticket})).status,401);
 const r2=await f.request('launch',{}, {Authorization:'Bearer '+'test-token-'.repeat(4)});
 const expired=new URL((await r2.json()).url).hash.slice(8);await new Promise(r=>setTimeout(r,120));
 assert.equal((await f.request('login',{launch:expired})).status,401);
 assert.equal((await f.request('launch',{}, {Authorization:'Bearer '+'test-token-'.repeat(4),Origin:'https://evil.test'})).status,403);
});

test('browser libraries retain their upstream license in served JavaScript',async t=>{
 const f=await fixture(t);
 for(const asset of ['xterm.js','fit.js']) {
  const r=await fetch(f.origin+'/'+asset);assert.equal(r.status,200);
  const source=await r.text();assert.ok(source.startsWith('/*!\n'));assert.match(source,/Copyright/i);assert.match(source,/Permission is hereby granted/);
 }
});
test('xangi workspace imports require authentication and registered IDs; chat endpoints are removed',async t=>{
 const f=await fixture(t,{xangi:{catalog:async()=>({workspaces:[{id:'registered',name:'登録済み',path:'/tmp',isDefault:true}]})}});
 assert.equal((await f.request('xangi/catalog')).status,401);await f.login();
 assert.equal((await f.request('xangi/workspace',{id:'missing',path:'/'})).status,404);
 const imported=await(await f.request('xangi/workspace',{id:'registered'})).json();
 await f.request('workspace/select',{id:imported.added});
 assert.equal((await(await f.request('info')).json()).cwd,await realpath('/tmp'));
 for(const endpoint of ['xangi/send','xangi/status'])assert.equal((await f.request(endpoint,{agentId:'anything',message:'ignored'})).status,404);
});
test('xangi disabled does not affect direct shell APIs',async t=>{const f=await fixture(t);await f.login();assert.equal((await f.request('xangi/catalog')).status,503);assert.equal((await f.request('info')).status,200);});
test('standalone text backend does not claim environment execution',async t=>{
 const f=await fixture(t);await f.login();
 const r=await(await f.request('suggest',{mode:'command',text:'du -sh '+join(f.cwd,'does-not-exist')})).json();
 assert.equal(r.previewKind,'predicted');assert.match(r.previewNote,/実環境での確認は行っていません/);
});

test('login uses the configured xangi default, not the first entry or fallback CWD',async t=>{
 let root='/tmp';
 const f=await fixture(t,{xangi:{catalog:async()=>({workspaces:[{id:'default',name:'別の場所',path:'/'},{id:'chosen',name:'既定の場所',path:root,isDefault:true}]})}});
 await f.login();
 const info=await(await f.request('workspaces')).json();
 assert.equal(info.workspaces[0].path,await realpath('/tmp'));assert.equal(info.workspaces[0].name,'既定の場所');
 const c=await f.connect();c.send('pwd\r');await c.wait(o=>o.includes('/tmp'));c.ws.close();
 root='/';await f.login();
 assert.equal((await(await f.request('workspaces')).json()).workspaces[0].path,'/');
});
test('login does not silently use fallback CWD when xangi default is unavailable',async t=>{
 for(const catalog of [async()=>{throw Error('offline');},async()=>({workspaces:[]}),async()=>({workspaces:[{isDefault:true,path:'/nonexistent-terminal-default'}]})]){
  const f=await fixture(t,{xangi:{catalog}});
  const r=await f.request('login',{token:'test-token-'.repeat(4)});
  assert.equal(r.status,503);assert.equal(r.headers.get('set-cookie'),null);
 }
});

test('xangi login inherits default backend/model and never exposes standalone endpoints',async t=>{
 let selected={id:'xangi:codex',model:'configured-model'};const calls=[];
 const xangi={catalog:async()=>({workspaces:[{id:'w',name:'default',path:'/tmp',isDefault:true}]}),defaultBackend:async()=>selected,backends:async()=>[{id:'xangi:codex',name:'codex'},{id:'xangi:claude-code',name:'claude-code'}],models:async()=>[],suggest:async(b,m,i)=>{calls.push([b,m]);return {command:i.text,explanation:'説明',simulation:'未確認',effects:'表示',evidence:'テスト'};}};
 const f=await fixture(t,{xangi});await f.login();
 let data=await(await f.request('backends')).json();
 assert.equal(data.active,'xangi:codex');assert.equal(data.model,'configured-model');assert.equal(data.backends.length,2);
 assert.equal((await f.request('backend/select',{id:'default'})).status,404);
 assert.equal((await f.request('suggest',{text:'pwd',mode:'command'})).status,200);
 assert.deepEqual(calls,[['codex','configured-model']]);
 selected={id:'xangi:claude-code',model:'other-model'};
 assert.equal((await(await f.request('backends')).json()).active,'xangi:codex');
 await f.login();data=await(await f.request('backends')).json();assert.equal(data.active,selected.id);assert.equal(data.model,selected.model);
});
test('unavailable xangi default backend fails login without a standalone fallback',async t=>{
 const f=await fixture(t,{xangi:{catalog:async()=>({workspaces:[{path:'/tmp',isDefault:true}]}),defaultBackend:async()=>{throw Error('offline');}}});
 assert.equal((await f.request('login',{token:'test-token-'.repeat(4)})).status,503);
});

test('agent selection rejects AI overrides and keeps execution directory',async t=>{
 const calls=[];
 const f=await fixture(t,{xangi:{defaultBackend:async()=>({id:'xangi:a',model:''}),catalog:async()=>({workspaces:[{path:'/tmp',isDefault:true}]}),backends:async()=>[{id:'xangi:a'},{id:'xangi:b'}],suggest:async(a,m,i)=>{calls.push([a,m,i.cwd]);return {command:i.text,explanation:'x',simulation:'x',effects:'x'};}}});
 await f.login();assert.equal((await f.request('backend/select',{id:'xangi:b',model:'override'})).status,400);
 assert.equal((await f.request('backend/select',{id:'xangi:b',effort:'high'})).status,400);
 assert.equal((await f.request('backend/select',{id:'xangi:missing'})).status,404);
 assert.equal((await f.request('backend/select',{id:'xangi:b'})).status,200);
 await f.request('suggest',{mode:'command',text:'pwd'});assert.deepEqual(calls,[['b','',await realpath('/tmp')]]);
 assert.equal((await(await f.request('info')).json()).cwd,await realpath('/tmp'));
});

test('unconfigured AI explains setup while the terminal remains usable', async t => {
 const f=await fixture(t,{model:undefined});await f.login();
 const backends=await(await f.request('backends')).json();
 assert.deepEqual(backends.backends,[]);assert.match(backends.warning,/AIは未設定/);
 const r=await f.request('suggest',{text:'pwd'});assert.equal(r.status,503);assert.match((await r.json()).error,/XANGI_URL/);
 const c=await f.connect();c.send('printf "\\nNO_AI_OK\\n"\r');await c.wait(o=>o.includes('\r\nNO_AI_OK\r\n'));
});
test('directory-only prompt preserves exit status for the next command', async t => {
 const f=await fixture(t);await f.login();const c=await f.connect();await c.wait(o=>/\x1b\[0m[$#] /.test(o));
 c.send('false\r');await c.wait(o=>o.includes('false'));
 c.send('printf "\\nSTATUS:%s\\n" "$?"\r');await c.wait(o=>o.includes('\r\nSTATUS:1\r\n'));
 assert.doesNotMatch(c.output(),/@/);assert.doesNotMatch(c.output(),/❯/);assert.doesNotMatch(c.output(),/exit 1|ready/);
});
test('preferences are authenticated and shared across independent browser sessions',async t=>{
 const f=await fixture(t,{backends:[{id:'a',name:'A',model:'a',llmUrl:'http://localhost:1'},{id:'b',name:'B',model:'b',llmUrl:'http://localhost:1'}]});
 assert.equal((await f.request('preferences')).status,401);
 const cookie=async()=>{const r=await f.request('login',{token:'test-token-'.repeat(4)});return r.headers.get('set-cookie').split(';')[0];};
 const a=await cookie(),b=await cookie();
 assert.equal((await f.request('backend/select',{id:'b'},{Cookie:a})).status,200);
 assert.equal((await f.request('preferences',{showExplanation:false},{Cookie:a})).status,200);
 assert.equal((await(await f.request('backends',{}, {Cookie:b})).json()).active,'b');
 assert.equal((await(await f.request('preferences',{}, {Cookie:b})).json()).showExplanation,false);
 assert.equal((await f.request('preferences',{backendId:'invalid'},{Cookie:b})).status,400);
});

test('ls colors directory output in PTY but not through a pipe',async t=>{
 const f=await fixture(t);await mkdir(join(f.cwd,'colored-directory'));await f.login();const c=await f.connect();
 c.send('ls\r');await c.wait(o=>/\x1b\[[0-9;]+mcolored-directory/.test(o));
 c.send('printf "\\nPIPE_BEGIN\\n"; ls | cat; printf "PIPE_END\\n"\r');
 await c.wait(o=>o.includes('\r\nPIPE_BEGIN\r\ncolored-directory\r\nPIPE_END\r\n'));
});

test('cd updates WebSocket, Git and AI target together for paths with spaces and Unicode', async t => {
 const inputs=[];
 const f=await fixture(t,{xangi:{catalog:async()=>({workspaces:[{path:'/tmp',isDefault:true}]}),suggest:async(a,m,input)=>{inputs.push(input);return {command:input.text,explanation:'x',simulation:'x',effects:'x'};}}});
 const target=join(f.cwd,'日本語 project');await mkdir(target);
 execFileSync('git',['init','--quiet',target]);await writeFile(join(target,'new.txt'),'test');
 await f.login();const c=await f.connect();
 c.send(`cd '${target}'; printf '\\nMOVED\\n'\r`);await c.wait(o=>o.includes('\r\nMOVED\r\n'));
 await c.wait((_,events)=>events.some(e=>e.type==='cwd' && e.cwd===target));
 assert.equal((await(await f.request('info')).json()).cwd,target);
 const git=await(await f.request('git',{workspace:'default'})).json();assert.equal(git.root,target);assert.equal(git.untracked,1);
 assert.equal((await f.request('suggest',{mode:'natural',text:'一覧'})).status,200);
 assert.equal(inputs[0].cwd,target);assert.equal(inputs[0].os,process.platform==='darwin'?'macOS':'Linux');
 c.send(`cd /; printf '\\nBACK_ROOT\\n'\r`);await c.wait(o=>o.includes('\r\nBACK_ROOT\r\n'));
 assert.equal((await(await f.request('info')).json()).cwd,'/');
});

test('same-directory terminals isolate shell state, continue output while hidden, and close independently', async t => {
 const f=await fixture(t);await f.login();const first=await f.connect();
 first.send("export TAB_VALUE=first; printf '\\nSAVED\\n'\r");await first.wait(o=>o.includes('\r\nSAVED\r\n'));
 const r=await f.request('terminal/new',{workspace:'default'});assert.equal(r.status,200);const secondId=(await r.json()).added;
 await f.request('workspace/select',{id:secondId});const second=await f.connect({},secondId);
 second.send("printf '\\nSECOND:%s\\n' \"$TAB_VALUE\"\r");await second.wait(o=>o.includes('\r\nSECOND:\r\n'));
 // More output than the replay/flow-control limits must not block a hidden shell.
 first.send("sleep 0.1; printf '%300000s' x; printf done > background-done\r");
 await new Promise(r=>{first.ws.once('close',r);first.ws.close();});
 for(let i=0;i<100;i++){try{if(await readFile(join(f.cwd,'background-done'),'utf8')==='done')break;}catch{}await new Promise(r=>setTimeout(r,20));}
 assert.equal(await readFile(join(f.cwd,'background-done'),'utf8'),'done');
 await f.request('workspace/select',{id:'default'});const back=await f.connect({},'default');
 back.send("printf '\\nFIRST:%s\\n' \"$TAB_VALUE\"\r");await back.wait(o=>o.includes('\r\nFIRST:first\r\n'));
 const closed=new Promise(r=>second.ws.once('close',r));assert.equal((await f.request('terminal/close',{id:secondId})).status,200);await closed;
 await assert.rejects(f.connect({},secondId),/403/);
 back.send("printf '\\nSTILL_ALIVE\\n'\r");await back.wait(o=>o.includes('\r\nSTILL_ALIVE\r\n'));
 const last=await(await f.request('terminal/close',{id:'default'})).json();assert.equal(last.workspaces.length,1);assert.notEqual(last.active,'default');
});
test('terminal API enforces authentication, valid IDs and eight terminal limit',async t=>{
 const f=await fixture(t);assert.equal((await f.request('terminal/new')).status,401);await f.login();
 assert.equal((await f.request('terminal/new',{workspace:'missing'})).status,404);
 assert.equal((await f.request('terminal/close',{id:'missing'})).status,404);
 const ids=[];for(let i=0;i<7;i++)ids.push((await(await f.request('terminal/new')).json()).added);
 assert.equal(new Set(ids).size,7);assert.equal((await f.request('terminal/new')).status,400);
 assert.equal((await f.request('terminal/close',{id:ids[0]})).status,200);assert.equal((await f.request('terminal/new')).status,200);
});
