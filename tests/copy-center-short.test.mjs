import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildPrompt,checkPublishReady,versionText,validateAd,PLATFORMS} from '../apps/copy-center/core.mjs';

const ad={name:'客户选片和摄影师选片',location:'广州',region:'国内',facts:'698元拍3套'};
const sentence='客户和摄影师选的照片，你更喜欢哪一组？';
const tags=['男士写真','广州男士写真','广州男士拍摄','男生写真','广州写真'];
test('八平台默认一句话和五个写真话题，不附加套餐或营销引导',()=>{
 for(const p of PLATFORMS){
  const prompt=buildPrompt(ad,{brand:'南铂摄影',location:'广州',cta:'私信「268」咨询'},undefined,[p.id]);
  assert.match(prompt[0].content,/一句话/);
  assert.doesNotMatch(prompt[0].content,/固定架构为开头看点|两段之间必须空一行/);
  const data=JSON.parse(prompt[1].content),sample=data.成稿示例;
  assert.equal(sample.title,sample.body);assert.ok(sample.body.length<=40);
  assert.equal(sample.cta,'');assert.deepEqual(sample.tags,tags);
  assert.doesNotMatch(JSON.stringify(sample),/698|268|到店|私信|Messenger/);
 }
});
test('一句正文无需城市段落或咨询段，多句长文与CTA会被拒绝',()=>{
 const v={platform:'douyin',title:sentence,body:sentence,tags,cta:''};
 assert.doesNotThrow(()=>checkPublishReady([v],ad));
 for(const changes of [{body:'作品很好看。你喜欢吗？'},{body:'第一行\n第二行'},{body:'写'.repeat(41)},{title:'写'.repeat(41)},{cta:'私信咨询。'}])assert.throws(()=>checkPublishReady([{...v,...changes}],ad));
});
test('整段复制简洁稿只保留一句话，旧稿标题正文和咨询仍可完整复制',()=>{
 assert.equal(versionText({title:sentence,body:sentence,tags,cta:''}),sentence+'\n\n'+tags.map(t=>'#'+t).join(' '));
 const old={title:'旧标题',body:'原来正文。\n\n原来第二段。',cta:'原来咨询。',tags:['旧话题']};
 assert.equal(versionText(old),'旧标题\n\n原来正文。\n\n原来第二段。\n\n原来咨询。\n\n#旧话题');
 assert.equal(validateAd({name:'旧资料',versions:{'国内::douyin':old}}).versions['国内::douyin'].body,old.body);
});
test('海外短句未提价格无需强塞币种，写出价格时仍需注明人民币',()=>{
 const overseas={...ad,region:'海外华人'};
 assert.doesNotThrow(()=>checkPublishReady([{title:sentence,body:sentence,cta:''}],overseas));
 assert.throws(()=>checkPublishReady([{title:'698元拍3套',body:'698元拍3套，你想试试吗？',cta:''}],overseas),/人民币/);
 assert.doesNotThrow(()=>checkPublishReady([{title:'人民币698元拍3套',body:'人民币698元拍3套，你想试试吗？',cta:''}],overseas));
});
