import {PLATFORMS} from './core.mjs';
import {RESEARCH} from './research-data.mjs';
export {RESEARCH};

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const link=(url,text)=>`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(text)} ↗</a>`;
const panel=(title,body,extra='')=>`<section class="strategy-card ${extra}"><h2>${title}</h2>${body}</section>`;
const para=text=>`<p>${esc(text)}</p>`;
const list=items=>`<ul>${items.map(t=>`<li>${esc(t)}</li>`).join('')}</ul>`;
const num=n=>Number(n).toLocaleString('zh-CN');
const FORMATS={
 douyin:{title:'画面看点或真实问题',flow:['第一句点明画面差异或拍前问题','一条作品依据 + 一条已确认服务事实','开放式问题或站内咨询'],paste:'短视频说明通常将开头、正文和话题合并；若实际入口有独立标题，再单独粘贴标题。',official:'广州男士写真｜268元拍2套',creator:'男生写真，你会先选哪种风格？',tagGuide:'建议3—5个相关话题；作品风格、广州男士写真和品牌优先。'},
 xiaohongshu:{title:'城市或需求 + 具体看点',flow:['交代这条作品适合怎样的选择需求','用短段落说明真实画面、拍前顾虑与已知服务','补充服务地点，给一个自然的站内咨询入口'],paste:'标题单独粘贴；正文分段；话题按当前编辑器的识别结果确认。',official:'广州男士写真｜先选喜欢的风格',creator:'男生第一次拍写真，先想这2件事',tagGuide:'建议3—5个：服务词、真实城市、具体风格或使用场景、品牌；不默认加入无关热词。'},
 kuaishou:{title:'直接讲清作品或服务',flow:['先说这条内容在讲什么','使用朴实短句，说明真实内容或套餐','提出一个容易回答的问题'],paste:'按实际发布入口把文案与话题合并；标题作为开头使用，避免重复。',official:'广州男士写真，268元拍2套',creator:'拍男生写真，先选风格还是用途？',tagGuide:'建议3—5个相关话题，重在准确，不用连续重复的泛流量词。'},
 channels:{title:'一件具体的事 + 地点或品牌',flow:['完整说明作品内容或拍前问题','补充真实服务信息，方便朋友转发后理解','自然邀请了解，不编造客户评价'],paste:'描述与话题以手机实际发布入口为准；短标题与描述分开出现时再分别粘贴。',official:'在广州，留下一组自己的写真',creator:'给第一次拍写真的男生：先想好用途',tagGuide:'围绕作品、人群与广州服务，建议少量相关话题；熟人转发也要看得懂。'},
 tiktok:{title:'中文视觉看点或选择问题',flow:['用简体中文短句给出观看理由','只说视频中实际能看到的变化','明确服务在广州，再给一个简短问题'],paste:'Caption可将开头、正文与话题合并；不把文案中心标题当成每个入口都有的独立字段。',official:'来广州，记录你喜欢的自己',creator:'同样是男生写真，你喜欢哪种表达？',tagGuide:'建议3—5个与画面和中文观众需求相关的话题；海外地区词仅在内容确有关系时使用。'},
 instagram:{title:'作品气质或具体观察',flow:['第一行写真实画面或观看问题','短段落说明作品与已确认服务地点','留一个自然的作品讨论或站内咨询'],paste:'Reels/图片说明通常用第一行作开头；正文与话题一并粘贴。独立标题仅在实际入口提供时使用。',official:'给自己留一组喜欢的写真',creator:'看男生写真时，你先注意什么？',tagGuide:'南铂建议3—5个相关话题；当前账号的实际输入上限需现场核实，不将建议当硬规则。'},
 facebook:{title:'真实需求 + 清晰信息',flow:['说明这组作品或顾客常见问题','交代广州服务与已确认套餐，适合转发后理解','邀请讨论或咨询，避免长串无关文字'],paste:'普通帖子/Reels通常将开头、正文和话题写在同一段说明；按实际入口确认。',official:'广州男士写真｜想记录现在的自己',creator:'选写真风格之前，先想好这张照片的用途',tagGuide:'少量且相关即可；不为了分发堆砌无关话题。'},
 youtube:{title:'可搜索的人群/地点 + 视频内容',flow:['说明本条视频真实展示什么','补充相关背景、服务地点与已确认信息','相关话题放说明中，咨询方式按账号实际可用入口填写'],paste:'标题单独粘贴；正文放说明栏，咨询入口需在实际账号核实。Shorts与长视频分开复盘，不共用观看基线。',official:'广州男士写真作品｜南铂摄影',creator:'男生写真怎么选风格？先想好照片的用途',tagGuide:'南铂建议3—5个相关话题；最多三个说明话题可能显示在标题附近。超过60个会被忽略。'},
};
const EXAMPLES={
 douyin:{official:'想给自己留一组写真，可以先看作品风格。南铂摄影，服务地点广州。268元拍2套，底片全送。你想先了解哪一种风格？',creator:'选男生写真，你会先看风格，还是照片的用途？先找到自己喜欢的表达，再确认具体套餐。南铂摄影在广州，268元拍2套，底片全送。'},
 xiaohongshu:{official:'准备拍男士写真，可以先从作品里挑选自己喜欢的表达。比起直接跟着热门风格走，先想清楚照片的用途，会更容易做选择。\n\n南铂摄影，服务地点在广州。268元拍2套，底片全送。\n\n想了解这组作品或套餐，可以站内咨询。',creator:'男生第一次拍写真，选风格前先想两件事：\n1. 照片准备用在哪里？头像、个人记录，还是纪念某个阶段？\n2. 你想留下怎样的状态？先找喜欢的作品，再看具体拍法。\n\n南铂摄影在广州；268元拍2套，底片全送。你现在最想解决哪个选择问题？'},
 kuaishou:{official:'在广州想拍一组男士写真，可以先看看南铂的作品。268元拍2套，底片全送。喜欢什么样的风格，欢迎说说你的想法。',creator:'男生拍写真，先说清楚自己想把照片用在哪里，再选喜欢的风格。看作品时，找你真正想留下的状态就好。南铂摄影在广州，268元拍2套，底片全送。'},
 channels:{official:'给现在的自己，留一组喜欢的照片。这里是南铂摄影的男士写真作品，服务地点在广州。\n\n268元拍2套，底片全送。想了解作品风格与套餐内容，可以站内咨询。',creator:'第一次拍写真，不用急着决定要“变成谁”。可以先想想：这组照片准备用在哪里，想记录哪个阶段的自己？\n\n再带着这两个问题去看作品、选风格。南铂摄影在广州，268元拍2套，底片全送。'},
 tiktok:{official:'来广州时，也可以把一组写真列入自己的计划。先看看南铂摄影的男士写真作品，找到喜欢的表达。服务地点：广州。268元拍2套，底片全送。',creator:'看男生写真，你会先被画面吸引，还是先想照片的用途？找到喜欢的表达，再确认具体拍摄信息。南铂摄影在广州，268元拍2套，底片全送。'},
 instagram:{official:'照片里，你更想留下怎样的自己？\n\n看看南铂摄影的男士写真作品，慢慢找喜欢的表达。\n广州｜268元拍2套，底片全送。\n想了解作品与套餐，欢迎站内咨询。',creator:'看一组男生写真时，我建议先问一个问题：你喜欢的是这张照片的表达，还是它刚好符合你想记录的状态？\n\n带着自己的用途去选，会更有方向。南铂摄影在广州，268元拍2套，底片全送。'},
 facebook:{official:'想给自己留一组写真，可以先看看南铂摄影的男士写真作品。选风格前，想清楚照片准备用在哪里，再找自己喜欢的表达。\n\n服务地点在广州，268元拍2套，底片全送。我们面向看得懂中文的朋友介绍作品；如有拍摄计划，欢迎站内咨询具体内容。',creator:'选写真风格之前，先把照片的用途说清楚：是个人头像、日常记录，还是给某个阶段留个纪念？不同用途，关注的作品细节也可能不同。\n\n可以先从喜欢的作品找方向，不必急着套用别人的样子。南铂摄影在广州，268元拍2套，底片全送。'},
 youtube:{official:'南铂摄影男士写真作品展示。选择写真风格时，可以结合照片用途与自己喜欢的表达来比较。\n\n服务地点：广州。\n套餐信息：268元拍2套，底片全送。\n想了解作品风格或套餐内容，可以在评论区提出问题。',creator:'男生写真怎么选风格？先明确两个问题：照片准备用在哪里，以及想记录怎样的状态。再带着这两个问题去比较作品。\n\n南铂摄影的服务地点在广州，268元拍2套，底片全送。你更想先了解风格，还是拍前准备？'}
};

