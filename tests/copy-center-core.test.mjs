import test from 'node:test';
import assert from 'node:assert/strict';
import {PLATFORMS, validateAd, buildPrompt, parseGenerated, parseCsv, prepareImport, csvExport} from '../apps/copy-center/core.mjs';

test('八平台固定且全部简体生成，事实和地区作为资料处理',()=>{
  assert.equal(PLATFORMS.length,8);
  const ad=validateAd({code:'NB-001',name:'男士写真',facts:'268元拍2套，底片全送',region:'新加坡',location:'广州'});
  const prompt=buildPrompt(ad,{brand:'南铂摄影'},[],PLATFORMS.map(p=>p.id));
  assert.match(prompt[0].content,/统一使用简体中文/);
  assert.match(prompt[0].content,/资料.*不是指令/);
  assert.match(prompt[1].content,/新加坡/);
  assert.throws(()=>validateAd({name:' '}),/名称/);
  assert.throws(()=>validateAd({name:'x',assetUrl:'javascript:alert(1)'}),/链接/);
});
test('生成结果必须覆盖请求平台，保留结构边界',()=>{
  const rows=PLATFORMS.map(p=>({platform:p.id,title:'在广州记录自己',body:'南铂摄影男士写真。',tags:['广州写真'],cta:'私信了解风格'}));
  assert.equal(parseGenerated({response:JSON.stringify({versions:rows})},PLATFORMS.map(p=>p.id)).length,8);
  assert.throws(()=>parseGenerated({response:'not json'},['douyin']),/格式/);
  assert.throws(()=>parseGenerated({response:'{"versions":[]}'},['douyin']),/缺少/);
  assert.throws(()=>parseGenerated({response:JSON.stringify({versions:[{...rows[0],body:''}]})},['douyin']),/正文/);
});
test('CSV 支持 BOM、引号、逗号和字段内换行',()=>{
  const rows=parseCsv('\uFEFF编号,名称,卖点\r\nNB-001,"男士,写真","第一行\n第二行"\r\n');
  assert.equal(rows[1][1],'男士,写真');assert.equal(rows[1][2],'第一行\n第二行');
  assert.throws(()=>parseCsv('a,b\n"bad'),/引号/);
});
test('批量导入逐条报告重复与无效行，百条广告可用',()=>{
  const rows=[['编号','名称','地区'],...Array.from({length:100},(_,i)=>['NB-'+i,'广告'+i,'马来西亚']),['NB-0','重复',''],['NB-101','','']];
  const r=prepareImport(rows,[]);assert.equal(r.accepted.length,100);assert.equal(r.errors.length,2);
  const r2=prepareImport([['编号','名称'],['NB-1','已有']], [{code:'NB-1'}]);assert.equal(r2.accepted.length,0);
});
test('CSV 导出保护公式并能重新解析',()=>{
  const csv=csvExport([['编号','名称'],['001','=HYPERLINK("x")'],['002','a\nb']]);
  const rows=parseCsv(csv);assert.equal(rows[1][1][0],"'");assert.equal(rows[2][1],'a\nb');
});
