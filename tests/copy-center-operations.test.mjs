import test from 'node:test';
import assert from 'node:assert/strict';
import * as ops from '../apps/copy-center/operations.mjs';

test('当地发布时间正确转换日期，四个主要市场无时差，美国自动处理夏令时',()=>{
  for(const zone of ['Asia/Shanghai','Asia/Singapore','Asia/Kuala_Lumpur','Asia/Taipei'])assert.equal(ops.localToInstant('2026-10-20T20:00',zone),'2026-10-20T12:00:00.000Z');
  assert.equal(ops.localToInstant('2026-07-20T20:00','America/New_York'),'2026-07-21T00:00:00.000Z');
  assert.equal(ops.localToInstant('2026-12-20T20:00','America/New_York'),'2026-12-21T01:00:00.000Z');
  assert.equal(ops.localTime('2026-07-21T00:00:00Z','Asia/Shanghai'),'2026-07-21T08:00');
  assert.throws(()=>ops.localToInstant('2026-03-08T02:30','America/New_York'),/不存在/);
  assert.throws(()=>ops.localToInstant('2026-11-01T01:30','America/New_York'),/重复/);
});
test('套餐变更、共同政策变化、到期都提示复核，已复核只对当时事实生效',()=>{
  const ad={facts:'底片全送',location:'广州',offerId:'offer-a'},config={settings:{facts:'拍完即传'},offers:[{id:'offer-a',name:'基础套餐',facts:'268元拍2套',validFrom:'2026-01-01',validTo:'2026-10-31',revision:1}]};
  const token=ops.factStamp(ad,config),version={body:'真实内容',factStamp:token};
  assert.deepEqual(ops.reviewReasons(ad,version,config,'2026-10-20'),[]);
  assert.ok(ops.reviewReasons(ad,version,{...config,offers:[{...config.offers[0],facts:'新套餐',revision:2}]},'2026-10-20').length);
  assert.ok(ops.reviewReasons(ad,version,{...config,settings:{facts:'新的交付政策'}},'2026-10-20').length);
  assert.match(ops.reviewReasons(ad,version,config,'2026-11-01').join(' '),/到期/);
  assert.match(ops.reviewReasons(ad,{body:'旧内容'},config,'2026-10-20').join(' '),/核对/);
});
test('账号时段验证和建议来源独立，海外泛地区必须明确时区',()=>{
  assert.throws(()=>ops.validateAccount({name:'账号',platform:'youtube',region:'海外华人',timeZone:''}),/时区/);
  assert.throws(()=>ops.validateAccount({name:'账号',platform:'youtube',timeZone:'Mars/Bad'}),/时区/);
  assert.throws(()=>ops.validateAccount({name:'账号',platform:'youtube',timeZone:'Asia/Shanghai',times:'25:00'}),/时间/);
  const a=ops.validateAccount({id:'acc-a',name:'新加坡官号',platform:'tiktok',role:'官号',region:'新加坡',timeZone:'Asia/Singapore',times:'12:30 20:00'});
  const rec=ops.publishSuggestions(a,'2026-10-20');assert.equal(rec.rows[1].beijing,'2026-10-20T20:00');assert.equal(rec.basis,'测试建议');
});
test('大备份先恢复全部素材再恢复留底，每份文件大小可重新导入',()=>{
 const ads=Array.from({length:90},(_,i)=>({code:'NB-'+i,name:'素材'+i,body:'字'.repeat(50000)})),records=[{id:'receipt-1',materialCode:'NB-89',snapshot:{body:'已发布的原文'}}];
 const parts=ops.backupParts(ads,records),seen=new Set();assert.ok(parts.length>=3);
 for(const part of parts){assert.ok(new TextEncoder().encode(JSON.stringify(part)).byteLength<25000000);for(const ad of part.ads)seen.add(ad.code);for(const record of part.publications)assert.ok(seen.has(record.materialCode),'相关素材必须先恢复');}
 assert.equal(parts.flatMap(p=>p.ads).length,90);assert.equal(parts.flatMap(p=>p.publications).length,1);
});