export function getBlueprint(platform='douyin',role='official'){
 const p=PLATFORMS.find(p=>p.id===platform)||PLATFORMS[0],r=role==='creator'?'creator':'official',f=FORMATS[p.id];
 return {id:`${p.id}:${r}:v1`,version:'V1.0 · 结构候选',platform:p.id,platformName:p.name,role:r,roleName:r==='official'?'品牌官号':'摄影师 / 主理人自媒体',title:f[r],body:EXAMPLES[p.id][r],tags:['广州男士写真','男士写真','南铂摄影'],titleStructure:f.title,bodyStructure:f.flow,paste:f.paste,tagGuide:f.tagGuide,voice:r==='official'?'用南铂品牌口吻说明作品与真实服务，清楚、克制、方便咨询。':'用真实专业观察建立信任，说明选择理由；身份仍是南铂相关创作者，不扮演顾客。'};
}

// This is a planning preview. It is not connected to the publication database.
export function assessHeat(current,history=[]){
 const keys=['accountId','platform','format','traffic','windowHours','metric'];
 if(keys.some(k=>current?.[k]===undefined||current[k]===null||current[k]==='')||!(Number(current.windowHours)>0))return {label:'比较条件待补全',sampleSize:0,median:null,ratio:null};
 const valid=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
 const cohort=history.filter(p=>p.id!==current.id&&keys.every(k=>p[k]===current[k])&&valid(p.value)).sort((a,b)=>(Date.parse(b.observedAt)||0)-(Date.parse(a.observedAt)||0));
 const used=new Set(),sample=cohort.filter(p=>{if(!p.id||used.has(p.id))return false;used.add(p.id);return true;}).slice(0,20);
 const base={sampleSize:sample.length,median:null,ratio:null};
 if(!valid(current.value))return {...base,label:'未录入数据'};
 if(sample.length<10)return {...base,label:'样本待积累'};
 const sorted=sample.map(p=>p.value).sort((a,b)=>a-b),n=sorted.length,median=n%2?sorted[(n-1)/2]:(sorted[n/2-1]+sorted[n/2])/2;
 if(median===0)return {...base,median,label:'基线为零，暂不判断'};
 const ratio=current.value/median;
 return {...base,median,ratio,label:ratio>=2?'高于近期基线':ratio<0.5?'低于近期基线':'近期正常范围'};
}

