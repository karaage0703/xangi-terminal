import {test} from 'node:test';
import assert from 'node:assert/strict';
import {previewReport} from '../src/preview.mjs';
const report=(command, output='actual')=>({command,status:'executed',reason:'読み取り',simulation:'invented',evidence:'調査',checks:[{command,cwd:'/tmp',output,exitCode:0}]});
test('common report accepts pipelines, scripts and arbitrary CLI names without command-specific rules',()=>{
 for(const command of ['find /tmp -name x -print', 'printf hello | wc -c', 'python3 -c "print(6*7)"', 'my-app inspect --json']){
  const r=previewReport(report(command),'/tmp',1);assert.equal(r.previewKind,'executed');assert.equal(r.simulation,'actual');
 }
 assert.match(previewReport(report('custom', ''),'/tmp',1).simulation,/出力はありません/);
});
test('execution requires matching cwd and candidate; absent tool history stays unverified',()=>{
 assert.throws(()=>previewReport(report('pwd'),'/other',1),/一致する実行報告/);
 const r=report('pwd');r.checks[0].command='ls';assert.throws(()=>previewReport(r,'/tmp',1),/一致する実行報告/);
 assert.equal(previewReport(report('pwd'),'/tmp',0).previewKind,'unverified');
});
test('changes use dry-run or prediction and unavailable results never invent output',()=>{
 for(const status of ['dry-run','predicted']) {
  const r={...report('rm example'),status,simulation:'対象1件を削除する予測',checks:[{command:'stat example',cwd:'/tmp',output:'file exists',exitCode:0}]};
  assert.equal(previewReport(r,'/tmp',1).previewKind,status);
 }
 const r={...report('custom'),status:'unavailable',reason:'権限不足',checks:[]};assert.equal(previewReport(r,'/tmp',0).simulation,'権限不足');
 assert.throws(()=>previewReport({...r,status:'dry-run'},'/tmp',1),/確認報告/);
});
