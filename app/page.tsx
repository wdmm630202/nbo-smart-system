"use client";

import { useEffect, useMemo, useState } from "react";

type Project = {
  id: string;
  index: string;
  name: string;
  eyebrow: string;
  category: "App" | "网页" | "智能体" | "自动化";
  status: string;
  summary: string;
  detail: string;
  tags: string[];
  tone: string;
  visual: "network" | "studio" | "server" | "workflow" | "odds" | "video" | "crm" | "agent" | "expand" | "meter" | "risk" | "reviews";
  featured?: boolean;
  href?: string;
  linkLabel?: string;
};

const projects: Project[] = [
  {
    id: "stash",
    index: "01",
    name: "南铂 Stash 长期运行中心",
    eyebrow: "NETWORK OPERATIONS",
    category: "App",
    status: "运行中",
    summary: "把机场、配置、设备授权与灾备收进一个可视化中心。",
    detail: "主备节点池、设备权限、配置版本、本机端口与云端网关统一检查。日常不需要翻配置文件，异常时可一键复制脱敏诊断。",
    tags: ["macOS", "Stash", "自动检查"],
    tone: "mint",
    visual: "network",
    featured: true,
    linkLabel: "本机运行",
  },
  {
    id: "cover",
    index: "02",
    name: "NBO 灵感封面",
    eyebrow: "CREATIVE AI WEB APP",
    category: "网页",
    status: "已上线",
    summary: "上传照片，一次生成封面文案与三端发布内容。",
    detail: "Gemini 多模态识图，同步生成小红书、抖音、视频号的独立标题、描述和话题。具备中文错误提示、自动重试和移动端封面导出。",
    tags: ["Gemini", "小红书", "抖音"],
    tone: "peach",
    visual: "studio",
    featured: true,
    href: "https://wdmm630202.github.io/nbo-cover-copy/",
    linkLabel: "打开网页",
  },
  {
    id: "server",
    index: "03",
    name: "NBO 服务器管家",
    eyebrow: "SERVER GUARDIAN",
    category: "App",
    status: "24/7 守护",
    summary: "一个给非技术人使用的本地服务器健康与备份面板。",
    detail: "检查电源、硬盘、网络、Docker、Immich 与 Tunnel，并定时备份数据库和照片副本。包含宽带迁移检测与更换硬盘向导。",
    tags: ["Immich", "Docker", "自动备份"],
    tone: "sky",
    visual: "server",
    linkLabel: "本机运行",
  },
  {
    id: "jewelry",
    index: "04",
    name: "NBO OS 珠宝修图工作流",
    eyebrow: "PHOTO PRODUCTION OS",
    category: "自动化",
    status: "生产中",
    summary: "从拍摄素材到 Photoshop 精修的标准化交付流程。",
    detail: "用统一任务目录、安全导入、修图步骤与交付规范，让公司 Mac 和制作环节保持一致。旧版已明确归档，避免误用。",
    tags: ["Photoshop", "珠宝摄影", "SOP"],
    tone: "lilac",
    visual: "workflow",
    linkLabel: "本机运行",
  },
  {
    id: "odds",
    index: "05",
    name: "南铂足球赔率工作台",
    eyebrow: "MATCH RISK WORKBENCH",
    category: "网页",
    status: "日常更新",
    summary: "单文件运行的赔率、补单、比分与特殊玩法管理工具。",
    detail: "集成正确比分、大小球、亚盘、双方进球和晋级等市场。保留浏览器本地数据，同时区分模拟重建与真实原始记录。",
    tags: ["Odds", "风险管理", "单文件"],
    tone: "butter",
    visual: "odds",
    linkLabel: "本机网页",
  },
  {
    id: "video",
    index: "06",
    name: "南铂图文卡点视频系统",
    eyebrow: "SOCIAL VIDEO PIPELINE",
    category: "自动化",
    status: "持续制作",
    summary: "把原片、封面、卡点和高清发布变成可重复的视频生产线。",
    detail: "针对 9:16 抖音成片，完成素材整理、节奏切片、首帧封面、安全区与 BT.709 高清输出，也提供公司端便携使用包。",
    tags: ["9:16", "卡点", "高清发布"],
    tone: "rose",
    visual: "video",
    linkLabel: "本地工作流",
  },
  {
    id: "crm",
    index: "07",
    name: "南铂企业微信客户资产",
    eyebrow: "CUSTOMER ASSET SYSTEM",
    category: "自动化",
    status: "持续完善",
    summary: "欢迎语、套餐知识、客户回复和品牌资产的统一中心。",
    detail: "以朋友式沟通、透明价格和无强制消费为基础，管理欢迎语、快捷回复、套餐说明与品牌标志文件。",
    tags: ["企业微信", "客户资产", "透明价格"],
    tone: "aqua",
    visual: "crm",
    linkLabel: "内部系统",
  },
  {
    id: "media-agent",
    index: "08",
    name: "南铂媒体智能体",
    eyebrow: "CONTENT AGENT",
    category: "智能体",
    status: "可调用",
    summary: "围绕男士写真，安排三天运营、视频包装和发布交接。",
    detail: "从低价团购引流、拍摄清单、视频剪辑方案到抖音与小红书文案，输出一套小团队真正可执行的周期。",
    tags: ["男士写真", "3 天运营", "发布交接"],
    tone: "coral",
    visual: "agent",
    linkLabel: "Codex 智能体",
  },
  {
    id: "expand-agent",
    index: "09",
    name: "封面安全扩图智能体",
    eyebrow: "VISUAL SAFETY AGENT",
    category: "智能体",
    status: "可调用",
    summary: "在不损伤原始精修人物的前提下，完成 9:16 封面扩展。",
    detail: "同时检查 2:3 原图、9:16 发布和主页 3:4 安全区。先决定移动人物还是扩展背景，必要时才使用 AI 补景。",
    tags: ["9:16", "安全区", "AI 扩图"],
    tone: "violet",
    visual: "expand",
    linkLabel: "Codex 智能体",
  },
  {
    id: "meter",
    index: "10",
    name: "Codex 余量 Pro",
    eyebrow: "USAGE MONITOR",
    category: "App",
    status: "本机可用",
    summary: "随时查看 Codex 用量与可用状态的轻量 Mac 工具。",
    detail: "把频繁查看的余量信息从复杂页面中抽出，作为本机独立应用使用。",
    tags: ["macOS", "Codex", "用量"],
    tone: "graphite",
    visual: "meter",
    linkLabel: "本机运行",
  },
  {
    id: "risk-agent",
    index: "11",
    name: "投注对冲风险智能体",
    eyebrow: "RISK CONTROL AGENT",
    category: "智能体",
    status: "可调用",
    summary: "用情景表、触发赔率和仓位规则做保守风险管理。",
    detail: "为已接受或计划接受的赛果暴露生成目标利润表、补仓规则和正确比分覆盖，不做“保证获利”承诺。",
    tags: ["情景规划", "仓位", "风险控制"],
    tone: "lime",
    visual: "risk",
    linkLabel: "Codex 智能体",
  },
  {
    id: "reviews",
    index: "12",
    name: "抖音团购运营助手",
    eyebrow: "LOCAL COMMERCE AGENT",
    category: "智能体",
    status: "迭代中",
    summary: "围绕团购套餐、评价回复和客服知识的运营工具。",
    detail: "把套餐信息、预约流程、拍摄张数、地址和客服用语统一起来，重点保留明码实价与无强制消费。",
    tags: ["抖音来客", "客服", "团购"],
    tone: "orange",
    visual: "reviews",
    linkLabel: "内部工具",
  },
];

