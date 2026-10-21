import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker from '../workers/copy-center/worker.mjs';
import {factStamp} from '../apps/copy-center/operations.mjs';
import {PLATFORMS} from '../apps/copy-center/core.mjs';
const base='https://copy.nanbostudio.com';
function setup(){
 const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../workers/copy-center/schema.sql',import.meta.url),'utf8'));
 const db={prepare(query){let values=[];const obj={bind(...v){values=v;return obj;},async first(){return sql.prepare(query).get(...values)||null;},async all(){return {results:sql.prepare(query).all(...values)};},async run(){const r=sql.prepare(query).run(...values);return {meta:{changes:Number(r.changes)}};},query:()=>query,values:()=>values};return obj;},async batch(items){sql.exec('BEGIN');try{const r=[];for(const s of items)r.push(await s.run());sql.exec('COMMIT');return r;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 return {DB:db,COPY_ACCESS_KEY:'test-code-with-enough-length',AI:{async run(){throw new Error('quota exceeded');}}};
}
async function request(env,path,method='GET',body,cookie='',origin=base){const h={Origin:origin};if(cookie)h.Cookie=cookie;if(body!==undefined)h['Content-Type']='application/json';return worker.fetch(new Request(base+path,{method,headers:h,...(body!==undefined?{body:JSON.stringify(body)}:{})}),env);}
async function login(env){const r=await request(env,'/api/login','POST',{password:env.COPY_ACCESS_KEY});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0];}
test('匿名读取拒绝、登录 cookie 安全、跨来源修改拒绝',async()=>{
 const e=setup();assert.equal((await request(e,'/api/state')).status,401);
 const r=await request(e,'/api/login','POST',{password:e.COPY_ACCESS_KEY});assert.match(r.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Strict/);
 const c=await login(e);assert.equal((await request(e,'/api/state','GET',undefined,c)).status,200);
 assert.equal((await request(e,'/api/ads','POST',{name:'测试'},c,'https://evil.example')).status,403);
 assert.equal((await request(e,'/api/ads','POST',{name:''},c)).status,400);
});
test('保存持久化、并发冲突不会覆盖、历史可读',async()=>{
 const e=setup(),c=await login(e);const create=await request(e,'/api/ads','POST',{name:'第一条',code:'NB-001'},c);assert.equal(create.status,201);const ad=await create.json();
 const u=await request(e,'/api/ads/'+ad.id,'PUT',{...ad,name:'已修改'},c);assert.equal(u.status,200);
 const conflict=await request(e,'/api/ads/'+ad.id,'PUT',{...ad,name:'旧设备覆盖'},c);assert.equal(conflict.status,409);
 const state=await(await request(e,'/api/state','GET',undefined,c)).json();assert.equal(state.ads[0].name,'已修改');assert.equal(state.ads[0].revision,2);
 const history=await(await request(e,'/api/ads/'+ad.id+'/history','GET',undefined,c)).json();assert.equal(history[0].ad.name,'第一条');
});
test('AI 故障和生成请求不写入现有文案',async()=>{
 const e=setup(),c=await login(e);const ad=await(await request(e,'/api/ads','POST',{name:'测试',facts:'真实卖点'},c)).json();
 const r=await request(e,'/api/generate','POST',{id:ad.id,revision:ad.revision,region:'新加坡',platforms:['tiktok']},c);assert.equal(r.status,502);
 const state=await(await request(e,'/api/state','GET',undefined,c)).json();assert.deepEqual(state.ads[0].versions,{});
 e.AI.run=async()=>({choices:[{message:{content:JSON.stringify({versions:[{platform:'tiktok',title:'廣州男士寫真',body:'記錄真實的自己。\n\n廣州到店拍攝，服務華人。',tags:['男士寫真','廣州寫真','南鉑攝影','男生寫真','個人寫真'],cta:'私信諮詢'}]})}}]});
 const generated=await(await request(e,'/api/generate','POST',{id:ad.id,revision:ad.revision,region:'台湾',platforms:['tiktok']},c)).json();assert.equal(generated.versions[0].title,'广州男士写真');
});
test('批量导入重复编号全批拒绝，退出后会话失效',async()=>{
 const e=setup(),c=await login(e);const r=await request(e,'/api/import','POST',{ads:[{name:'一',code:'NB-1'},{name:'二',code:'NB-1'}]},c);assert.equal(r.status,400);
 const s=await(await request(e,'/api/state','GET',undefined,c)).json();assert.equal(s.ads.length,0);
 assert.equal((await request(e,'/api/logout','POST',{},c)).status,200);assert.equal((await request(e,'/api/state','GET',undefined,c)).status,401);
});
test('登录错误次数限流',async()=>{
 const e=setup();for(let i=0;i<10;i++)assert.equal((await request(e,'/api/login','POST',{password:'wrong'})).status,401);
 assert.equal((await request(e,'/api/login','POST',{password:'wrong'})).status,429);
});
test('分批恢复失败后可安全重试，已有广告不被覆盖',async()=>{
 const e=setup(),c=await login(e);const ads=[{name:'第一条',code:'RESTORE-1'},{name:'第二条',code:'RESTORE-2'}];
 assert.equal((await request(e,'/api/import','POST',{ads,merge:true},c)).status,200);
 const retried=await(await request(e,'/api/import','POST',{ads:[...ads,{name:'第三条',code:'RESTORE-3'}],merge:true},c)).json();assert.equal(retried.imported,1);assert.equal(retried.skipped.length,2);
 const state=await(await request(e,'/api/state','GET',undefined,c)).json();assert.equal(state.ads.length,3);
});
test('话题不足五个会重试，生成失败也不覆盖已有手动话题',async()=>{
 const e=setup(),c=await login(e),tags=['广州男士写真','男士写真','南铂摄影','广州写真','男生写真'];
 const ad=await(await request(e,'/api/ads','POST',{name:'话题验证',versions:{'国内::douyin':{title:'原有标题',body:'手动正文',tags:['手动一','手动二','手动三']}}},c)).json();
 let attempts=0;e.AI.run=async()=>({versions:[{platform:'douyin',title:'广州写真',body:'真实男士写真作品。\n\n广州到店拍摄。',cta:'可以站内私信了解。',tags:++attempts===1?tags.slice(0,3):tags}]});
 const r=await request(e,'/api/generate','POST',{id:ad.id,revision:ad.revision,platforms:['douyin']},c);
 assert.equal(r.status,200);assert.equal(attempts,2);assert.equal((await r.json()).versions[0].tags.length,5);
 const state=await(await request(e,'/api/state','GET',undefined,c)).json();assert.deepEqual(state.ads[0].versions['国内::douyin'].tags,['手动一','手动二','手动三']);
 e.AI.run=async()=>({versions:[{platform:'douyin',title:'广州写真',body:'真实男士写真作品。',tags:['一个话题']}]});
 const failed=await request(e,'/api/generate','POST',{id:ad.id,revision:ad.revision,platforms:['douyin']},c);assert.equal(failed.status,502);assert.match((await failed.json()).error,/话题/);
});
test('手动增加和减少话题均可保存，历史保留原数量',async()=>{
 const e=setup(),c=await login(e),tags=Array.from({length:7},(_,i)=>'手动话题'+i);
 const ad=await(await request(e,'/api/ads','POST',{name:'手动话题验证',versions:{'国内::youtube':{title:'作品',body:'真实作品',tags}}},c)).json();
 assert.equal(ad.versions['国内::youtube'].tags.length,7);
 ad.versions['国内::youtube'].tags=tags.slice(0,3);
 assert.equal((await request(e,'/api/ads/'+ad.id,'PUT',ad,c)).status,200);
 const state=await(await request(e,'/api/state','GET',undefined,c)).json();assert.equal(state.ads[0].versions['国内::youtube'].tags.length,3);
 const history=await(await request(e,'/api/ads/'+ad.id+'/history','GET',undefined,c)).json();assert.equal(history[0].ad.versions['国内::youtube'].tags.length,7);
 assert.ok(state.rules.every(r=>r.maxTags===5));
});
test('直接发布稿自动重试缺失的地点、币种和站内引导，保持已发布定稿不变',async()=>{
 const e=setup(),c=await login(e),tags=['男士写真','广州摄影','男生拍照','个人写真','南铂摄影'];
 const ad=await(await request(e,'/api/ads','POST',{name:'成片展示',region:'海外华人',location:'广州',facts:'268元拍2套，底片全送',versions:{'海外华人::tiktok':{title:'已经发布的标题',body:'已经发布的原文',tags:['原有话题'],status:'已发布'}}},c)).json();
 const good={platform:'tiktok',title:'想拍一组属于自己的写真？',body:'先看看这条作品，找找你喜欢的感觉。\n\n南铂摄影｜广州到店拍摄\n人民币268元拍2套，底片全送。',tags,cta:'想了解风格和可预约时间，可以站内私信「268」。'};
 for(const invalid of [{...good,cta:''},{...good,body:'先看看这条作品，找找你喜欢的感觉。人民币268元拍2套，底片全送。'},{...good,body:good.body.replace('人民币','')},{...good,body:good.body+'\n【待填写作品信息】'},{...good,body:good.body.replaceAll('\n',' ')}]){
  let attempts=0;e.AI.run=async()=>({versions:[++attempts===1?invalid:good]});
  const result=await request(e,'/api/generate','POST',{id:ad.id,revision:ad.revision,region:'海外华人',platforms:['tiktok']},c);
  assert.equal(result.status,200);assert.equal(attempts,2);assert.equal((await result.json()).versions[0].cta,good.cta);
 }
 const state=await(await request(e,'/api/state','GET',undefined,c)).json();assert.deepEqual(state.ads[0].versions,ad.versions);
});
test('八平台分别生成，各平台的有效结果按请求顺序完整返回',async()=>{
 const e=setup(),c=await login(e),ad=await(await request(e,'/api/ads','POST',{name:'男士写真',location:'广州'},c)).json();
 e.AI.run=async(_model,input)=>{const p=JSON.parse(input.messages[1].content).平台[0];return {versions:[{platform:p.id,title:p.name+'男士写真作品参考',body:'先看看这条作品，找找你喜欢的感觉。\n\n广州到店拍摄。',cta:p.id==='youtube'?'想了解风格，欢迎在评论区留言。':p.id==='facebook'?'想了解风格，可以通过 Messenger 私信。':'想了解风格，可以站内私信。',tags:['男士写真','广州摄影','男生拍照','个人写真','南铂摄影']}]};};
 const response=await request(e,'/api/generate','POST',{id:ad.id,revision:ad.revision,platforms:PLATFORMS.map(p=>p.id)},c);
 assert.equal(response.status,200);const data=await response.json();assert.deepEqual(data.versions.map(v=>v.platform),['douyin','xiaohongshu','kuaishou','channels','tiktok','instagram','facebook','youtube']);assert.equal(new Set(data.versions.map(v=>v.title)).size,8);
});
test('某平台失败返回后，仍在途的平台不会继续启动重试',async()=>{
 const e=setup(),c=await login(e),ad=await(await request(e,'/api/ads','POST',{name:'男士写真'},c)).json();
 let release,slowCalls=0;e.AI.run=async(_model,input)=>{const platform=JSON.parse(input.messages[1].content).平台[0].id;const invalid={versions:[{platform,title:'男士写真',body:'广州到店拍摄',cta:'可以站内私信了解',tags:[]}]};if(platform==='douyin')return invalid;slowCalls++;await new Promise(r=>release=r);return invalid;};
 const response=await request(e,'/api/generate','POST',{id:ad.id,revision:ad.revision,platforms:['douyin','tiktok']},c);assert.equal(response.status,502);
 release();await new Promise(setImmediate);assert.equal(slowCalls,1);
});
test('素材编号固定，套餐配置不会被旧设置页面清空，发布留底独立于广告恢复',async()=>{
 const e=setup(),c=await login(e);
 let config=await(await request(e,'/api/configuration','PUT',{revision:0,accounts:[{id:'account-a',name:'南铂官号',platform:'douyin',timeZone:'Asia/Singapore',times:'20:00'}],offers:[{id:'offer-a',name:'写真套餐',facts:'268元拍2套，底片全送'}]},c)).json();
 assert.equal(config.accounts?.length,1);assert.equal(config.offers?.[0].revision,1);
 const ad=await(await request(e,'/api/ads','POST',{name:'留底测试',code:'NB-001',offerId:'offer-a',assetName:'原始视频.mp4',versions:{'国内::douyin':{title:'实际标题',body:'真实作品',tags:['一','二','三']}}},c)).json();
 assert.equal(ad.offerId,'offer-a');assert.equal(ad.assetName,'原始视频.mp4');
 assert.equal((await request(e,'/api/ads/'+ad.id,'PUT',{...ad,code:'NB-002'},c)).status,400);
 const payload={id:'receipt-a',adId:ad.id,revision:ad.revision,accountId:'account-a',platform:'douyin',region:'国内',localPublishedAt:'2026-01-01T20:00',publishUrl:'https://www.douyin.com/video/example',title:'实际标题',body:'真实作品',tags:['一','二','三']};
 assert.equal((await request(e,'/api/publications','POST',payload,c)).status,400,'未复核的旧文案不能假装已核对');
 ad.versions['国内::douyin'].factStamp=factStamp(ad,config);
 const saved=await(await request(e,'/api/ads/'+ad.id,'PUT',ad,c)).json();payload.revision=saved.revision;
 const created=await request(e,'/api/publications','POST',payload,c);assert.equal(created.status,201);const receipt=await created.json();
 assert.equal(receipt.snapshot.tags.length,3);assert.equal(receipt.snapshot.facts,'268元拍2套，底片全送');assert.equal(receipt.publishedAt,'2026-01-01T12:00:00.000Z');
 assert.equal((await request(e,'/api/publications','POST',payload,c)).status,200,'网络重试不会重复留底');
 assert.equal((await request(e,'/api/ads/'+ad.id,'PUT',{...saved,name:'更名',versions:{}},c)).status,200);
 const listed=await(await request(e,'/api/publications?adId='+ad.id,'GET',undefined,c)).json();assert.equal(listed.items.length,1);assert.equal(listed.items[0].adName,'留底测试');assert.equal(listed.items[0].snapshot.title,'实际标题');
 config=await(await request(e,'/api/configuration','PUT',{revision:config.configurationRevision,settings:{brand:'南铂摄影'}},c)).json();assert.equal(config.accounts.length,1);assert.equal(config.offers.length,1);
 const changed=await(await request(e,'/api/configuration','PUT',{revision:config.configurationRevision,offers:[{...config.offers[0],facts:'新套餐事实'}]},c)).json();assert.equal(changed.offers[0].revision,2);
 assert.equal((await request(e,'/api/publications','PUT',receipt,c)).status,404);
 const second=setup(),c2=await login(second);const ad2=await(await request(second,'/api/ads','POST',{name:'恢复后的素材',code:'NB-001'},c2)).json();assert.notEqual(ad2.id,ad.id);
 const restore=await request(second,'/api/publications/import','POST',{publications:[receipt]},c2);assert.equal(restore.status,200);
 const restored=await(await request(second,'/api/publications?adId='+ad2.id,'GET',undefined,c2)).json();assert.equal(restored.items[0].adId,ad2.id);assert.equal(restored.items[0].snapshot.title,'实际标题');
 assert.equal((await(await request(second,'/api/publications/import','POST',{publications:[receipt]},c2)).json()).skipped,1);
});