function overview(){return `
 <div class="strategy-lead"><span class="strategy-chip">研究与设计 · V1.0</span><h2>固定框架，让每条作品都有新内容。</h2><p>一条真实素材，按平台和账号分别表达；每次发布留下文案快照与结果。稳定的是结构、身份和品牌语气，持续更新的是作品、切入点与相关话题。</p><p class="strategy-note">本页是研究资料与长期运营方案。模板预览与热度演示不写入广告库；现有生成与保存流程继续使用当前版本。账号隔离与指标采集在下方列出具体设计，尚未上线。</p></div>
 <div class="strategy-grid">${panel('先固定这四件事',list(['统一简体中文，面向看得懂中文的用户；服务地点仍按真实门店写广州。','官号说明作品与服务，自媒体解释专业观察；两个角色各有稳定语气。','保留标题、正文、话题三个复制按钮，并按平台说明粘贴位置。','套餐与服务事实来自素材档案，模板不写死价格、赠送内容或未经确认的服务。']))}${panel('每次更新这四件事',list(['选择这条画面实际能证明的看点，不把所有素材写成“爆改”。','换具体的问题、作品风格或使用场景，避免每个账号发同一句话。','话题使用服务、真实城市、素材特点和品牌；热点必须相关且有采集日期。','用同账号的发布数据复盘，按询盘与到店评估业务价值。']))}</div>
 ${panel('账号与素材如何分开',`<ol class="strategy-flow"><li><b>素材档案</b><span>共享真实事实、原视频链接和授权信息。</span></li><li><b>账号文案</b><span>选择平台、账号、角色和目标地区，单独保存。</span></li><li><b>发布快照</b><span>每次实际发布都记链接、时间、形式与当时文案。</span></li><li><b>数据快照</b><span>同一发布分24小时、72小时、7天记录可获得的数据。</span></li></ol><p class="strategy-note">后续修改草稿不会改写已经发布的内容记录；这些观察窗口是南铂的运营约定，不是平台流量承诺。</p>`)}
 ${panel('适合长期更新的六个栏目',`<div class="strategy-columns">${[['真实作品','一条素材只讲一个实际风格或使用场景；画面是主要依据。'],['风格选择','仅在同条素材确有差异时做对照；解释选择，尊重出镜者。'],['第一次拍摄的问题','围绕选风格、用途、准备事项；服务答案必须来自已确认资料。'],['摄影师的一个判断','说清真实的光线、动作或选片理由；更适合创作者账号。'],['套餐与交付说明','只写已确认内容；更新事实档案后，才生成对应版本。'],['阶段记录与回访','生日、毕业、复拍等需要真实素材支撑；没有证据时不编故事。']].map(([a,b])=>`<div><h3>${a}</h3><p>${b}</p></div>`).join('')}</div><p>试运行建议：先用每周2—3条真实素材验证栏目；一个素材按角色选不同角度，再适配实际运营的平台。频率以素材质量与回复能力决定，不强制八个平台同一天全发。</p>`)}
 ${panel('模板稳定，规则可以维护',`<p>建议保留V1.0的字段顺序、角色语气、复制方式与简体中文约定。标题钩子、画面描述、套餐事实、地区语境、话题及发布时段作为变量。平台输入限制和运营建议分别记录，不因一次低播放重做全部模板。</p><p>先用10—20条同类内容形成账号基线，再决定栏目与开头的调整；不需要每次换一整套界面。模板升级保存版本号和原因，旧发布保留原模板编号。</p>`)}
 `;}

