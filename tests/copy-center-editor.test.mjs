import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as core from '../apps/copy-center/core.mjs';
import * as strategy from '../apps/copy-center/strategy.mjs';
import * as ops from '../apps/copy-center/operations.mjs';
import * as opsUI from '../apps/copy-center/operations-ui.mjs';
async function harness(){
 const source=await readFile(new URL('../apps/copy-center/app.mjs',import.meta.url),'utf8');
 const controls=[{disabled:false},{disabled:false}],elements=new Map(),listeners={};
 const element=key=>{if(key==='#source-form'||key==='#version-form')return null;if(!elements.has(key))elements.set(key,{innerHTML:'',textContent:'',className:'',dataset:{},classList:{add(){}},disabled:false,querySelector:()=>null,showModal(){this.open=true;},close(){this.open=false;}});return elements.get(key);};
 const storage=new Map();const sandbox={...core,...strategy,ops,opsUI,console,setTimeout,clearTimeout,URL,Blob,TextEncoder,TextDecoder,fetch:()=>new Promise(()=>{}),confirm:()=>true,matchMedia:()=>({matches:true}),sessionStorage:{setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k),getItem:k=>storage.get(k)||null},document:{querySelector:element,querySelectorAll:()=>controls,body:{classList:{toggle(){},remove(){}}},addEventListener:(name,fn)=>listeners[name]=fn},window:{addEventListener:(name,fn)=>listeners[name]=fn,scrollTo(){}},navigator:{clipboard:{writeText:async()=>{}}}};
 vm.createContext(sandbox);const code=source.slice(0,source.lastIndexOf("\napi('/state')")).replace(/^import[^\n]+\n/gm,'');vm.runInContext(code+'\nglobalThis.app={S,saveDraft,previewImport,backup,newAd,editor};',sandbox);
 const a={id:'abc',code:'NB-001',name:'广告 A',region:'国内',location:'广州',facts:'',description:'',theme:'',assetUrl:'',versions:{},revision:1,updatedAt:'2026-10-20'};Object.assign(sandbox.app.S,{ads:[a],draft:structuredClone(a),rules:core.DEFAULT_RULES,page:'editor',dirty:true});
 return {sandbox,...sandbox.app,controls,elements,listeners,storage,ad:a};
}
test('普通保存期间锁定编辑和导航，响应返回后才解锁',async()=>{
 const h=await harness();let release;h.sandbox.fetch=()=>new Promise(r=>release=r);const pending=h.saveDraft();assert.equal(h.S.busy,true,'保存必须立即锁定编辑');assert.ok(h.controls.every(c=>c.disabled));
 await h.listeners.click({target:{closest:()=>({disabled:false,dataset:{nav:'library'}})}});assert.equal(h.S.page,'editor');
 release({ok:true,status:200,json:async()=>({...h.ad,revision:2})});await pending;assert.equal(h.S.busy,false);assert.ok(h.controls.every(c=>!c.disabled));assert.equal(h.S.dirty,false);
});
test('离开并返回编辑器仍保留未保存状态和卸载提醒',async()=>{
 const h=await harness();h.storage.set('nbo-copy-draft:abc','retained');
 await h.listeners.click({target:{closest:()=>({disabled:false,dataset:{nav:'library'}})}});assert.equal(h.S.dirty,true,'离开不能把本机草稿标成云端已保存');
 await h.listeners.click({target:{closest:()=>({disabled:false,dataset:{nav:'editor'}})}});assert.equal(h.S.dirty,true);let prevented=false;h.listeners.beforeunload({preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.equal(h.storage.get('nbo-copy-draft:abc'),'retained');
});
test('100 条广告五地区八平台的完整备份可以预览恢复',async()=>{
 const h=await harness();h.S.ads=[];const ads=Array.from({length:100},(_,i)=>({id:'ad-'+i,code:'NB-'+i,name:'广告 '+i,versions:Object.fromEntries(core.REGIONS.flatMap(region=>core.PLATFORMS.map(p=>[core.versionKey(region,p.id),{platform:p.id,region,title:'真实男士写真',body:'这是照片文案'.repeat(36),tags:[],cta:'站内咨询'}])))}));
 const text=JSON.stringify({format:'nanbo-copy-center',ads});const bytes=new TextEncoder().encode(text).byteLength;assert.ok(bytes>2_000_000);
 await h.previewImport({name:'完整备份.json',size:bytes,text:async()=>text});assert.equal(h.S.importData.ads.length,100);
});
test('只配置了账号和套餐的完整备份，在空配置库也能预览恢复',async()=>{
 const h=await harness();h.S.ads=[];const text=JSON.stringify({format:'nanbo-copy-center',ads:[],publications:[],settings:core.DEFAULT_SETTINGS,rules:core.DEFAULT_RULES,accounts:[{id:'account-a',name:'官号'}],offers:[{id:'offer-a',name:'套餐'}]});
 await h.previewImport({name:'配置备份.json',size:text.length,text:async()=>text});assert.equal(h.elements.get('#confirm-import').disabled,false);
});
test('完整备份在读取留底后刷新素材和配置，保留其他设备刚创建的素材',async()=>{
 const h=await harness();h.S.ads=[];h.sandbox.URL.createObjectURL=()=> 'blob:backup';h.sandbox.URL.revokeObjectURL=()=>{};
 h.sandbox.document.body.appendChild=()=>{};h.sandbox.document.createElement=()=>({click(){},remove(){}});
 const fresh={ads:[{id:'new-ad',code:'NB-NEW',name:'另一个设备创建'}],settings:core.DEFAULT_SETTINGS,rules:core.DEFAULT_RULES,accounts:[],offers:[]},records=[{id:'receipt-new',materialCode:'NB-NEW',snapshot:{title:'实际发布标题'}}],paths=[];
 h.sandbox.fetch=async path=>{paths.push(path);return {ok:true,status:200,json:async()=>path==='/api/state'?fresh:{items:records,nextCursor:null}};};
 await h.backup();const saved=JSON.parse(h.S.backupParts[0].text);assert.equal(saved.ads[0]?.code,'NB-NEW');assert.equal(saved.publications[0].materialCode,'NB-NEW');assert.ok(paths.indexOf('/api/state')>paths.indexOf('/api/publications'));
});
test('新素材没有正文时，发布留底表单给出可操作的提示',async()=>{
 assert.throws(()=>opsUI.publicationForm({draft:{code:'NB-001',versions:{}},region:'国内',platform:'douyin'},{id:'acc',timeZone:'Asia/Singapore'},'request-id'),/先.*正文|先.*文案/);
});
test('复制正文包含站内引导，单独复制标题和话题维持各自字段',async()=>{
 const h=await harness(),v={platform:'douyin',region:'国内',title:'普通男生拍写真',body:'广州到店拍摄，268元拍2套。',cta:'可以站内私信「268」。',tags:['男士写真','广州摄影','男生拍照','个人写真','南铂摄影']};
 h.S.draft.versions={'国内::douyin':v};let copied='';h.sandbox.navigator.clipboard.writeText=async text=>copied=text;
 for(const [part,want]of [['title','普通男生拍写真'],['body','广州到店拍摄，268元拍2套。\n\n可以站内私信「268」。'],['tags','#男士写真 #广州摄影 #男生拍照 #个人写真 #南铂摄影']]){
  const button={dataset:{copy:part},classList:{add(){},remove(){}}};await h.listeners.click({target:{closest:()=>button}});assert.equal(copied,want);
 }
});
test('YouTube一键复制说明省去独立标题，其他平台复制整段保留开头句',async()=>{
 const h=await harness();let copied='';h.sandbox.navigator.clipboard.writeText=async text=>copied=text;
 for(const platform of ['youtube','facebook','tiktok','instagram']){
  h.S.platform=platform;h.S.region='海外华人';h.S.draft.versions={};
  h.S.draft.versions['海外华人::'+platform]={platform,title:'广州白衬衫写真｜作品参考',body:'想试试白衬衫写真？\n\n📍南铂摄影｜广州到店拍摄',cta:'欢迎评论留言了解。',tags:['男士写真','广州摄影','白衬衫写真','个人写真','南铂摄影']};
  await h.listeners.click({target:{closest:()=>({dataset:{action:'copy-all'}})}});
  const description='想试试白衬衫写真？\n\n📍南铂摄影｜广州到店拍摄\n\n欢迎评论留言了解。\n\n#男士写真 #广州摄影 #白衬衫写真 #个人写真 #南铂摄影';
  assert.equal(copied,platform==='youtube'?description:'广州白衬衫写真｜作品参考\n\n'+description);
 }
});

test('新建广告默认只有一句话主输入，其余资料收进关闭的选填区域',async()=>{
 const h=await harness();h.newAd();const html=h.elements.get('#modal').innerHTML;
 const [main,optional]=html.split('<details class="optional-fields">');
 assert.match(main,/一句话介绍这条视频/);assert.match(main,/name="name"/);
 assert.doesNotMatch(main,/name="facts"|name="description"|name="theme"/);
 assert.ok(optional);assert.doesNotMatch(html,/<details[^>]*\bopen\b/);
 for(const key of ['facts','theme','description','location','assetUrl','code','region'])assert.match(optional,new RegExp('name="'+key+'"'));
 assert.match(main,/快手4个话题，小红书等平台5个/);
});
test('编辑器展示一句话格式，旧资料和CTA保留为可选项',async()=>{
 const h=await harness();const html=h.editor();
 assert.match(html,/正文（一句话）/);assert.match(html,/一句话 · 五个写真话题/);
 assert.doesNotMatch(html,/看点开头 → 作品介绍|到店与套餐 → 平台咨询/);
 assert.match(html,/<details class="optional-fields"><summary>发布记录与选填信息/);
 assert.match(html,/name="cta"/);
});

test('切换平台时快手提示四个话题，小红书提示五个',async()=>{
 const h=await harness();
 h.S.platform='kuaishou';let html=h.editor();assert.match(html,/一句话 · 四个写真话题/);assert.match(html,/默认 4 个男士写真/);
 h.S.platform='xiaohongshu';html=h.editor();assert.match(html,/一句话 · 五个写真话题/);assert.match(html,/默认 5 个男士写真/);
});

test('视频号提供独立短标题复制，视频描述只复制正文与五话题',async()=>{
 const h=await harness();h.S.platform='channels';const tags=['男士写真','广州男士写真','广州男士拍摄','男生写真','广州写真'];
 h.S.draft.versions={'国内::channels':{platform:'channels',title:'客户和摄影师谁更会选',body:'客户和摄影师选的照片，你更喜欢哪一组？',tags,cta:''}};
 const html=h.editor();assert.match(html,/短标题/);assert.match(html,/复制短标题/);assert.match(html,/6–16字/);assert.match(html,/maxlength="16"/);assert.match(html,/复制视频描述/);
 let copied='';h.sandbox.navigator.clipboard.writeText=async text=>copied=text;
 const titleButton={dataset:{copy:'title'},classList:{add(){},remove(){}}};await h.listeners.click({target:{closest:()=>titleButton}});assert.equal(copied,'客户和摄影师谁更会选');
 await h.listeners.click({target:{closest:()=>({dataset:{action:'copy-all'}})}});
 assert.equal(copied,'客户和摄影师选的照片，你更喜欢哪一组？\n\n'+tags.map(t=>'#'+t).join(' '));
 h.S.platform='douyin';assert.doesNotMatch(h.editor(),/复制短标题|复制视频描述/);
});

test('按国内稿一次更新海外四平台，国内定稿和旧发布记录保持原样',async()=>{
 const h=await harness();const original={platform:'douyin',region:'国内',title:'国内标题',body:'国内定稿正文',tags:['手动话题'],status:'已发布',publishUrl:'https://example.com/video'};
 h.S.draft.versions={'国内::douyin':original,'国内::tiktok':{platform:'tiktok',title:'旧海外标题',body:'旧海外正文',tags:[]}};
 assert.match(h.editor(),/按国内稿更新海外/);
 const requests=[];h.sandbox.fetch=async(path,options)=>{
  const data=JSON.parse(options.body);requests.push({path,data});
  return {ok:true,status:200,json:async()=>path==='/api/generate'?{versions:data.platforms.map(platform=>({platform,title:'新内容标题',body:'来广州拍写真，喜欢这种风格吗？',tags:['广州男士写真','男士写真','马来西亚','新加坡','台湾']}))}:{...data,revision:(data.revision||0)+1}};
 };
 await h.listeners.click({target:{closest:()=>({dataset:{action:'generate-overseas'}})}});
 const call=requests.find(r=>r.path==='/api/generate');
 assert.deepEqual(JSON.parse(JSON.stringify(call?.data.platforms)),['tiktok','instagram','facebook','youtube']);
 assert.equal(h.S.draft.versions['国内::douyin'].body,'国内定稿正文');
 assert.equal(h.S.draft.versions['国内::douyin'].publishUrl,'https://example.com/video');
 assert.equal(h.S.draft.versions['国内::tiktok'].title,'新内容标题');
 assert.equal(Object.values(h.S.draft.versions).length,5);
});
