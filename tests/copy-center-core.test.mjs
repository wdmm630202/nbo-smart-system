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
  const rows=PLATFORMS.map(p=>({platform:p.id,title:'在广州记录自己',body:'南铂摄影男士写真。',tags:['广州写真','男士写真','南铂摄影','男生写真','个人写真'],cta:'私信了解风格'}));
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
test('自动生成要求八平台各有五个不重复的有效话题',()=>{
 const tags=['广州男士写真','男士写真','南铂摄影','广州写真','男生写真'];
 for(const p of PLATFORMS){
  const row={platform:p.id,title:'广州男士写真',body:'真实作品与拍摄风格。',tags};
  assert.equal(parseGenerated({versions:[row]},[p.id])[0].tags.length,5);
  for(const invalid of [tags.slice(0,3),[...tags,'个人写真'],[...tags.slice(0,4),tags[0]],[...tags.slice(0,4),'# ']])assert.throws(()=>parseGenerated({versions:[{...row,tags:invalid}]},[p.id]),/5.*话题|话题.*5/);
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
test('服务地点含市名或详细地址时，直接发布正文写实际城市即可',()=>{
 const v={title:'男士写真',body:'先看看作品。\n\n广州到店拍摄，人民币268元拍2套。',cta:'可以站内私信了解。'};
 for(const location of ['广州','广州市','广东省广州市天河区','广州天河区','广州·天河','地址：广州市天河区'])assert.doesNotThrow(()=>checkPublishReady([v],{location,region:'海外华人',facts:'268元拍2套'}));
 assert.throws(()=>checkPublishReady([{...v,body:'上海到店拍摄。'}],{location:'广州市'}),/地点/);
});
test('海外广州报价支持货币符号，不因事实提到受众国家而漏掉币种校验',()=>{
 const v={title:'男士写真',body:'先看看作品。\n\n广州到店拍摄，268元拍2套。',cta:'可以站内私信了解。'};
 for(const facts of ['268元拍2套','面向新加坡华人，268元拍2套','面向马来西亚华人，¥268拍2套','人民币268元拍2套，参考折合SGD50，最终按人民币收费']){
  const ad={location:'广州',region:'海外华人',facts};
  assert.throws(()=>checkPublishReady([v],ad),/人民币/);
  assert.doesNotThrow(()=>checkPublishReady([{...v,body:v.body.replace('268元','人民币268元')}],ad));
 }
 assert.doesNotThrow(()=>checkPublishReady([{...v,body:'先看看作品。\n\n广州到店拍摄，新币268元。'}],{location:'广州',region:'新加坡',facts:'新币268元'}));
 assert.doesNotThrow(()=>checkPublishReady([{...v,body:'先看看作品。\n\n广州到店拍摄，268元（新币）。'}],{location:'广州',region:'新加坡',facts:'268元（新币）拍2套'}));
});
test('生成示范使用本次事实构成完整段落，不沿用旧广告的金额或关键词',()=>{
 const make=ad=>JSON.parse(buildPrompt(ad,{brand:'南铂摄影',location:'广州'},undefined,['tiktok'])[1].content).成稿示例;
 const sample=make({name:'男士写真',facts:'699元拍3套，底片全送。',location:'广州市',region:'新加坡'});
 assert.match(sample?.body||'',/人民币699元拍3套/);assert.match(sample.body,/广州到店拍摄/);assert.match(sample.cta,/「699」/);assert.doesNotMatch(JSON.stringify(sample),/268/);
 const empty=make({name:'男士写真',region:'海外华人'});assert.doesNotMatch(JSON.stringify(empty),/268|699|底片全送|人民币/);
 const noPackage=JSON.parse(buildPrompt({name:'男士写真',region:'海外华人'},{brand:'南铂摄影',location:'广州'},undefined,['facebook'])[1].content).成稿示例;assert.doesNotMatch(noPackage.body,/套餐信息/);
 const foreign=make({name:'男士写真',region:'新加坡',location:'广州',facts:'268元（新币）拍2套'});assert.match(foreign.body,/268元（新币）/);assert.doesNotMatch(foreign.body,/人民币/);
});
test('未提供具体画面时，生成稿不能声称作品使用了光影或构图',()=>{
 const v={title:'男士写真',body:'这条作品用光影和构图展现了另一种可能。'};
 assert.throws(()=>checkGrounding([v],{name:'男士写真',description:'未提供具体画面情节。'},{}),/未确认/);
 assert.doesNotThrow(()=>checkGrounding([v],{name:'男士写真',description:'侧光，简洁构图。'},{}));
});
test('批量复用架构时，示范优先保留本条广告主题并给足五个话题',()=>{
 const sample=JSON.parse(buildPrompt({name:'干净白衬衫写真',theme:'作品展示',facts:'698元拍3套，底片全送',location:'广州',region:'海外华人'},{brand:'南铂摄影'},undefined,['facebook'])[1].content).成稿示例;
 assert.match(sample.title,/白衬衫/);assert.match(sample.body,/白衬衫/);
 assert.equal(sample.tags?.length,5);assert.equal(new Set(sample.tags).size,5);
 assert.ok(sample.tags.every(t=>!/[#\s]/u.test(t)));assert.match(sample.cta,/Messenger/);
 assert.match(sample.body,/人民币698元拍3套/);assert.doesNotMatch(sample.body,/268/);
});
test('YouTube生成只使用评论留言引导，Facebook示范明确Messenger',()=>{
 const ad={name:'男士写真',facts:'698元拍3套',location:'广州',region:'海外华人'};
 const youtube=JSON.parse(buildPrompt(ad,{brand:'南铂摄影'},undefined,['youtube'])[1].content).成稿示例;
 assert.match(youtube.cta,/评论.*「698」/);assert.doesNotMatch(youtube.cta,/私信|Messenger/);
 assert.throws(()=>checkPublishReady([{...youtube,platform:'youtube',cta:'欢迎站内私信「698」。'}],ad),/YouTube.*评论/);
 assert.doesNotThrow(()=>checkPublishReady([{...youtube,platform:'youtube'}],ad));
});
test('生成正文必须空行分段，手动保存仍可采用自己的排版',()=>{
 const v={platform:'facebook',title:'白衬衫写真',body:'先看看这条作品。广州到店拍摄。',cta:'欢迎通过 Messenger 私信了解。'};
 assert.throws(()=>checkPublishReady([v],{location:'广州',region:'国内'}),/正文.*分段/);
 assert.doesNotThrow(()=>checkPublishReady([{...v,body:'先看看这条作品。\n\n📍南铂摄影｜广州到店拍摄'}],{location:'广州',region:'国内'}));
 assert.equal(validateAd({name:'手动排版',versions:{'国内::facebook':v}}).versions['国内::facebook'].body,v.body);
});
test('其余平台不能沿用Facebook的Messenger或其他平台咨询渠道',()=>{
 const ad={location:'广州',region:'国内'},v={title:'男士写真',body:'先看看作品。\n\n广州到店拍摄。',cta:'欢迎通过 Messenger 私信咨询。'};
 for(const platform of ['douyin','xiaohongshu','kuaishou','channels','tiktok','instagram']){
  assert.throws(()=>checkPublishReady([{...v,platform}],ad),/咨询.*其他平台/);
  assert.doesNotThrow(()=>checkPublishReady([{...v,platform,cta:'欢迎站内私信咨询。'}],ad));
 }
 assert.throws(()=>checkPublishReady([{...v,platform:'tiktok',cta:'欢迎到小红书私信咨询。'}],ad),/咨询.*其他平台/);
});
test('品牌通用私信设置在八平台都不会沿用旧价格，普通语气偏好仍可使用',()=>{
 const ad={name:'白衬衫写真',facts:'698元拍3套',location:'广州',region:'海外华人'},settings={brand:'南铂摄影',cta:'欢迎站内私信「268」。'};
 for(const {id:platform}of PLATFORMS){const channel=platform==='facebook'?/Messenger/:platform==='youtube'?/评论/:/私信/;
  const data=JSON.parse(buildPrompt(ad,settings,undefined,[platform])[1].content);
  assert.match(data.品牌资料.cta,channel);assert.match(data.品牌资料.cta,/「698」/);assert.doesNotMatch(data.品牌资料.cta,/268/);
 }
 const preferred='想了解更多，可以站内私信聊聊。';assert.equal(JSON.parse(buildPrompt(ad,{...settings,cta:preferred},undefined,['tiktok'])[1].content).品牌资料.cta,preferred);
 assert.throws(()=>checkGrounding([{title:'白衬衫写真',body:'广州到店拍摄，698元拍3套。',cta:'欢迎私信「268」。'}],ad,settings),/未确认.*咨询.*关键词/);
});
