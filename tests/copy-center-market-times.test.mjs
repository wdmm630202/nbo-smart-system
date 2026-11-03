import test from 'node:test';
import assert from 'node:assert/strict';
import * as ops from '../apps/copy-center/operations.mjs';
import {renderTiming} from '../apps/copy-center/operations-ui.mjs';

test('默认直接列出马来西亚新加坡台湾的同一天参考时段',()=>{
 const result=ops.publishMarketSuggestions(undefined,'2026-11-04');
 assert.deepEqual(result.markets.map(m=>m.region),['马来西亚','新加坡','台湾']);
 for(const market of result.markets){
  assert.deepEqual(market.rows.map(r=>r.local),['2026-11-04T12:30','2026-11-04T20:00']);
  assert.deepEqual(market.rows.map(r=>r.beijing),market.rows.map(r=>r.local));
 }
 assert.equal(result.basis,'测试建议');
});
test('自定义账号时段按同一发布时间换算，保留跨日与夏令时',()=>{
 const account={timeZone:'America/New_York',times:['20:00'],basis:'账号后台',evidence:'后台录入时段'};
 for(const [date,next] of [['2026-07-20','2026-07-21T08:00'],['2026-11-04','2026-11-05T09:00']]){
  const result=ops.publishMarketSuggestions(account,date);
  assert.equal(result.basis,'账号后台');assert.equal(result.evidence,account.evidence);
  for(const market of result.markets)assert.equal(market.rows[0].local,next);
 }
});
test('海外华人和未选账号时也直接显示三个主要地区，其他时区默认折叠',()=>{
 const html=renderTiming({platform:'tiktok',region:'海外华人',accounts:[],scheduleDate:'2026-11-04',editorAccounts:{}});
 assert.match(html,/马来西亚/);assert.match(html,/新加坡/);assert.match(html,/台湾/);
 assert.match(html,/12:30/);assert.match(html,/20:00/);
 assert.match(html,/class="market-times"/);
 assert.match(html,/<details class="timing-other-zones"><summary>其他地区与时区换算/);
 assert.doesNotMatch(html,/<details class="timing-other-zones" open/);
 assert.doesNotMatch(html,/请先选择具体受众时区/);
 assert.match(html,/id="schedule-zone"/);
});
test('无效的来源时段不显示错误的目标当地时间',()=>{
 const result=ops.publishMarketSuggestions({timeZone:'America/New_York',times:['02:30']},'2026-03-08');
 for(const market of result.markets){assert.match(market.rows[0].error,/不存在/);assert.equal(market.rows[0].local,undefined);}
});
