import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.mjs';
import { createLauncher, launchTicket } from '../src/extension.mjs';
test('extension launcher requires bridge token and never sends terminal credentials',async t=>{
 const s=createLauncher('bridge-secret','https://terminal.example.test',async()=> 'https://terminal.example.test/#launch=one-use');await new Promise(r=>s.listen(0,'127.0.0.1',r));
 t.after(()=>{s.closeAllConnections();s.close();});const url=`http://127.0.0.1:${s.address().port}`;
 assert.equal((await fetch(url)).status,401);
 const r=await fetch(url,{headers:{Authorization:'Bearer bridge-secret'}});assert.equal(r.status,200);
 const html=await r.text();assert.match(html,/location.replace/);assert.doesNotMatch(html,/bridge-secret/);assert.match(html,/#launch=one-use/);
 assert.throws(()=>createLauncher('token','https://u:p@example.com'));
});

test('extension issues an authenticated one-use terminal login without key entry',async t=>{
 const token='terminal-private-token-'.repeat(3);
 const app=createApp({token,cwd:'/tmp'});await new Promise(r=>app.listen(0,'127.0.0.1',r));
 const origin=`http://127.0.0.1:${app.address().port}`;
 const launcher=createLauncher('bridge-secret',origin,()=>launchTicket(origin,token,app.address().port));await new Promise(r=>launcher.listen(0,'127.0.0.1',r));
 t.after(()=>{app.shutdownTerminals();for(const s of [app,launcher]){s.closeAllConnections();s.close();}});
 const url=`http://127.0.0.1:${launcher.address().port}`;
 assert.equal((await fetch(url)).status,401);
 const html=await(await fetch(url,{headers:{Authorization:'Bearer bridge-secret'}})).text();
 assert(!html.includes(token));let link;vm.runInNewContext(html.match(/<script>(.*?)<\/script>/s)[1],{URL,URLSearchParams,location:{origin:'https://xangi.example.test',replace:value=>{link=value;}}});assert.equal(new URLSearchParams(new URL(link).hash.slice(1)).get('xangiHome'),'https://xangi.example.test/');const ticket=new URLSearchParams(new URL(link).hash.slice(1)).get('launch');assert(ticket);
 const login=()=>fetch(origin+'/api/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({launch:ticket})});
 assert.equal((await login()).status,200);assert.equal((await login()).status,401);
});
