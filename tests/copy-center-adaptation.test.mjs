import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../apps/copy-center/core.mjs';

test('海外以国内定稿正文为底稿，优先国内地区抖音并在缺失时使用其他国内平台',()=>{
 const ad={name:'旧素材名称',region:'台湾',location:'广州',versions:{
  '台湾::douyin':{title:'地区稿',body:'地区正文'},
  '国内::xiaohongshu':{title:'小红书稿',body:'小红书正文'},
  '国内::douyin':{title:'改过的标题',body:'客户选片和摄影师选片，你更喜欢哪组？'}
 }};
 const data=JSON.parse(core.buildPrompt(ad,undefined,undefined,['tiktok'])[1].content);
 assert.deepEqual(data.国内文案底稿,{platform:'douyin',title:'改过的标题',body:'客户选片和摄影师选片，你更喜欢哪组？'});
 delete ad.versions['国内::douyin'];
 assert.equal(JSON.parse(core.buildPrompt(ad,undefined,undefined,['instagram'])[1].content).国内文案底稿.platform,'xiaohongshu');
 delete ad.versions['国内::xiaohongshu'];
 assert.equal(JSON.parse(core.buildPrompt(ad,undefined,undefined,['facebook'])[1].content).国内文案底稿.body,'地区正文');
});

test('海外四平台标题保持内容看点，正文一句带真实城市拍摄邀请，五话题包含三个主要地区',()=>{
 const ad={name:'客户和摄影师选片',region:'国内',location:'广州'};
 for(const platform of ['tiktok','instagram','facebook','youtube']){
  const prompt=core.buildPrompt(ad,undefined,undefined,[platform]),data=JSON.parse(prompt[1].content),sample=data.成稿示例;
  assert.notEqual(sample.title,sample.body);
  assert.match(sample.title,/客户.*摄影师/);
  assert.match(sample.body,/广州/);
  assert.match(sample.body,/选/);
  assert.deepEqual(sample.tags,['广州男士写真','男士写真','马来西亚','新加坡','台湾']);
  assert.deepEqual(data.主要受众地区,['马来西亚','新加坡','台湾']);
  assert.doesNotThrow(()=>core.checkPublishReady([{...sample,platform}],ad));
 }
});

test('没有国内稿时以素材为底稿，非广州服务不被改成广州门店',()=>{
 const data=JSON.parse(core.buildPrompt({name:'个人写真',location:'深圳市',region:'海外华人'},undefined,undefined,['tiktok'])[1].content);
 assert.equal(data.国内文案底稿,null);
 assert.match(data.成稿示例.body,/深圳/);
 assert.doesNotMatch(data.成稿示例.body,/广州/);
 assert.equal(data.成稿示例.tags[0],'深圳男士写真');
});

test('海外生成没有三个主要地区话题时拒绝成稿，以便重试而非静默发布错误方向',()=>{
 const v={platform:'tiktok',title:'你更喜欢哪一组写真',body:'来广州拍写真，你会选哪组？',tags:['男士写真','广州写真','男生写真','个人写真','写真摄影'],cta:''};
 assert.throws(()=>core.checkPublishReady([v],{location:'广州'}),/马来西亚.*新加坡.*台湾/);
 assert.doesNotThrow(()=>core.checkPublishReady([{...v,tags:['广州男士写真','男士写真','马来西亚','新加坡','台湾']}],{location:'广州'}));
});

test('切换目标地区仍可引用已有其他地区的国内平台稿，当前地区优先',()=>{
 const ad={name:'普通写真',region:'台湾',versions:{'马来西亚::douyin':{title:'底稿标题',body:'原有国内稿正文'}}};
 assert.equal(JSON.parse(core.buildPrompt(ad,undefined,undefined,['tiktok'])[1].content).国内文案底稿?.body,'原有国内稿正文');
 ad.versions['台湾::xiaohongshu']={title:'当前标题',body:'当前地区国内正文'};
 assert.equal(core.domesticReference(ad,'台湾').body,'当前地区国内正文');
});

test('国内底稿可支持海外视觉描述，但不能为旧价格或服务承诺提供依据',()=>{
 const ad={name:'男士写真',location:'广州'},settings={},ref={title:'光影与构图',body:'这组光影与构图写真，268元底片全送。'};
 assert.doesNotThrow(()=>core.checkGrounding([{title:'光影与构图写真',body:'喜欢这组光影与构图，来广州拍一组吧。'}],ad,settings,ref));
 assert.throws(()=>core.checkGrounding([{body:'来广州拍光影写真，268元底片全送。'}],ad,settings,ref),/未确认/);
});

test('在国内区域生成海外平台文案仍需人民币说明',()=>{
 const ad={region:'国内',location:'广州',facts:'268元拍2套'},v={platform:'tiktok',title:'广州男士写真',body:'268元拍2套，你想试试吗？',cta:''};
 assert.throws(()=>core.checkPublishReady([v],ad),/人民币/);
 assert.doesNotThrow(()=>core.checkPublishReady([{...v,body:'人民币268元拍2套，你想试试吗？'}],ad));
});
