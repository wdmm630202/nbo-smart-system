import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../apps/copy-center/core.mjs';

const tags=['男士写真','广州男士写真','广州男士拍摄','男生写真','广州写真'];
test('快手默认四话题，小红书及其余平台保持五话题',()=>{
 for(const {id} of core.PLATFORMS){
  const want=id==='kuaishou'?4:5;
  const prompt=core.buildPrompt({name:'客户与摄影师选片',location:'广州'},undefined,undefined,[id]);
  const data=JSON.parse(prompt[1].content);
  assert.equal(data.平台[0].话题默认数量,want,id);
  assert.equal(data.成稿示例.tags.length,want,id);
  assert.equal(core.DEFAULT_RULES.find(p=>p.id===id).maxTags,want,id);
 }
});
test('快手自动结果只接受四个有效话题，小红书仍只接受五个',()=>{
 for(const platform of ['kuaishou','xiaohongshu']){
  const want=platform==='kuaishou'?4:5;
  const row={platform,title:'你更喜欢哪组照片？',body:'你更喜欢哪组照片？',tags:tags.slice(0,want),cta:''};
  assert.equal(core.parseGenerated({versions:[row]},[platform])[0].tags.length,want);
  assert.throws(()=>core.parseGenerated({versions:[{...row,tags:tags.slice(0,want===4?5:4)}]},[platform]),/话题/);
 }
});
test('既有快手五话题手动稿仍完整保留',()=>{
 const old={title:'旧标题',body:'旧文案',tags,cta:''};
 assert.deepEqual(core.validateAd({name:'旧广告',versions:{'国内::kuaishou':old}}).versions['国内::kuaishou'].tags,tags);
});