function evidence(){return `
 <div class="strategy-stats"><div><b>184</b><span>历史视频样本</span></div><div><b>3</b><span>广州男士写真账号</span></div><div><b>12</b><span>精选结构拆解</span></div><div><b>1</b><span>本轮现场复核案例</span></div></div>
 ${panel('证据范围与采集时间',para(RESEARCH.method)+para(RESEARCH.limits)+`<p>历史采集：${RESEARCH.historicalCapture}；本轮研究：${RESEARCH.reviewedAt}。本研究分析可借鉴的结构，不承诺同样文案能复制相同传播效果。</p>`)}
 ${panel('三个账号的样本分布',`<div class="strategy-table-wrap"><table><thead><tr><th>账号</th><th>视频数</th><th>累计点赞中位数</th><th>范围</th></tr></thead><tbody>${RESEARCH.accounts.map(a=>`<tr><td>${esc(a.name)}</td><td>${a.videos}</td><td>${num(a.likesMedian)}</td><td>${num(a.likesMin)}—${num(a.likesMax)}</td></tr>`).join('')}</tbody></table></div><p class="strategy-note">不同发布时间、投流与账号条件未控制。这张表只描述选取的作品，不用于给账号排名，也不是热度阈值。</p>`)}
 ${panel('现场复核：风格对照案例',`<p>${link(RESEARCH.liveCheck.url,'查看抖音原作品')} · 发布时间 ${RESEARCH.liveCheck.publishedAt}</p><p>2026-10-20公开页面显示：${num(RESEARCH.liveCheck.likes)}赞、${num(RESEARCH.liveCheck.comments)}评论、${num(RESEARCH.liveCheck.saves)}收藏、${num(RESEARCH.liveCheck.shares)}分享。历史清单记录为2814赞。</p><p class="strategy-note">${RESEARCH.liveCheck.note}；没有公开询盘、投放和到店数据，不能把高互动直接解释为高转化。</p>`)}
 <div class="strategy-case-grid">${RESEARCH.cases.map(c=>`<article class="strategy-card"><span class="strategy-chip">${esc(c.pattern)}</span><h3>${link(c.url,c.excerpt)}</h3><p class="strategy-note">${esc(c.account)} · ${esc(c.likesDisplay)}赞 · ${Number(c.durationSeconds).toFixed(1)}秒<br>历史快照 ${c.capturedAt}</p><p>${esc(c.observation)}</p><p><b>南铂怎么借鉴：</b>${esc(c.adaptation)}</p><p class="strategy-tags">${esc(c.tags.map(t=>'#'+t).join(' '))}</p></article>`).join('')}</div>
 ${panel('最值得借鉴的三个结构',list(['真实差异：同一个人、两种实际风格，让观众带着选择问题看结果。','拍前顾虑：回应普通人的具体问题，少用泛泛赞美或贬低外貌的话。','专业判断：说明一个真实选择的理由，把摄影师身份变成可验证的观察。'])+'<p>“再发一次会火”等弱信息标题也可能获得高点赞，说明结果无法归因于文案一句话。因此长期模板要能解释作品、被顾客理解，并接受发布数据验证。</p>')}
 ${panel('八个平台：已查到什么，缺什么',`<div class="strategy-coverage">${RESEARCH.coverage.map(c=>`<div><h3>${c.name}<small>${esc(c.level)}</small></h3><p>${esc(c.detail)}</p></div>`).join('')}</div>`)}
 ${panel('官方资料与适用范围',`<div class="strategy-sources">${RESEARCH.sources.map(s=>`<article><h3>${link(s.url,s.title)}</h3><small>${esc(s.scope)}</small><p>${esc(s.finding)}</p></article>`).join('')}</div><p class="strategy-note">官方工具或帮助页面验证的是功能与要求，不能代替同行效果样本。规则以实际发布入口及账号当前可见信息为准。</p>`)}
 `;}

