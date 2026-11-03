import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPrompt,parseGenerated,checkPublishReady,publishText,validateAd} from '../apps/copy-center/core.mjs';

const ad={name:'客户和摄影师选的照片，你更喜欢哪一组？',location:'广州',region:'国内'};
const tags=['男士写真','广州男士写真','广州男士拍摄','男生写真','广州写真'];
const row={platform:'channels',title:'客户和摄影师谁更会选',body:ad.name,tags,cta:''};
test('视频号默认五话题，短标题与描述分别生成',()=>{
 const prompt=buildPrompt(ad,undefined,undefined,['channels']);
 const data=JSON.parse(prompt[1].content),sample=data.成稿示例;
 assert.equal(sample.tags.length,5);assert.equal(data.平台[0].话题默认数量,5);
 assert.ok(sample.title.length>=6&&sample.title.length<=16);assert.notEqual(sample.title,sample.body);
 assert.equal(data.平台[0].标题建议字数,16);assert.match(prompt[0].content,/短标题/);
});
test('视频号生成短标题校验6到16字，正文仍可超过16字',()=>{
 assert.doesNotThrow(()=>checkPublishReady(parseGenerated({versions:[row]},['channels']),ad));
 for(const title of ['字'.repeat(5),'字'.repeat(17),'客户和摄影师，谁更会选'])assert.throws(()=>checkPublishReady([{...row,title}],ad),/短标题/);
 for(const title of ['字'.repeat(6),'字'.repeat(16)])assert.doesNotThrow(()=>checkPublishReady([{...row,title}],ad));
});
test('视频号整段复制只包含描述与五话题，短标题独立保存',()=>{
 const expected=row.body+'\n\n'+tags.map(t=>'#'+t).join(' ');
 assert.equal(publishText(row),expected);
 const saved=validateAd({name:ad.name,versions:{'国内::channels':row}}).versions['国内::channels'];
 assert.equal(saved.title,row.title);assert.equal(saved.body,row.body);
 assert.equal(publishText(saved),expected);
});
test('旧版视频号长标题仍可保存，不自动截断已写好的文案',()=>{
 const old={...row,title:ad.name};
 assert.equal(validateAd({name:ad.name,versions:{'国内::channels':old}}).versions['国内::channels'].title,ad.name);
});