const filters = ["全部", "App", "网页", "智能体", "自动化"] as const;

function ProjectVisual({ project }: { project: Project }) {
  return (
    <div className={`project-visual visual-${project.visual}`} aria-hidden="true">
      <div className="visual-glow" />
      {project.visual === "network" && (
        <div className="network-ui">
          <div className="status-orbit"><span>N</span></div>
          <div className="network-lines"><i /><i /><i /></div>
          <div className="network-pill"><b /> 12 项检查正常</div>
        </div>
      )}
      {project.visual === "studio" && (
        <div className="studio-ui">
          <div className="photo-frame"><span>15</span><small>字封面</small></div>
          <div className="copy-lines"><i /><i /><i /></div>
          <div className="platform-pills"><span>小红书</span><span>抖音</span><span>视频号</span></div>
        </div>
      )}
      {project.visual === "server" && (
        <div className="server-ui"><div className="server-ring">99<small>%</small></div><div className="server-stack"><i /><i /><i /><i /></div></div>
      )}
      {project.visual === "workflow" && (
        <div className="workflow-ui"><div className="gem">◇</div><div className="flow-nodes"><span>RAW</span><b /><span>PS</span><b /><span>OUT</span></div></div>
      )}
      {project.visual === "odds" && (
        <div className="odds-ui"><div className="score"><span>2</span><i>:</i><span>1</span></div><div className="odds-bars"><i /><i /><i /></div></div>
      )}
      {project.visual === "video" && (
        <div className="video-ui"><div className="video-phone"><span>▶</span></div><div className="timeline"><i /><i /><i /><i /><i /></div></div>
      )}
      {project.visual === "crm" && (
        <div className="crm-ui"><div className="chat-bubble">价格透明<br/><small>无强制消费</small></div><div className="contact-dots"><i/><i/><i/></div></div>
      )}
      {project.visual === "agent" && (
        <div className="agent-ui"><div className="agent-orb"><i/><i/><span>AI</span></div><div className="agent-route"><span>拍</span><b/><span>剪</span><b/><span>发</span></div></div>
      )}
      {project.visual === "expand" && (
        <div className="expand-ui"><div className="safe-frame"><i/><span>9:16</span></div><div className="expand-corners"><i/><i/><i/><i/></div></div>
      )}
      {project.visual === "meter" && (
        <div className="meter-ui"><div className="meter-ring"><span>72</span><small>%</small></div><div className="meter-caption">CODEX READY</div></div>
      )}
      {project.visual === "risk" && (
        <div className="risk-ui"><div className="risk-curve"><i/><i/><i/><i/></div><div className="risk-label"><span>保守</span><b>− 18%</b></div></div>
      )}
      {project.visual === "reviews" && (
        <div className="reviews-ui"><div className="star-row">★ ★ ★ ★ ★</div><div className="review-card"><i/><span>客户回复已生成</span></div></div>
      )}
    </div>
  );
}

