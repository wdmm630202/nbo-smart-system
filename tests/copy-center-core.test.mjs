import test from 'node:test';
import assert from 'node:assert/strict';
import {PLATFORMS, validateAd, buildPrompt, parseGenerated, parseCsv, prepareImport, csvExport, chunkAds, checkGrounding, checkPublishReady, versionText} from '../apps/copy-center/core.mjs';

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
  const rows=PLATFORMS.map(p=>({platform:p.id,title:'在广州记录自己',body:'南铂摄影男士写真。',tags:['广州写真','男士写真','南铂摄影','男生写真','个人写真'].slice(0,p.id==='kuaishou'?4:5),cta:'私信了解风格'}));
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
test('导入按 UTF-8 字节分批，大备份每批都在接口限制以内',()=>{
 const ads=Array.from({length:100},(_,i)=>({code:'NB-'+i,name:'广告',body:'真实素材'.repeat(4000)}));const chunks=chunkAds(ads);assert.ok(chunks.length>1);assert.equal(chunks.flat().length,100);for(const chunk of chunks)assert.ok(new TextEncoder().encode(JSON.stringify({ads:chunk,merge:true})).byteLength<1_200_000);
});
test('生成文案拒绝资料未确认的价格和服务承诺',()=>{
 const versions=[{title:'广州写真',body:'提供多套服装选择，专业团队帮您定制造型。',tags:[],cta:''}];
 assert.throws(()=>checkGrounding(versions,{name:'成片展示',facts:'',description:'服装风格',location:'广州'},{}),/未确认/);
 assert.throws(()=>checkGrounding([{title:'写真',body:'299元拍3套'}],{facts:'268元拍2套'},{}),/未确认/);
  assert.throws(()=>checkGrounding([{title:'写真',body:'268元拍2套，不用担心额外费用。'}],{facts:'268元拍2套'},{}),/未确认/);
 assert.doesNotThrow(()=>checkGrounding([{title:'268元拍2套',body:'男士写真，底片全送。'}],{facts:'268元拍2套，底片全送'},{}));
});
test('自动生成按平台要求四个或五个不重复的有效话题',()=>{
 const all=['广州男士写真','男士写真','南铂摄影','广州写真','男生写真'];
 for(const p of PLATFORMS){
  const count=p.id==='kuaishou'?4:5,tags=all.slice(0,count);
  const row={platform:p.id,title:'广州男士写真',body:'真实作品与拍摄风格。',tags};
  assert.equal(parseGenerated({versions:[row]},[p.id])[0].tags.length,count);
  for(const invalid of [tags.slice(0,count-1),[...tags,'个人写真'],[...tags.slice(0,-1),tags[0]],[...tags.slice(0,-1),'# ']])assert.throws(()=>parseGenerated({versions:[{...row,tags:invalid}]},[p.id]),new RegExp(count+'.*话题|话题.*'+count));
 }
 const prompt=buildPrompt({name:'作品'},undefined,[{id:'douyin',maxTags:3}],['douyin']);
 assert.match(prompt[0].content,/5.*话题|话题.*5/);
 assert.equal(JSON.parse(prompt[1].content).平台[0].话题默认数量,5);
});
test('默认五个不会限制手动保存更多、更少或清空话题',()=>{
 for(const n of [0,3,7])for(const p of PLATFORMS){const key='国内::'+p.id;const ad=validateAd({name:'手动编辑',versions:{[key]:{title:'作品',body:'手动正文',tags:Array.from({length:n},(_,i)=>'话题'+i)}}});assert.equal(ad.versions[key].tags.length,n);}
});
test('整段发布把咨询引导放在正文后、话题前，已含引导的旧稿不重复',()=>{
 const v={title:'普通男生拍写真，会是什么效果？',body:'广州到店拍摄，人民币268元拍2套，底片全送。',cta:'想了解风格，可以站内私信「268」。',tags:['男士写真','广州摄影','男生拍照','个人写真','南铂摄影']};
 const text=versionText(v);
 assert.equal(text,'普通男生拍写真，会是什么效果？\n\n广州到店拍摄，人民币268元拍2套，底片全送。\n\n想了解风格，可以站内私信「268」。\n\n#男士写真 #广州摄影 #男生拍照 #个人写真 #南铂摄影');
 const already={...v,body:v.body+'\n\n'+v.cta};
 assert.equal(versionText(already),text);
});
test('简洁稿不强制添加服务城市，已有带城市的长稿仍可手动保存',()=>{
 const v={title:'你更喜欢哪组照片？',body:'你更喜欢哪组照片？',cta:''};
 assert.doesNotThrow(()=>checkPublishReady([v],{location:'广州市',region:'国内'}));
 const old={...v,body:'先看看作品。\n\n广州到店拍摄。',cta:'可以站内私信了解。'};
 assert.equal(validateAd({name:'旧稿',versions:{'国内::douyin':old}}).versions['国内::douyin'].body,old.body);
});
test('海外稿写出内地元报价时仍需说明币种，未写价格时无需追加套餐',()=>{
 const ad={location:'广州',region:'海外华人',facts:'人民币268元拍2套，参考折合SGD50，最终按人民币收费'};
 assert.throws(()=>checkPublishReady([{title:'广州写真',body:'268元拍2套，你想试试吗？',cta:''}],ad),/人民币/);
 assert.doesNotThrow(()=>checkPublishReady([{title:'广州写真',body:'人民币268元拍2套，你想试试吗？',cta:''}],ad));
 for(const facts of ['新币268元拍2套','268元（新币）拍2套'])assert.doesNotThrow(()=>checkPublishReady([{title:'写真',body:'新币268元拍2套，你想试试吗？',cta:''}],{...ad,facts}));
});
test('示范不沿用本条或上一条广告的价格、赠送政策和咨询关键词',()=>{
 for(const platform of ['tiktok','facebook','youtube']){
  const data=JSON.parse(buildPrompt({name:'白衬衫写真',facts:'699元拍3套，底片全送',location:'广州市',region:'海外华人'},{brand:'南铂摄影',cta:'私信「268」'},undefined,[platform])[1].content);
  assert.match(data.成稿示例.body,/白衬衫/);assert.equal(data.成稿示例.cta,'');
  assert.doesNotMatch(JSON.stringify(data.成稿示例),/699|268|底片全送|到店|Messenger|私信/);
  assert.equal(data.成稿示例.tags.length,5);assert.equal(new Set(data.成稿示例.tags).size,5);
 }
});
test('未提供具体画面时，生成稿不能声称作品使用了光影或构图',()=>{
 const v={title:'男士写真',body:'这条作品用光影和构图展现了另一种可能。'};
 assert.throws(()=>checkGrounding([v],{name:'男士写真',description:'未提供具体画面情节。'},{}),/未确认/);
 assert.doesNotThrow(()=>checkGrounding([v],{name:'男士写真',description:'侧光，简洁构图。'},{}));
});
test('简洁格式拒绝分段，手动保存仍可采用自己的排版和咨询方式',()=>{
 const v={platform:'facebook',title:'白衬衫写真',body:'先看看作品。\n\n广州到店拍摄。',cta:''};
 assert.throws(()=>checkPublishReady([v],{location:'广州',region:'国内'}),/单行一句话/);
 assert.equal(validateAd({name:'手动排版',versions:{'国内::facebook':v}}).versions['国内::facebook'].body,v.body);
});
test('八平台默认都不追加咨询段，保留未确认价格关键词校验',()=>{
 const ad={name:'白衬衫写真',facts:'698元拍3套',location:'广州',region:'海外华人'};
 for(const p of PLATFORMS){
  const sample=JSON.parse(buildPrompt(ad,{cta:'欢迎站内私信「268」。'},undefined,[p.id])[1].content).成稿示例;
  assert.equal(sample.cta,'');assert.doesNotThrow(()=>checkPublishReady([sample],ad));
  assert.throws(()=>checkPublishReady([{...sample,cta:'欢迎私信。'}],ad),/咨询/);
 }
 assert.throws(()=>checkGrounding([{title:'白衬衫写真',body:'698元拍3套。',cta:'欢迎私信「268」。'}],ad,{}),/未确认.*咨询.*关键词/);
});
