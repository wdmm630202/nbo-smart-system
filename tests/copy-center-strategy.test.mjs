import test from 'node:test';
import assert from 'node:assert/strict';
import {assessHeat} from '../apps/copy-center/strategy.mjs';

const current={accountId:'official-a',platform:'douyin',format:'short',traffic:'organic',windowHours:72,metric:'views',value:250};
const record=(id,value=100,extra={})=>({...current,id,value,...extra});
test('热度仅使用同账号、平台、形式、流量来源、观察窗口和指标的历史中位数',()=>{
 const history=Array.from({length:12},(_,i)=>record('p'+i));
 for(const extra of [{accountId:'creator-b'},{platform:'youtube'},{format:'photo'},{traffic:'paid'},{windowHours:24},{metric:'likes'}])history.push(record('other',999999,extra));
 const result=assessHeat(current,history);
 assert.equal(result.sampleSize,12);assert.equal(result.median,100);assert.equal(result.ratio,2.5);assert.equal(result.label,'高于近期基线');
});
test('未知数据与真实零分开，样本不足和零中位数不伪造热度',()=>{
 const history=Array.from({length:10},(_,i)=>record('p'+i));
 assert.equal(assessHeat({...current,value:null},history).label,'未录入数据');
 assert.equal(assessHeat({...current,value:0},history).ratio,0);
 assert.equal(assessHeat(current,history.slice(0,9)).label,'样本待积累');
 assert.equal(assessHeat(current,history.map(p=>({...p,value:0}))).label,'基线为零，暂不判断');
 assert.equal(assessHeat(current,history.map(p=>({...p,value:null}))).sampleSize,0);
});
test('排除当前发布，按观察时间取最近20条，拒绝未标识来源的比较',()=>{
 const history=Array.from({length:25},(_,i)=>record('p'+i,i+1,{observedAt:new Date(Date.UTC(2026,9,i+1)).toISOString()}));
 history.push(record('this',1000000,{observedAt:'2026-11-01'}));
 const result=assessHeat({...current,id:'this'},history);
 assert.equal(result.sampleSize,20);assert.equal(result.median,15.5);
 assert.equal(assessHeat({...current,accountId:''},history).label,'比较条件待补全');
});