function ProjectCard({ project, onOpen }: { project: Project; onOpen: () => void }) {
  const handlePointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;
    event.currentTarget.style.setProperty("--pointer-x", `${x}%`);
    event.currentTarget.style.setProperty("--pointer-y", `${y}%`);
    event.currentTarget.style.setProperty("--tilt-x", `${(50 - y) / 35}deg`);
    event.currentTarget.style.setProperty("--tilt-y", `${(x - 50) / 35}deg`);
  };

  return (
    <button
      className={`project-card tone-${project.tone} ${project.featured ? "featured" : ""}`}
      type="button"
      onClick={onOpen}
      onPointerMove={handlePointerMove}
      onPointerLeave={(event) => {
        event.currentTarget.style.setProperty("--tilt-x", "0deg");
        event.currentTarget.style.setProperty("--tilt-y", "0deg");
      }}
      aria-label={`查看 ${project.name}`}
    >
      <span className="card-light" />
      <div className="project-card-top">
        <span className="project-index">{project.index}</span>
        <span className="project-status"><i />{project.status}</span>
      </div>
      <ProjectVisual project={project} />
      <div className="project-copy">
        <span className="project-eyebrow">{project.eyebrow}</span>
        <h3>{project.name}</h3>
        <p>{project.summary}</p>
        <div className="tag-row">{project.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
      </div>
      <span className="open-project">查看详情 <b>↗</b></span>
    </button>
  );
}

