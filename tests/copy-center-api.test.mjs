import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker from '../workers/copy-center/worker.mjs';
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
 e.AI.run=async()=>({choices:[{message:{content:JSON.stringify({versions:[{platform:'tiktok',title:'廣州男士寫真',body:'服務華人，記錄真實的自己。',tags:['男士寫真','廣州寫真','南鉑攝影','男生寫真','個人寫真'],cta:'私信諮詢'}]})}}]});
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
 let attempts=0;e.AI.run=async()=>({versions:[{platform:'douyin',title:'广州写真',body:'真实男士写真作品。',tags:++attempts===1?tags.slice(0,3):tags}]});
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
