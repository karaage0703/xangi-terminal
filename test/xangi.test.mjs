import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createXangi } from '../src/xangi.mjs';
test('xangi bridge reads workspaces without fetching agents or creating conversations',async()=>{
 const calls=[];
 const bridge=createXangi({url:'http://127.0.0.1:18888',fetchImpl:async(url,options)=>{
  calls.push(url.pathname);assert.equal(options.method,'GET');assert.equal(options.redirect,'error');
  return Response.json({workspaces:[{id:'w',name:'work',path:'/tmp',isDefault:true,extra:'hidden'}]});
 }});
 assert.deepEqual(await bridge.catalog(),{workspaces:[{id:'w',name:'work',path:'/tmp',isDefault:true}]});
 assert.deepEqual(calls,['/api/workspaces']);assert.equal(bridge.chat,undefined);
});
test('native backend discovery, model selection and tool-assisted run preserve command and workspace',async()=>{
 const calls=[];let polls=0;
 const bridge=createXangi({url:'http://localhost',pollMs:0,fetchImpl:async(url,options)=>{
  calls.push({path:url.pathname,body:options.body&&JSON.parse(options.body)});
  if(url.pathname==='/api/runtime-settings')return Response.json({backend:{options:['codex','claude-code']}});
  if(url.pathname==='/api/models')return Response.json({models:[{id:'test-model'}]});
  if(url.pathname==='/api/agents')return Response.json({agents:[{id:'codex',name:'検証用',workspaceId:'ai'}]});
  if(url.pathname==='/api/agent-runs')return Response.json({run:{id:'run-1'}});
  if(url.pathname.endsWith('/close'))return Response.json({ok:true,lifecycle:'closed'});
  if(url.pathname.endsWith('/tool-history'))return Response.json({tools:[{toolName:'Bash'}]});
  if(polls++===0)return Response.json({run:{status:'running'}});
  return Response.json({run:{status:'succeeded',appSessionId:'s1',result:JSON.stringify({status:'executed',reason:'読み取り実行',checks:[{command:'pwd',cwd:'/tmp/project',output:'/tmp/project',exitCode:0}],command:'pwd',explanation:'説明',simulation:'/tmp/project',effects:'表示',evidence:'pwdで確認'})}});
 }});
 assert.equal((await bridge.backends())[0].id,'xangi:codex');
 const state={};const r=await bridge.suggest('codex','test-model',{mode:'command',text:'pwd',cwd:'/tmp/project'},state,'high');
 assert.equal(r.command,'pwd');assert.equal(state.run,null);
 const body=calls.find(c=>c.path==='/api/agent-runs').body;
 assert.equal(body.workspaceId,undefined);assert.equal(body.backend,undefined);assert.equal(body.model,undefined);assert.equal(body.effort,undefined);assert.equal(body.skipPermissions,false);assert.equal(body.localLlmMode,undefined);assert.equal(body.agentId,'codex');assert.match(body.task,/候補全体をツール実行/);assert.equal(r.previewKind,'executed');assert.equal(r.simulation,'/tmp/project');
});
test('accepted run survives transport errors without duplicate execution; changed command is rejected',async()=>{
 let posts=0,polls=0;
 const bridge=createXangi({url:'http://localhost',pollMs:0,fetchImpl:async(url)=>{
  if(url.pathname==='/api/agents')return Response.json({agents:[{id:'codex',name:'検証用',workspaceId:'ai'}]});
  if(url.pathname==='/api/agent-runs'){posts++;return Response.json({run:{id:'r'}});}
  if(polls++===0)throw Error('disconnected');
  return Response.json({run:{status:'succeeded',result:JSON.stringify({command:'rm -rf .',explanation:'x',simulation:'x',effects:'x',evidence:'x'})}});
 }});
 const state={},input={mode:'command',text:'pwd',cwd:'/tmp'};
 await assert.rejects(bridge.suggest('codex','',input,state),/disconnected/);
 await assert.rejects(bridge.suggest('codex','',{...input,text:'ls'},state),/前の環境確認/);
 await assert.rejects(bridge.suggest('codex','',input,state),/コマンドが変わりました/);
 assert.equal(posts,1);
});

test('default agent uses its stable ID and excludes teams',async()=>{
 const bridge=createXangi({url:'http://localhost',fetchImpl:async()=>Response.json({agents:[{id:'other',name:'別'},{id:'team:x',name:'チーム'},{id:'xangi:default',name:'既定'}]})});
 assert.equal((await bridge.defaultBackend()).id,'xangi:xangi:default');assert.equal((await bridge.backends()).length,2);
});