export default function Home() {
  const [activeFilter, setActiveFilter] = useState<(typeof filters)[number]>("全部");
  const [selected, setSelected] = useState<Project | null>(null);

  const visibleProjects = useMemo(
    () => activeFilter === "全部" ? projects : projects.filter((project) => project.category === activeFilter),
    [activeFilter],
  );

  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === "Escape" && setSelected(null);
    document.addEventListener("keydown", close);
    document.body.classList.toggle("modal-open", Boolean(selected));
    return () => {
      document.removeEventListener("keydown", close);
      document.body.classList.remove("modal-open");
    };
  }, [selected]);

  return (
    <main>
      <nav className="top-nav" aria-label="主导航">
        <a className="brand" href="#top" aria-label="返回顶部"><span>N</span><b>NANBO / LAB</b></a>
        <div className="nav-links"><a href="#work">作品</a><a href="#principles">原则</a><a href="#about">关于</a></div>
        <a className="nav-cta" href="#work">查看全部 <span>↓</span></a>
      </nav>

      <section className="hero" id="top">
        <div className="hero-noise" />
        <div className="hero-orb orb-one" />
        <div className="hero-orb orb-two" />
        <div className="hero-content">
          <p className="kicker"><span /> INDEPENDENT DIGITAL SYSTEMS · 2026</p>
          <h1>把每一次<br />解决问题，<br /><em>变成一个系统。</em></h1>
          <p className="hero-lead">这里收集了我为南铂摄影和日常工作开发的 App、网页、自动化与智能体。<br />它们不是演示，而是正在使用的工具。</p>
          <div className="hero-actions"><a className="primary-button" href="#work"><span>浏览作品</span><b>↘</b></a><button type="button" className="play-button" onClick={() => setSelected(projects[0])}><i>▶</i><span>查看代表作</span></button></div>
        </div>
        <div className="hero-stage" aria-label="作品系统概览">
          <div className="glass-window">
            <div className="window-top"><span className="traffic"><i/><i/><i/></span><b>NBO SYSTEMS</b><span className="live-dot">LIVE</span></div>
            <div className="window-body">
              <div className="system-rail"><span className="active">N</span><span>S</span><span>AI</span><span>◇</span></div>
              <div className="system-screen">
                <div className="screen-heading"><div><small>TODAY&apos;S SYSTEM</small><strong>南铂数字工作系统</strong></div><span>12 / 12</span></div>
                <div className="screen-feature"><div className="mini-orbit"><span>N</span></div><div><small>OPERATING NORMALLY</small><strong>工具已连接</strong><p>网络、创作、交付与运营</p></div></div>
                <div className="screen-grid"><div><i className="green"/><span>网络中心</span><b>ONLINE</b></div><div><i className="orange"/><span>灵感封面</span><b>AI READY</b></div><div><i className="purple"/><span>智能体</span><b>4 ACTIVE</b></div><div><i className="blue"/><span>服务器</span><b>24 / 7</b></div></div>
              </div>
            </div>
          </div>
          <div className="floating-chip chip-one"><i />即时响应</div>
          <div className="floating-chip chip-two"><span>↗</span>可打断动效</div>
        </div>
        <div className="hero-meta"><div><strong>12</strong><span>个已整理作品</span></div><div><strong>4</strong><span>类数字系统</span></div><div><strong>1</strong><span>个持续进化的体系</span></div></div>
      </section>

      <section className="work-section" id="work">
        <div className="section-heading"><div><p className="section-number">01 / SELECTED WORK</p><h2>不只是作品展示，<br /><em>而是实际问题的答案。</em></h2></div><p>从一个本机 App，到可以反复执行的智能体。点击任意作品查看它解决了什么。</p></div>
        <div className="filter-bar" role="group" aria-label="按作品类型筛选">
          {filters.map((filter) => <button key={filter} type="button" className={activeFilter === filter ? "active" : ""} onClick={() => setActiveFilter(filter)}><span>{filter}</span><small>{filter === "全部" ? projects.length : projects.filter((project) => project.category === filter).length}</small></button>)}
        </div>
        <div className="project-grid" aria-live="polite">
          {visibleProjects.map((project) => <ProjectCard key={project.id} project={project} onOpen={() => setSelected(project)} />)}
        </div>
      </section>

      <section className="principles" id="principles">
        <div className="principle-intro"><p className="section-number">02 / HOW IT FEELS</p><h2>好设计不是装饰。<br /><em>它是“我知道下一步会发生什么”。</em></h2></div>
        <div className="principle-grid">
          <article><span>01</span><div className="principle-demo press-demo"><button type="button">PRESS ME</button></div><h3>立即反馈</h3><p>按下的瞬间就响应，而不是等任务结束才告诉你。</p></article>
          <article><span>02</span><div className="principle-demo spring-demo"><i/><i/><i/></div><h3>有物理感的动效</h3><p>轻微过冲、回弹和阻尼，让界面像可以被触摸。</p></article>
          <article><span>03</span><div className="principle-demo glass-demo"><i/><div>DEPTH</div></div><h3>透明但不模糊</h3><p>玻璃材质用于表达层级，而不是给所有东西加特效。</p></article>
          <article><span>04</span><div className="principle-demo path-demo"><i/><b/><i/><b/><i/></div><h3>路径要自然</h3><p>人能看懂自己从哪里来、正在哪里、如何返回。</p></article>
        </div>
      </section>

      <section className="about-section" id="about">
        <div className="about-mark">N</div>
        <div className="about-copy"><p className="section-number">03 / ABOUT THE SYSTEM</p><h2>一边经营摄影，<br />一边把重复工作做成工具。</h2><p>这些系统的起点都很具体：网络总是难管、封面每次重做、客户回复容易不一致、视频交付经常出错。它们现在被收进同一个长期使用的数字体系。</p><div className="about-tags"><span>DESIGN</span><span>OPERATIONS</span><span>AI AGENTS</span><span>PHOTOGRAPHY</span></div></div>
      </section>

      <footer><div className="footer-top"><div><span className="footer-label">NANBO / DIGITAL SYSTEMS</span><h2>让工具越来越少，<br /><em>让系统越来越完整。</em></h2></div><a href="#top" className="back-top">↑<span>回到顶部</span></a></div><div className="footer-bottom"><span>© 2026 NANBO STUDIO</span><span>DESIGNED IN GUANGZHOU</span><span>BUILT WITH INTENTION</span></div></footer>

      {selected && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setSelected(null)}>
          <section className={`project-modal tone-${selected.tone}`} role="dialog" aria-modal="true" aria-labelledby="modal-title">
            <button className="modal-close" type="button" onClick={() => setSelected(null)} aria-label="关闭详情">×</button>
            <div className="modal-visual"><ProjectVisual project={selected} /></div>
            <div className="modal-copy"><div className="modal-meta"><span>{selected.index} / {selected.category}</span><span className="project-status"><i />{selected.status}</span></div><p className="project-eyebrow">{selected.eyebrow}</p><h2 id="modal-title">{selected.name}</h2><p className="modal-summary">{selected.detail}</p><div className="tag-row">{selected.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>{selected.href ? <a className="modal-action" href={selected.href} target="_blank" rel="noreferrer"><span>{selected.linkLabel}</span><b>↗</b></a> : <div className="modal-action local"><span>{selected.linkLabel}</span><b>·</b></div>}</div>
          </section>
        </div>
      )}
    </main>
  );
}