function templates(platform,role){const b=getBlueprint(platform,role);return `
 <div class="strategy-card"><h2>八个平台 × 两种账号角色</h2><p>先看稳定结构，再看示例。这里的16种组合是运营候选；实际账号名、定位与样本补齐后，才绑定到各账号。</p>
 <div class="platform-tabs strategy-platforms" aria-label="模板平台">${PLATFORMS.map(p=>`<button class="platform-tab ${b.platform===p.id?'active':''}" data-strategy-platform="${p.id}" data-platform-theme="${p.id}" aria-pressed="${b.platform===p.id}">${p.name}</button>`).join('')}</div>
 <div class="strategy-roles" role="group" aria-label="模板账号角色">${[['official','品牌官号'],['creator','摄影师 / 主理人自媒体']].map(([id,name])=>`<button class="btn ${b.role===id?'primary':''}" data-strategy-role="${id}" aria-pressed="${b.role===id}">${name}</button>`).join('')}</div>
 <h3>${b.platformName} · ${b.roleName}</h3><p>${b.voice}</p><dl class="strategy-definition"><dt>标题结构</dt><dd>${b.titleStructure}</dd><dt>正文结构</dt><dd>${b.bodyStructure.map((t,i)=>`${i+1}. ${t}`).join('<br>')}</dd><dt>粘贴位置</dt><dd>${b.paste}</dd><dt>话题策略</dt><dd>${b.tagGuide}</dd></dl></div>
 ${panel('文案示例 · 可复制',`<p class="strategy-note">演示素材事实：南铂摄影、广州、268元拍2套、底片全送。未假设服装、化妆、精修、现场经历或海外门店。示例不是对某条素材的已审核发布稿，也不会写入广告库。</p><div class="strategy-example" data-platform-theme="${b.platform}">${[['title','标题',b.title],['body','正文',b.body],['tags','话题',b.tags.map(t=>'#'+t).join(' ')]].map(([key,name,value])=>`<div><div class="field-copy-head"><b>${name}</b><button class="btn copy-btn" data-template-copy="${key}">复制${name}</button></div><div class="strategy-copy-text">${esc(value)}</div></div>`).join('')}</div>`)}
 ${panel('账号身份与表达边界',`<div class="strategy-grid"><div><h3>官号</h3><p>稳定回答“这里有什么作品、适合谁、真实服务是什么、如何咨询”。案例说明与套餐信息都以品牌身份发布。</p></div><div><h3>自媒体号</h3><p>围绕摄影师或主理人的真实观察、审美选择与拍摄问题展开。涉及商业关系时按实际平台要求标识，不伪装顾客体验。</p></div></div><p>同平台不同账号只共享素材事实，各自保存文案。不能只改账号名、换几个同义词就批量复制；角色、开头角度和表达重点都要不同。</p>`)}
 ${panel('海外统一简体中文',`<p>马来西亚、新加坡、台湾及其他华人受众均用简体中文。先写可理解的具体内容，再说明服务在广州。只有作品确实涉及来广州拍摄、当地生活或真实客户背景时，才加入对应地区语境。</p><p>不因选择海外地区就生成海外分店、当地报价或当地拍摄话题。跨境价格如需展示人民币单位，先核实素材中的币种；不自动换汇。</p>`)}
 `;}

