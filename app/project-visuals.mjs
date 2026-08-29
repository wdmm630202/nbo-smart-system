const portrait = '<img class="mini-photo" src="/nbo-smart-system/system-preview-after.jpg" alt="">';
const beforePortrait = '<img class="mini-photo" src="/nbo-smart-system/system-preview-before.jpg" alt="">';

const chrome = (title, body, options = {}) => `
  <div class="mini-ui mini-ui-${options.kind ?? "default"}">
    <div class="mini-chrome">
      <span class="mini-lights"><i></i><i></i><i></i></span>
      <b>${title}</b>
      <em>${options.status ?? "运行中"}</em>
    </div>
    <div class="mini-body">${body}</div>
  </div>`;

const interfaces = {
  network: {
    label: "南铂 Stash 设备与灾备运行界面",
    markup: "",
  },
  studio: {
    label: "正在制作封面图",
    markup: chrome("NBO 灵感封面", `
      <div class="studio-tools">
        <span class="active">照片</span><span>标题</span><span>平台</span>
      </div>
      <div class="studio-canvas">
        <div class="cover-sheet">${portrait}<div class="cover-shade"></div><strong>不太会摆姿势<br><b>也能拍得自然</b></strong><small>NANBO PORTRAIT</small></div>
      </div>
      <div class="studio-progress"><strong>正在制作封面图</strong><span><i></i></span><small>识图与排版 76%</small></div>`, { kind: "studio", status: "生成中" }),
  },
  server: {
    label: "服务器与备份运行状态",
    markup: chrome("NBO 服务器管家", `
      <div class="server-score"><strong>99</strong><span>系统健康</span><i>全部正常</i></div>
      <div class="server-stack">
        <div><b>Immich</b><span class="online">运行中</span></div>
        <div><b>Docker</b><span class="online">8 个容器</span></div>
        <div><b>照片备份</b><span>刚刚完成</span></div>
      </div>
      <div class="server-chart"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>`, { kind: "server", status: "24/7 守护" }),
  },
  workflow: {
    label: "珠宝照片精修流程",
    markup: chrome("珠宝修图生产台", `
      <div class="jewel-canvas"><span class="jewel-ring"><i></i></span><small>钻戒原片</small></div>
      <div class="workflow-steps">
        <div class="done"><i>✓</i><span>安全导入<small>24 张</small></span></div>
        <div class="active"><i>2</i><span>清洁精修<small>进行中</small></span></div>
        <div><i>3</i><span>颜色校准<small>待处理</small></span></div>
        <div><i>4</i><span>交付导出<small>待处理</small></span></div>
      </div>`, { kind: "workflow", status: "生产中" }),
  },
  odds: {
    label: "比赛赔率与风险界面",
    markup: chrome("足球赔率工作台", `
      <div class="match-head"><span>今晚 22:00</span><b>曼城 <i>VS</i> 阿森纳</b><em>风险受控</em></div>
      <div class="odds-grid"><span><small>主胜</small><b>1.82</b></span><span><small>平局</small><b>3.45</b></span><span><small>客胜</small><b>4.10</b></span></div>
      <div class="odds-risk"><span>当前敞口</span><strong>− ¥180</strong><i><b></b></i></div>`, { kind: "odds", status: "实时记录" }),
  },
  video: {
    label: "竖屏视频剪辑时间线",
    markup: chrome("图文卡点视频", `
      <div class="video-preview"><div class="video-phone">${portrait}<span>男士写真<br><b>拍得明白</b></span><i>▶</i></div></div>
      <div class="video-editor"><div class="timecode">00:12.8 / 00:20.4</div><div class="timeline"><span></span><i class="clip one"></i><i class="clip two"></i><i class="clip three"></i><i class="beat b1"></i><i class="beat b2"></i><i class="playhead"></i></div><small>封面 · 节奏卡点 · 高清导出</small></div>`, { kind: "video", status: "预览中" }),
  },
  crm: {
    label: "企业微信客户跟进界面",
    markup: chrome("企业微信客户资产", `
      <div class="crm-list"><strong>待跟进 8</strong><span class="active"><i>陈</i><b>陈先生<small>想了解 268 套餐</small></b></span><span><i>林</i><b>林先生<small>已发送客片</small></b></span></div>
      <div class="crm-chat"><div class="chat-meta"><b>陈先生</b><em>首次咨询</em></div><p class="incoming">不太会摆姿势，能拍好吗？</p><p class="outgoing">会全程引导，先看您喜欢的感觉。</p><span class="follow-up">今天 18:30 提醒跟进</span></div>`, { kind: "crm", status: "8 位待跟进" }),
  },
  agent: {
    label: "男士写真三天运营计划",
    markup: chrome("南铂媒体智能体", `
      <div class="agent-plan"><div class="day active"><small>DAY 1</small><b>真实顾虑视频</b><span>脚本已完成</span></div><div class="day"><small>DAY 2</small><b>客片过程证据</b><span>待剪辑</span></div><div class="day"><small>DAY 3</small><b>268 透明套餐</b><span>待发布</span></div></div>
      <div class="agent-tasks"><span><i>✓</i>自然口播</span><span><i>✓</i>封面标题</span><span><i></i>发布交接</span></div>`, { kind: "agent", status: "今日执行" }),
  },
  expand: {
    label: "封面安全扩图对比",
    markup: chrome("封面安全扩图", `
      <div class="expand-stage"><div class="ratio source">${portrait}<span>2:3 原图</span></div><i class="expand-arrow">→</i><div class="ratio result">${portrait}<i class="safe-frame"></i><span>9:16 安全区</span></div></div>
      <div class="expand-note"><i>✓</i><b>人物保持原样</b><span>仅扩展背景 27%</span></div>`, { kind: "expand", status: "扩图完成" }),
  },
  meter: {
    label: "Codex 用量监控界面",
    markup: chrome("Codex 余量 Pro", `
      <div class="meter-gauge"><div><strong>72<small>%</small></strong><span>本周期可用</span></div></div>
      <div class="meter-list"><p><span>5 小时窗口</span><b>81%</b><i><em style="width:81%"></em></i></p><p><span>每周用量</span><b>72%</b><i><em style="width:72%"></em></i></p><p><span>模型状态</span><b class="online">正常</b></p></div>`, { kind: "meter", status: "刚刚刷新" }),
  },
  risk: {
    label: "投注情景与仓位风险表",
    markup: chrome("投注对冲风险智能体", `
      <div class="risk-summary"><span><small>总仓位</small><b>¥1,280</b></span><span><small>最差情景</small><b>−¥180</b></span><em>保守模式</em></div>
      <div class="risk-table"><div><b>情景</b><b>概率</b><b>结果</b></div><div><span>主队领先</span><span>42%</span><strong>+¥260</strong></div><div><span>平局</span><span>31%</span><strong>+¥80</strong></div><div><span>客队领先</span><span>27%</span><strong class="loss">−¥180</strong></div></div>`, { kind: "risk", status: "规则已锁定" }),
  },
  reviews: {
    label: "真实好评生成界面",
    markup: chrome("南铂真实好评助手", `
      <div class="review-side"><span class="selected">拍摄引导</span><span>服务过程</span><span>选片体验</span></div>
      <div class="review-compose"><div class="stars">★★★★★ <small>真实经历</small></div><p>本来很担心不会摆姿势，摄影师会一步步引导，整个过程比想象中轻松。</p><div class="review-actions"><span>自然版</span><span>简短版</span><b>复制评价</b></div></div>`, { kind: "reviews", status: "已生成 3 版" }),
  },
  portfolio: {
    label: "客户真实客片选片界面",
    markup: chrome("南铂真实客片", `
      <div class="portfolio-grid"><div>${portrait}<i>已选</i></div><div>${portrait}</div><div>${portrait}</div><div>${portrait}</div></div>
      <div class="portfolio-panel"><strong>我喜欢的风格</strong><b>06</b><span>黑色质感 · 光影肖像</span><em class="mini-action">整理拍摄偏好</em></div>`, { kind: "portfolio", status: "158 张客片" }),
  },
  insights: {
    label: "成交洞察数据面板",
    markup: chrome("南铂成交洞察", `
      <div class="insight-stats"><span><small>有效访问</small><b>128</b><em>+18%</em></span><span><small>收藏作品</small><b>46</b><em>+9%</em></span><span><small>接近咨询</small><b>12</b><em>高意向</em></span></div>
      <div class="insight-chart"><div class="chart-label"><b>近 7 天成交信号</b><span>访问 → 收藏 → 咨询</span></div><svg viewBox="0 0 220 52" preserveAspectRatio="none" aria-hidden="true"><path d="M2 44 C32 42,40 25,68 30 S110 42,132 20 S178 30,218 7"></path><path class="fill" d="M2 44 C32 42,40 25,68 30 S110 42,132 20 S178 30,218 7 L218 52 L2 52 Z"></path></svg></div>`, { kind: "insights", status: "今日已更新" }),
  },
  recreate: {
    label: "写真参考图与本人图复刻界面",
    markup: chrome("南铂写真复刻台", `
      <div class="recreate-inputs"><div>${portrait}<span>参考效果</span></div><i>＋</i><div>${beforePortrait}<span>本人写真</span></div></div>
      <div class="recreate-output"><strong>保真人物复刻方案</strong><span><i></i>硬光侧上方 45°</span><span><i></i>冷黑低饱和色调</span><b>生成复刻指令 →</b></div>`, { kind: "recreate", status: "分析完成" }),
  },
  sorter: {
    label: "照片视频自动分类界面",
    markup: chrome("照片视频一键分类", `
      <div class="sorter-source"><span class="folder">拍摄素材</span><small>共 286 个文件</small><div><i>▧</i><b>DSC_1284.ARW</b><em>42 MB</em></div><div><i>▶</i><b>VID_0831.MOV</b><em>1.2 GB</em></div></div>
      <div class="sorter-arrow">→</div><div class="sorter-folders"><span><i></i><b>RAW 照片</b><em>218</em></span><span><i></i><b>4K 视频</b><em>34</em></span><span><i></i><b>其他文件</b><em>34</em></span><small>正在分类 72%</small></div>`, { kind: "sorter", status: "自动整理中" }),
  },
  erp: {
    label: "摄影 ERP 客户订单界面",
    markup: chrome("南铂摄影 ERP", `
      <div class="erp-nav"><b>NBO ERP</b><span class="active">客户</span><span>订单</span><span>拍摄流程</span><span>财务</span></div>
      <div class="erp-main"><div class="erp-title"><span><small>客户历史</small><b>陈先生 · 3 笔订单</b></span><em>累计消费 ¥4,280</em></div><div class="erp-table"><p><b>订单</b><b>状态</b><b>实收</b></p><p><span>男士写真</span><i>已交付</i><strong>¥2,680</strong></p><p><span>形象照</span><i>待选片</i><strong>¥1,600</strong></p></div></div>`, { kind: "erp", status: "内部账号在线" }),
  },
  select: {
    label: "店内全屏选片界面",
    markup: chrome("NANBO SELECT", `
      <div class="select-stage">${portrait}<span class="select-count">12 / 186</span><i class="select-heart">✓ 已保留</i><em class="prev">‹</em><em class="next">›</em></div>
      <div class="select-strip"><span>${portrait}</span><span class="active">${portrait}</span><span>${portrait}</span><span>${portrait}</span><b>已选 38 张</b></div>`, { kind: "select", status: "本地高清" }),
  },
  music: {
    label: "私人音乐库播放界面",
    markup: chrome("NBO 音乐中枢", `
      <div class="music-side"><b>音乐库</b><span class="active">最近播放</span><span>专辑</span><span>歌单</span><small>本地 2,416 首</small></div>
      <div class="now-playing"><div class="album-art"><i>♫</i></div><span><small>正在播放</small><b>Night Portrait</b><em>NANBO Studio Mix</em></span><div class="player"><i></i><b>❚❚</b><i></i></div><div class="music-progress"><i></i></div></div>`, { kind: "music", status: "本机播放" }),
  },
  radar: {
    label: "音源项目安全扫描界面",
    markup: chrome("NBO 音源雷达", `
      <div class="radar-score"><div><i></i><strong>8</strong></div><span>今日候选项目</span><small>只读扫描 · 不执行代码</small></div>
      <div class="repo-list"><p><i></i><b>music-provider-a</b><span>活跃 92</span><em>MIT</em></p><p><i></i><b>audio-source-kit</b><span>活跃 84</span><em>Apache</em></p><p><i></i><b>stream-helper</b><span>待复核</span><em>未知</em></p></div>`, { kind: "radar", status: "扫描完成" }),
  },
  xhs: {
    label: "自媒体封面统一制作界面",
    markup: chrome("自媒体封面制作", `
      <div class="xhs-editor"><div class="xhs-cover">${portrait}<div class="xhs-before">${beforePortrait}<span>拍摄前</span></div><strong>普通男生<br><b>这样拍更上镜</b></strong><small>南铂摄影 · 真实客片</small></div></div>
      <div class="xhs-settings"><b>三平台封面</b><span><i>3:4</i>小红书</span><span><i>9:16</i>抖音</span><span><i>3:4</i>视频号</span><em>高清封面已就绪</em></div>`, { kind: "xhs", status: "可导出" }),
  },
};

export function getProjectInterface(visual) {
  const projectInterface = interfaces[visual];
  if (!projectInterface) throw new Error(`缺少项目界面：${visual}`);
  return projectInterface;
}

export function renderProjectInterface(visual) {
  return getProjectInterface(visual).markup;
}