test('natural conversion sends no-environment-check task independently from preview',async()=>{
 let task;
 const bridge=createXangi({url:'http://localhost',pollMs:0,fetchImpl:async(url,options)=>{
  if(url.pathname==='/api/agents')return Response.json({agents:[{id:'codex',name:'検証用',workspaceId:'ai'}]});
  if(url.pathname==='/api/agent-runs'){task=JSON.parse(options.body).task;return Response.json({run:{id:'r'}});}
  return Response.json({run:{status:'succeeded',result:JSON.stringify({command:'pwd',explanation:'cwd',simulation:'',effects:'表示',evidence:'',status:'predicted',reason:'候補のみ',checks:[]})}});
 }});
 await bridge.suggest('codex','m',{mode:'natural',text:'今の場所',cwd:'/tmp',os:'macOS'},{});
 assert.doesNotMatch(task,/Linux/);assert.match(task,/macOS/);assert.match(task,/ツール呼び出し・環境調査・コマンド実行はしない/);assert.doesNotMatch(task,/候補全体をツール実行/);
});

test('AI workspace remains fixed across unrelated execution directories',async()=>{
 const bodies=[];
 const bridge=createXangi({url:'http://localhost',pollMs:0,fetchImpl:async(url,options)=>{
  if(url.pathname==='/api/agents')return Response.json({agents:[{id:'codex',name:'検証用',workspaceId:'ai'}]});
  if(url.pathname==='/api/agent-runs'){bodies.push(JSON.parse(options.body));return Response.json({run:{id:'r'}});}
  return Response.json({run:{status:'succeeded',result:JSON.stringify({command:'pwd',explanation:'場所',simulation:'',effects:'表示',evidence:'',status:'predicted',reason:'候補のみ',checks:[]})}});
 }});
 for(const cwd of ['/unregistered/project-a','/other/project-b'])await bridge.suggest('codex','m',{mode:'natural',text:'今の場所',cwd},{});
 assert.deepEqual(bodies.map(b=>b.agentId),['codex','codex']);
 assert.match(bodies[0].task,/unregistered\/project-a/);assert.match(bodies[1].task,/other\/project-b/);
});
test('deleted agent never falls back to default or execution workspace',async()=>{
 let posts=0;const bridge=createXangi({url:'http://localhost',fetchImpl:async(url)=>{
  if(url.pathname==='/api/agent-runs')posts++;
  return Response.json({agents:[{id:'xangi:default',name:'既定'}]});
 }});
 await assert.rejects(bridge.suggest('deleted','',{mode:'natural',text:'pwd',cwd:'/tmp'},{}),/エージェントが見つかりません/);assert.equal(posts,0);
});

test('completed single-use sessions close without force and retry cleanup without rerunning AI',async()=>{
 let posts=0,closes=0;const calls=[];
 const bridge=createXangi({url:'http://localhost',pollMs:0,fetchImpl:async(url,options)=>{
  calls.push(url.pathname);
  if(url.pathname==='/api/agents')return Response.json({agents:[{id:'codex',name:'test',workspaceId:'ai'}]});
  if(url.pathname==='/api/agent-runs'){posts++;return Response.json({run:{id:'r'}});}
  if(url.pathname.endsWith('/close')){closes++;assert.deepEqual(JSON.parse(options.body),{});if(closes===1)return Response.json({error:'busy'},{status:409});return Response.json({ok:true,lifecycle:'closed'});}
  if(url.pathname.endsWith('/tool-history'))return Response.json({tools:[]});
  return Response.json({run:{status:'succeeded',appSessionId:'s1',result:JSON.stringify({command:'pwd',explanation:'cwd',simulation:'',effects:'表示',evidence:'',status:'predicted',reason:'候補のみ',checks:[]})}});
 }});
 const state={},input={mode:'natural',text:'今の場所',cwd:'/tmp'};
 await assert.rejects(bridge.suggest('codex','',input,state),/セッション.*終了/);
 assert.ok(state.run);
 assert.equal((await bridge.suggest('codex','',input,state)).command,'pwd');
 assert.equal(posts,1);assert.equal(closes,2);assert.equal(state.run,null);
});
for(const status of ['failed','succeeded'])test(`closes ${status} run even when its result is unusable`,async()=>{
 let closed=false;
 const bridge=createXangi({url:'http://localhost',pollMs:0,fetchImpl:async(url)=>{
  if(url.pathname==='/api/agents')return Response.json({agents:[{id:'codex',name:'test',workspaceId:'ai'}]});
  if(url.pathname==='/api/agent-runs')return Response.json({run:{id:'r'}});
  if(url.pathname.endsWith('/close')){closed=true;return Response.json({ok:true,lifecycle:'closed'});}
  return Response.json({run:{status,appSessionId:'s',result:'not JSON',error:'backend failed'}});
 }});
 await assert.rejects(bridge.suggest('codex','',{mode:'natural',text:'cwd',cwd:'/tmp'},{}),status==='failed'?/backend failed/:/JSON/);
 assert.equal(closed,true);
});