function measurement(){const current={id:'demo-current',accountId:'demo-official',platform:'douyin',format:'short',traffic:'organic',windowHours:72,metric:'views',value:2500};const history=Array.from({length:12},(_,i)=>({...current,id:'demo-'+i,value:1000,observedAt:new Date(Date.UTC(2026,8,20+i)).toISOString()}));const h=assessHeat(current,history);return `
 ${panel('热度与到店，分开看',`<div class="strategy-grid"><div><h3>内容传播</h3><p>记录平台可见的播放、曝光、观看时长、完播或划走，以及点赞、收藏、评论、分享。按实际可获取项填写，缺失留空。</p></div><div><h3>业务结果</h3><p>另记有效询盘、预约与实际到店，以及可确认的来源作品。高播放但无相关咨询的内容，不自动评为高转化。</p></div></div><p>视频内容、封面、标题、账号历史、发布时间和付费流量都会影响结果。记录相关变化，避免把一次表现归因于文案或话题。</p>`)}
 ${panel('南铂相对表现口径 · 演示数据',`<div class="strategy-result"><b>${h.label}</b><strong>${h.ratio.toFixed(1)}×</strong><span>示例：72小时播放2500 ÷ 同条件历史中位数1000</span></div><p>只选同账号、同平台、同形式、同流量来源、同指标、同观察窗口的最近20条历史发布；去重并排除当前作品，至少10条有效数据才判断。低于0.5倍为低于近期基线，0.5至不足2倍为近期正常范围，2倍及以上为高于近期基线。</p><p class="strategy-note">以上是可修改的南铂内部试运行约定，不是平台官方“热门”认证。中位数为0时不计算倍数；未知数据留空，真实零保留。付费/自然/混合/未知流量分开记录，不以跨平台点赞总数排名。</p>`)}
 ${panel('一条发布，三次观察',`<div class="strategy-columns">${[['24小时','初步检查内容是否被观看，是否出现相关咨询；数据未成熟时不急着判定失败。'],['72小时','对照同类历史，观察观看与互动；核对标题是否吸引了目标人群。'],['7天','记录后续搜索、咨询、预约与到店，识别值得长期更新的栏目。']].map(([a,b])=>`<div><h3>${a}</h3><p>${b}</p></div>`).join('')}</div><p>每次记录实际采集时间及发布后时长。错过72小时窗口，就标记实际时长，不能把7天累计值填成72小时。平台没有开放的数据留空；初版采用人工录入或后台导出，不承诺自动抓取。</p>`)}
 ${panel('每次发布需要保留的字段',`<dl class="strategy-definition"><dt>身份与素材</dt><dd>账号固定ID、平台、官号/创作者、素材ID、目标地区、栏目。</dd><dt>当时的内容</dt><dd>标题、正文、话题、引导语、封面版本、视频版本、文案模板版本。</dd><dt>实际发布</dt><dd>作品链接、发布时间与时区、内容形式、视频时长、自然/付费/混合/未知流量、已知花费。</dd><dt>观察数据</dt><dd>采集时间、发布后时长、指标名称、原始数值、数据来源与是否可获得。</dd><dt>获客结果</dt><dd>有效咨询、预约、到店数量与可确认的来源作品，按账号保留汇总归因。</dd></dl>`)}
 `;}

