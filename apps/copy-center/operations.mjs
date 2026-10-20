import {PLATFORMS, REGIONS, cleanText, safeUrl, simplified, chunkAds} from './core.mjs';

export const TIME_ZONES = [
  ['Asia/Shanghai','北京 / 广州'],['Asia/Kuala_Lumpur','马来西亚'],['Asia/Singapore','新加坡'],['Asia/Taipei','台湾'],
  ['America/New_York','纽约 / 美东'],['America/Los_Angeles','洛杉矶 / 美西'],['America/Vancouver','温哥华'],
  ['America/Toronto','多伦多'],['Europe/London','伦敦'],['Australia/Sydney','悉尼'],['Asia/Tokyo','东京'],['Asia/Bangkok','曼谷'],['UTC','UTC']
];
export const regionZone = region => ({国内:'Asia/Shanghai',马来西亚:'Asia/Kuala_Lumpur',新加坡:'Asia/Singapore',台湾:'Asia/Taipei'}[region]||'');
export function validZone(zone){try{if(!zone||typeof zone!=='string')throw 0;new Intl.DateTimeFormat('en',{timeZone:zone}).format();return zone;}catch{throw new Error('请选择有效的 IANA 时区，例如 Asia/Singapore');}}
export function localTime(instant,zone){
  validZone(zone);const date=new Date(instant);if(!Number.isFinite(+date))throw new Error('时间不正确');
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).map(p=>[p.type,p.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
export function localToInstant(value,zone){
  validZone(zone);if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(value))throw new Error('请填写完整的当地日期和时间');
  const guess=Date.parse(value+'Z');if(!Number.isFinite(guess)||new Date(guess).toISOString().slice(0,16)!==value)throw new Error('日期或时间不正确');
  const offsets=new Set();for(let h=-36;h<=36;h+=6){const ms=guess+h*3600000;offsets.add(Date.parse(localTime(ms,zone)+'Z')-ms);}
  const matches=[...offsets].map(offset=>guess-offset).filter(ms=>localTime(ms,zone)===value);
  if(!matches.length)throw new Error('此当地时间因夏令时跳转不存在，请选择其他时间');
  if(matches.length>1)throw new Error('此当地时间因夏令时重复，请选择其他时间');
  return new Date(matches[0]).toISOString();
}
export const todayBeijing=()=>localTime(Date.now(),'Asia/Shanghai').slice(0,10);
function dateOnly(value,label){const s=cleanText(value,10,label);if(s&&(!/^\d{4}-\d\d-\d\d$/.test(s)||new Date(s+'T00:00Z').toISOString().slice(0,10)!==s))throw new Error(label+'不正确');return s;}
function id(value,label){const s=cleanText(value,80,label);if(!/^[a-zA-Z0-9-]+$/.test(s))throw new Error(label+'不正确');return s;}
export function validateAccount(input){
  const name=cleanText(input.name,100,'账号名称');if(!name)throw new Error('请填写账号名称');
  if(!PLATFORMS.some(p=>p.id===input.platform))throw new Error('账号平台不正确');
  const region=REGIONS.includes(input.region)?input.region:'国内',timeZone=validZone(input.timeZone||regionZone(region));
  const times=(Array.isArray(input.times)?input.times:String(input.times||'12:30 20:00').split(/[\s,，]+/)).filter(Boolean);
  if(!times.length||times.length>5||times.some(t=>!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)))throw new Error('发布时间需要 HH:mm 格式，最多5个');
  const basis=input.basis==='账号后台'?'账号后台':'测试建议',evidence=cleanText(input.evidence,1000,'时段依据');
  if(basis==='账号后台'&&!evidence)throw new Error('请记录账号后台活跃时间的依据或统计日期');
  return {id:id(input.id,'账号编号'),name,platform:input.platform,role:input.role==='自媒体'?'自媒体':'官号',region,timeZone,times:[...new Set(times)].sort(),basis,evidence,homeUrl:safeUrl(input.homeUrl,'账号主页'),archived:input.archived===true||input.archived==='true'};
}
export function validateOffer(input,old){
  const name=cleanText(input.name,100,'套餐名称'),facts=cleanText(input.facts,8000,'套餐事实');if(!name||!facts)throw new Error('请填写套餐名称和已确认的事实');
  const validFrom=dateOnly(input.validFrom,'生效日期'),validTo=dateOnly(input.validTo,'到期日期');if(validFrom&&validTo&&validFrom>validTo)throw new Error('到期日期不能早于生效日期');
  const offer={id:id(input.id,'套餐编号'),name,facts,validFrom,validTo,archived:input.archived===true||input.archived==='true'};
  const changed=!old||['name','facts','validFrom','validTo','archived'].some(k=>old[k]!==offer[k]);
  return {...offer,revision:old?(old.revision||1)+(changed?1:0):1};
}
export function validateOperations(input,old={}){
  const accounts=input.accounts===undefined?(old.accounts||[]):input.accounts,offers=input.offers===undefined?(old.offers||[]):input.offers;
  if(!Array.isArray(accounts)||accounts.length>100||!Array.isArray(offers)||offers.length>100)throw new Error('账号或套餐数量超限');
  const a=accounts.map(validateAccount),o=offers.map(v=>validateOffer(v,(old.offers||[]).find(x=>x.id===v.id)));
  if(new Set(a.map(x=>x.id)).size!==a.length||new Set(o.map(x=>x.id)).size!==o.length)throw new Error('账号或套餐编号重复');
  // Referenced IDs remain usable in old snapshots; retire instead of deleting.
  for(const entry of old.accounts||[])if(!a.some(x=>x.id===entry.id&&x.platform===entry.platform))throw new Error('已有账号请停用，不能删除或更换平台');
  for(const entry of old.offers||[])if(!o.some(x=>x.id===entry.id))throw new Error('已有套餐请停用，不能删除');
  return {accounts:a,offers:o};
}
export function offerReasons(ad,config,today=todayBeijing()){
  if(!ad.offerId)return [];const offer=(config.offers||[]).find(o=>o.id===ad.offerId);
  if(!offer)return ['关联套餐不存在，请重新选择'];
  if(offer.archived)return ['关联套餐已停用'];
  if(offer.validFrom&&today<offer.validFrom)return ['关联套餐尚未生效'];
  if(offer.validTo&&today>offer.validTo)return ['关联套餐已到期'];return [];
}
export function effectiveAd(ad,config){const offer=(config.offers||[]).find(o=>o.id===ad.offerId);return {...ad,facts:[offer?.facts,ad.facts].filter(Boolean).join('\n')};}
export function factStamp(ad,config){
  const offer=(config.offers||[]).find(o=>o.id===ad.offerId);
  const text=JSON.stringify([ad.facts||'',ad.location||config.settings?.location||'',ad.offerId||'',offer||null,config.settings?.facts||'']);
  let a=2166136261,b=5381;for(const c of text){const n=c.charCodeAt(0);a=Math.imul(a^n,16777619);b=Math.imul(b,33)^n;}
  return (a>>>0).toString(16).padStart(8,'0')+(b>>>0).toString(16).padStart(8,'0');
}
export function reviewReasons(ad,v,config,today=todayBeijing()){
  const reasons=offerReasons(ad,config,today);if(v?.body&&v.factStamp!==factStamp(ad,config))reasons.push(v.factStamp?'套餐或服务事实已变化，请复核文案':'这份文案尚未核对当前套餐与服务事实');return reasons;
}
export function publishSuggestions(account,date){
  const timeZone=validZone(account.timeZone),times=account.times?.length?account.times:['12:30','20:00'];
  return {basis:account.basis==='账号后台'?'账号后台':'测试建议',evidence:account.evidence||'午间与晚间两个测试时段，需结合本账号实际数据调整。',timeZone,rows:times.map(time=>{try{const instant=localToInstant(date+'T'+time,timeZone);return {local:date+'T'+time,instant,beijing:localTime(instant,'Asia/Shanghai')};}catch(e){return {local:date+'T'+time,error:e.message};}})};
}
export function publicationRecord(input,ad,account,config,now=new Date().toISOString()){
  if(!account||account.archived)throw new Error('请选择有效的发布账号');
  if(input.platform!==account.platform)throw new Error('发布账号与文案平台不一致');
  const region=cleanText(input.region||ad.region,80,'目标地区'),version=ad.versions?.[region+'::'+account.platform];
  if(!version?.body)throw new Error('请先保存这个平台的文案');
  const reasons=reviewReasons(ad,version,config);if(reasons.length)throw new Error(reasons.join('；'));
  const timeZone=validZone(input.timeZone||account.timeZone),publishedAt=localToInstant(input.localPublishedAt,timeZone);
  if(Date.parse(publishedAt)>Date.parse(now)+60000)throw new Error('发布留底用于已完成的发布，时间不能在未来');
  const publishUrl=safeUrl(input.publishUrl,'作品链接'),proofUrl=safeUrl(input.proofUrl,'凭证链接');if(!publishUrl&&!proofUrl)throw new Error('请填写作品链接或发布凭证链接');
  const title=simplified(cleanText(input.title,500,'发布标题')),body=simplified(cleanText(input.body,20000,'发布正文'));
  if(!title||!body)throw new Error('请填写实际发布的标题和正文');
  const tags=(Array.isArray(input.tags)?input.tags:String(input.tags||'').split(/[\s#，,]+/)).filter(Boolean);if(tags.length>30)throw new Error('话题数量超限');
  return {id:id(input.id,'留底编号'),adId:ad.id,materialCode:ad.code,adName:ad.name,accountId:account.id,account:structuredClone(account),platform:account.platform,region,adRevision:ad.revision,publishedAt,timeZone,publishUrl,proofUrl,snapshot:{title,body,tags:tags.map(t=>simplified(cleanText(t,100,'话题').replace(/^#+/,''))),cta:simplified(cleanText(input.cta,2000,'咨询引导')),assetUrl:ad.assetUrl||'',assetName:ad.assetName||'',coverUrl:safeUrl(input.coverUrl||ad.coverUrl,'封面链接'),facts:effectiveAd(ad,config).facts,sharedFacts:config.settings?.facts||'',location:ad.location||config.settings?.location||'',factStamp:factStamp(ad,config)},notes:cleanText(input.notes,2000,'留底备注'),createdAt:now};
}
export function restorePublication(source,ad){
  const account=validateAccount(source.account||{}),publishedAt=new Date(source.publishedAt).toISOString();
  if(source.materialCode!==ad.code||source.accountId!==account.id||source.platform!==account.platform)throw new Error('留底的素材编号或账号不一致');
  const v=source.snapshot||{},publishUrl=safeUrl(source.publishUrl,'作品链接'),proofUrl=safeUrl(source.proofUrl,'凭证链接');
  if(!publishUrl&&!proofUrl)throw new Error('留底缺少作品或凭证链接');
  const tags=Array.isArray(v.tags)?v.tags:[];if(tags.length>30)throw new Error('话题数量超限');
  const title=cleanText(v.title,500,'标题'),body=cleanText(v.body,20000,'正文');if(!title||!body)throw new Error('留底缺少标题或正文');
  return {id:id(source.id,'留底编号'),adId:ad.id,materialCode:ad.code,adName:cleanText(source.adName,160,'素材名称'),accountId:account.id,account,platform:account.platform,region:cleanText(source.region,80,'地区'),adRevision:Number.isSafeInteger(source.adRevision)?source.adRevision:1,publishedAt,timeZone:validZone(source.timeZone),publishUrl,proofUrl,snapshot:{title,body,tags:tags.map(t=>cleanText(t,100,'话题')),cta:cleanText(v.cta,2000,'咨询引导'),assetUrl:safeUrl(v.assetUrl,'素材链接'),assetName:cleanText(v.assetName,300,'素材文件名'),coverUrl:safeUrl(v.coverUrl,'封面链接'),facts:cleanText(v.facts,16001,'套餐事实'),sharedFacts:cleanText(v.sharedFacts,8000,'共同事实'),location:cleanText(v.location,200,'服务地点'),factStamp:cleanText(v.factStamp,100,'核对标记')},notes:cleanText(source.notes,2000,'备注'),createdAt:new Date(source.createdAt).toISOString()};
}
export function backupParts(ads,publications){
  const a=chunkAds(ads,12000000,500),p=chunkAds(publications,8000000,250);
  if(a.length<=1&&p.length<=1)return [{ads:a[0]||[],publications:p[0]||[]}];
  return [...a.map(ads=>({ads,publications:[]})),...p.map(publications=>({ads:[],publications}))];
}
