import {PLATFORMS, DEFAULT_SETTINGS, DEFAULT_RULES, DEFAULT_TAG_COUNT, validateAd, cleanText, buildPrompt, parseGenerated, checkGrounding} from '../../apps/copy-center/core.mjs';

const STATIC_ASSETS = {};
const SESSION_DAYS=30;
class HttpError extends Error {constructor(status,message){super(message);this.status=status;}}
const hash=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),b=>b.toString(16).padStart(2,'0')).join('');
const random=()=>crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');
const json=(data,status=200,extra={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...extra}});
const cookieHash=async r=>{const token=r.headers.get('Cookie')?.match(/(?:^|;\s*)nbo_copy_session=([a-f0-9]{64})/)?.[1];return token?hash(token):'';};
const unpack=r=>({...JSON.parse(r.data),id:r.id,code:r.code,revision:r.revision,createdAt:r.created_at,updatedAt:r.updated_at});
async function body(request,max=300000){const declared=Number(request.headers.get('Content-Length'));if(declared>max)throw new HttpError(413,'内容过大，请分批导入');const text=await request.text();if(text.length>max)throw new HttpError(413,'内容过大，请分批导入');try{return JSON.parse(text);}catch{throw new HttpError(400,'请求格式不正确');}}
async function checkSession(request,env){const key=await cookieHash(request);if(!key)throw new HttpError(401,'请先登录文案中心');const s=await env.DB.prepare('SELECT token_hash FROM sessions WHERE token_hash=? AND expires_at>?').bind(key,Date.now()).first();if(!s)throw new HttpError(401,'登录已过期，请重新登录');return key;}
async function limit(env,key,windowMs,max){const bucket=`${key}:${Math.floor(Date.now()/windowMs)}`;const r=await env.DB.prepare('INSERT INTO request_limits (key,count,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count').bind(bucket,Date.now()+windowMs*2).first();if(r.count>max)throw new HttpError(429,'操作较频繁，请稍后再试');}
async function configuration(env){const row=await env.DB.prepare('SELECT data,revision FROM configuration WHERE id=?').bind('main').first();const value=row?JSON.parse(row.data):{};return {settings:{...DEFAULT_SETTINGS,...value.settings},rules:DEFAULT_RULES.map(d=>({...d,...value.rules?.find(r=>r.id===d.id),maxTags:DEFAULT_TAG_COUNT})),configurationRevision:row?.revision||0};}
async function getAd(env,id){const row=await env.DB.prepare('SELECT * FROM ads WHERE id=?').bind(id).first();if(!row)throw new HttpError(404,'这条广告不存在');return row;}
async function app(request,env){
  const url=new URL(request.url),path=url.pathname,method=request.method;
  if(!path.startsWith('/api/')){const assets=env.STATIC_ASSETS||STATIC_ASSETS;const asset=assets[path==='/'?'/index.html':path];if(!asset)return new Response('页面不存在',{status:404});return new Response(asset.body,{headers:{'Content-Type':asset.type,'Cache-Control':'no-cache'}});}
  if(!['GET','HEAD'].includes(method)){const origin=request.headers.get('Origin');if(origin!==url.origin)throw new HttpError(403,'请从文案中心页面操作');}
  if(path==='/api/login'&&method==='POST'){
    if(!env.COPY_ACCESS_KEY)throw new HttpError(503,'文案中心尚未配置访问码');
    const ipHash=await hash((request.headers.get('CF-Connecting-IP')||'local')+env.COPY_ACCESS_KEY);await limit(env,'login:'+ipHash,15*60*1000,10);
    const data=await body(request,3000),password=cleanText(data.password,300,'访问码');
    const a=await hash(password),b=await hash(env.COPY_ACCESS_KEY);let mismatch=0;for(let i=0;i<a.length;i++)mismatch|=a.charCodeAt(i)^b.charCodeAt(i);if(mismatch)throw new HttpError(401,'访问码不正确');
    const token=random(),expiry=Date.now()+SESSION_DAYS*86400000;await env.DB.batch([env.DB.prepare('INSERT INTO sessions (token_hash,expires_at) VALUES (?,?)').bind(await hash(token),expiry),env.DB.prepare('DELETE FROM sessions WHERE expires_at<?').bind(Date.now()),env.DB.prepare('DELETE FROM request_limits WHERE expires_at<?').bind(Date.now())]);
    return json({ok:true},200,{'Set-Cookie':`nbo_copy_session=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_DAYS*86400}`});
  }
  const session=await checkSession(request,env);
  if(path==='/api/logout'&&method==='POST'){await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(session).run();return json({ok:true},200,{'Set-Cookie':'nbo_copy_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0'});}
  if(path==='/api/state'&&method==='GET'){const rows=await env.DB.prepare('SELECT * FROM ads ORDER BY updated_at DESC').all();return json({ads:rows.results.map(unpack),...await configuration(env),generator:{connected:!!env.AI,model:env.AI_MODEL||'@cf/qwen/qwen3-30b-a3b-fp8'}});}
  if(path==='/api/ads'&&method==='POST'){
    const ad=validateAd(await body(request));const id=crypto.randomUUID(),now=new Date().toISOString();if(!ad.code)ad.code='NB-'+id.slice(0,8).toUpperCase();
    try{await env.DB.prepare('INSERT INTO ads (id,code,data,revision,created_at,updated_at) VALUES (?,?,?,1,?,?)').bind(id,ad.code,JSON.stringify(ad),now,now).run();}catch(e){if(/UNIQUE/i.test(e.message))throw new HttpError(409,'这个广告编号已存在，请换一个编号');throw e;}
    return json({...ad,id,revision:1,createdAt:now,updatedAt:now},201);
  }
  const match=path.match(/^\/api\/ads\/([a-zA-Z0-9-]+)(\/history)?$/);
  if(match){const id=match[1];await getAd(env,id);
    if(match[2]&&method==='GET'){const rows=await env.DB.prepare('SELECT data,revision,saved_at FROM history WHERE ad_id=? ORDER BY id DESC LIMIT 20').bind(id).all();return json(rows.results.map(r=>({ad:JSON.parse(r.data),revision:r.revision,savedAt:r.saved_at})));}
    if(!match[2]&&method==='PUT'){
      const input=await body(request),ad=validateAd(input),revision=input.revision;if(!Number.isInteger(revision)||revision<1)throw new HttpError(400,'缺少有效的版本号');const now=new Date().toISOString();
      let r;try{r=await env.DB.batch([
        env.DB.prepare('INSERT INTO history (ad_id,data,revision,saved_at) SELECT id,data,revision,updated_at FROM ads WHERE id=? AND revision=?').bind(id,revision),
        env.DB.prepare('UPDATE ads SET code=?,data=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?').bind(ad.code||input.code,JSON.stringify(ad),now,id,revision),
        env.DB.prepare('DELETE FROM history WHERE ad_id=? AND id NOT IN (SELECT id FROM history WHERE ad_id=? ORDER BY id DESC LIMIT 20)').bind(id,id)
      ]);}catch(e){if(/UNIQUE/i.test(e.message))throw new HttpError(409,'广告编号已被使用');throw e;}
      if(r[1].meta.changes!==1)throw new HttpError(409,'另一台设备已更新这条广告。你的编辑已保留，请先查看云端版本后再保存。');return json(unpack(await getAd(env,id)));
    }
  }
  if(path==='/api/generate'&&method==='POST'){
    if(!env.AI)throw new HttpError(503,'AI 服务暂未连接，已保留现有文案');await limit(env,'generate:'+session,60000,5);
    const input=await body(request,10000),row=await getAd(env,input.id);if(row.revision!==input.revision)throw new HttpError(409,'云端版本已更新，请先刷新广告再生成');
    const ad=unpack(row);ad.region=cleanText(input.region||ad.region,80,'目标地区');const config=await configuration(env);const messages=buildPrompt(ad,config.settings,config.rules,input.platforms);
    let timer;try{const generate=async()=>{for(let attempt=0;attempt<2;attempt++){const result=await env.AI.run(env.AI_MODEL||'@cf/qwen/qwen3-30b-a3b-fp8',{messages,max_tokens:5200,temperature:attempt?0.35:0.6,response_format:{type:'json_object'}});try{const versions=parseGenerated(result,input.platforms);return checkGrounding(versions,ad,config.settings);}catch(e){if(attempt)throw e;messages[0].content+=' 复核要求：'+e.message+'。每个平台必须有5个相关、非空且互不重复的话题；删除资料没有明确提供的服务承诺，正文可以缩短，完整重写所有指定平台。';}}};const versions=await Promise.race([generate(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('timeout')),80000);})]);return json({versions,region:ad.region,sourceRevision:row.revision});}
    catch(e){if(e instanceof HttpError)throw e;const message=/格式|缺少|标题|正文|话题|未确认/.test(e.message)?e.message+'；现有文案已保留':/timeout/.test(e.message)?'生成时间较长，请稍后重试；现有文案已保留':'AI 服务暂时不可用或额度不足，请稍后重试；现有文案已保留';return json({error:message},502);}finally{clearTimeout(timer);}
  }
  if(path==='/api/import'&&method==='POST'){
    const input=await body(request,2000000);if(!Array.isArray(input.ads)||!input.ads.length||input.ads.length>500)throw new HttpError(400,'每次请选择 1 至 500 条广告导入');
    const existing=(await env.DB.prepare('SELECT id,code FROM ads').all()).results,knownIds=new Set(existing.map(r=>r.id)),knownCodes=new Set(existing.map(r=>r.code)),seen=new Set(),accepted=[],skipped=[];
    for(let i=0;i<input.ads.length;i++){const source=input.ads[i];if(source.id&&knownIds.has(source.id)||input.merge===true&&knownCodes.has(source.code)){skipped.push(source.code||source.name||String(i+1));continue;}const ad=validateAd(source);if(ad.code&&(knownCodes.has(ad.code)||seen.has(ad.code)))throw new HttpError(400,`编号 ${ad.code} 已存在或重复，请先调整导入列表`);if(ad.code)seen.add(ad.code);const id=crypto.randomUUID();if(!ad.code)ad.code='NB-'+id.slice(0,8).toUpperCase();accepted.push({id,ad});}
    const now=new Date().toISOString();if(accepted.length)try{await env.DB.batch(accepted.map(({id,ad})=>env.DB.prepare('INSERT INTO ads (id,code,data,revision,created_at,updated_at) VALUES (?,?,?,1,?,?)').bind(id,ad.code,JSON.stringify(ad),now,now)));}catch(e){if(/UNIQUE/i.test(e.message))throw new HttpError(409,'导入时编号发生变化，请刷新后重试');throw e;}
    return json({imported:accepted.length,skipped});
  }
  if(path==='/api/configuration'&&method==='PUT'){
    const input=await body(request,30000),old=await configuration(env);if(input.revision!==old.configurationRevision)throw new HttpError(409,'品牌或规则已在另一台设备更新，请刷新后重试');
    const settings={};for(const [key,max]of Object.entries({brand:100,location:200,facts:8000,voice:1000,cta:1000}))settings[key]=cleanText(input.settings?.[key]??old.settings[key],max,key);
    if(!settings.brand)throw new HttpError(400,'请填写品牌名称');
    const rules=DEFAULT_RULES.map(d=>{const v=input.rules?.find(r=>r.id===d.id)||old.rules.find(r=>r.id===d.id);const r={...d};for(const key of ['notes','mediaNote','source','verifiedAt'])r[key]=cleanText(v[key],2000,key);for(const key of ['titleGuide','bodyGuide']){const n=Number(v[key]);if(!Number.isFinite(n)||n<1||n>20000)throw new HttpError(400,'规则字数或话题数量无效');r[key]=Math.round(n);}r.maxTags=DEFAULT_TAG_COUNT;return r;});
    const value=JSON.stringify({settings,rules});let result;if(old.configurationRevision===0){try{result=await env.DB.prepare('INSERT INTO configuration (id,data,revision) VALUES (?, ?, 1)').bind('main',value).run();}catch(e){if(/UNIQUE/i.test(e.message))throw new HttpError(409,'设置已更新，请刷新');throw e;}}else result=await env.DB.prepare('UPDATE configuration SET data=?,revision=revision+1 WHERE id=? AND revision=?').bind(value,'main',old.configurationRevision).run();
    if(result.meta.changes!==1)throw new HttpError(409,'设置已更新，请刷新');return json(await configuration(env));
  }
  throw new HttpError(404,'接口不存在');
}
export default {async fetch(request,env){let response;try{response=await app(request,env);}catch(e){response=json({error:e.status?e.message:(e instanceof TypeError||e.name==='Error'&&!/D1|SQLITE|database|SQL/i.test(e.message)?e.message:'保存失败，请稍后重试')},e.status||(/D1|SQLITE|database|SQL/i.test(e.message)?500:400));}
  const h=new Headers(response.headers);h.set('X-Content-Type-Options','nosniff');h.set('Referrer-Policy','no-referrer');h.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");return new Response(response.body,{status:response.status,headers:h});}};