function rollout(){return `
 ${panel('这次已完成的研究与设计',list(['核对184条抖音历史样本，整理12个案例，现场复核1条互动数据。','建立八个平台的证据范围表，区分同行样本、官方说明与待补信息。','提供八平台×官号/自媒体的16个结构候选与可复制示例。','确定账号文案隔离、发布快照、分阶段指标和相对表现的设计口径。']))}
 ${panel('账号管理：准备这样落地',`<ol><li>账号有固定ID、平台、名称、主页、角色、定位、主要受众与状态；同平台可有多个账号。</li><li>共享素材事实；文案以“素材ID＋账号ID＋地区”独立存储。切换账号不会覆盖另一个账号的手改文案。</li><li>每个账号绑定固定结构和语气，生成前明确目标账号。没有账号信息时，保留当前平台基础稿，不假定真实账号身份。</li><li>生成结果先复核事实，明确覆盖范围；补全只补缺项，不覆盖已有手改稿。历史快照可恢复，旧发布不随草稿变化。</li></ol>`)}
 ${panel('数据结构与迁移要求',`<div class="strategy-table-wrap"><table><thead><tr><th>记录</th><th>职责</th><th>关键约束</th></tr></thead><tbody><tr><td>accounts</td><td>真实账号与角色</td><td>固定ID；停用保留历史</td></tr><tr><td>templates</td><td>结构、语气、平台建议</td><td>版本化；平台硬限制另存来源与核验日期</td></tr><tr><td>account_versions</td><td>各账号的可编辑文案</td><td>素材＋账号＋地区唯一；修订号防止设备间覆盖</td></tr><tr><td>publications</td><td>每次发布的内容快照</td><td>允许同一素材多次发布；保留当时内容和模板版本</td></tr><tr><td>metric_snapshots</td><td>分阶段原始数据</td><td>未知用null；采集时间、实际时长、来源必记</td></tr></tbody></table></div><p>现有八平台与地区文案先保留为基础稿，明确选择目标账号后再复制为账号稿；不能直接把键名替换后丢失旧版本。现有发布状态只作历史信息，未经核对不伪造成带账号的发布记录。</p><p>备份必须包含新旧广告、账号、模板、账号文案、发布快照与指标；先在隔离环境验证导入、旧备份兼容、冲突处理和回滚，再迁移正式库。</p>`)}
 ${panel('还需要补齐的真实资料',`<p>每个实际账号的主页或账号名，以及官号/摄影师/主理人身份、定位和主要受众。小红书需登录后补充相关同行笔记；其他平台需能打开的相关作品或后台数据，才能将候选结构定为账号模板。</p><p>现有研究足以确定信息架构与第一版候选，但还不足以声称八个平台都找到可复现的“爆款”。补充资料后只完善账号层与证据，不需要推倒已经确定的界面风格和字段结构。</p>`)}
 ${panel('部署顺序与验收',`<ol><li><b>账号隔离：</b>两个同平台账号编辑互不覆盖；手机电脑同步；原广告与备份可读。</li><li><b>生成与复制：</b>按账号角色生成，保持简体中文与真实事实；三个复制按钮和平台识别色完整保留。</li><li><b>发布记录：</b>每次发布都有独立快照，修改草稿不改变旧记录；自然与付费分开。</li><li><b>数据复盘：</b>空值与零区分、不同窗口不混算、样本不足不贴热度标签；询盘到店单独记录。</li><li><b>模板维护：</b>候选变成正式账号模板前核对身份与样本；结构按版本保存，热点与平台要求可更新。</li></ol><p class="strategy-note">以上为后续功能的实现设计。本次上线的是“运营方案”资料页，未变更广告库、现有生成提示词或发布数据。</p>`)}
 `;}

export function renderStrategy(state={}){
 const tab=['overview','evidence','templates','measurement','rollout'].includes(state.tab)?state.tab:'overview';
 const names=[['overview','长期结构'],['evidence','研究证据'],['templates','八平台模板'],['measurement','热度与转化'],['rollout','落地设计']];
 return `<div class="strategy"><header class="page-heading"><div><div class="eyebrow">CONTENT OPERATIONS · 研究与长期设计</div><h1>先有内容依据，再固定模板。</h1><p>南铂文案中心 · ${RESEARCH.reviewedAt} · 全平台简体中文</p></div><button class="btn" data-action="research-export">下载研究与模板</button></header><nav class="strategy-subnav" aria-label="运营方案章节">${names.map(([id,name])=>`<button class="${id===tab?'active':''}" data-strategy-tab="${id}" aria-pressed="${id===tab}">${name}</button>`).join('')}</nav>${tab==='evidence'?evidence():tab==='templates'?templates(state.platform,state.role):tab==='measurement'?measurement():tab==='rollout'?rollout():overview()}</div>`;
}

export function exportStrategy(){return {format:'nanbo-content-operations',version:'1.0',scope:'研究与设计，不是广告库备份',research:RESEARCH,blueprints:PLATFORMS.flatMap(p=>['official','creator'].map(r=>getBlueprint(p.id,r))),heatPolicy:{comparisonKeys:['accountId','platform','format','traffic','windowHours','metric'],windowsHours:[24,72,168],minimumSamples:10,recentSamples:20,lowBelow:0.5,highFrom:2,status:'南铂内部候选规则，不代表平台热门认证'}};}
