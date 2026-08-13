"use client";

import { useMemo, useState } from "react";

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
  visual: "network" | "studio" | "server" | "workflow" | "odds" | "video" | "crm" | "agent" | "expand" | "meter" | "risk" | "reviews" | "portfolio" | "insights";
  preview?: string;
  featured?: boolean;
  href: string;
  linkLabel: string;
};

const projects: Project[] = [
  {
    id: "stash",
    index: "01",
    name: "南铂 Stash 长期运行中心",
    eyebrow: "NETWORK OPERATIONS",
    category: "App",
    status: "云端运行",
    summary: "点击直接进入云端运行中心，长期查看配置、设备与灾备状态。",
    detail: "主备节点池、设备权限、配置版本、本机端口与云端网关统一检查。日常不需要翻配置文件，异常时可一键复制脱敏诊断。",
    tags: ["跨设备", "Stash", "自动检查"],
    tone: "mint",
    visual: "network",
    preview: "/stash-dashboard-preview.jpg",
    featured: true,
    href: "https://stash-status.nanbostudio.com/",
    linkLabel: "打开网络中心",
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
    linkLabel: "打开灵感封面",
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
    href: "https://wdmm630202.github.io/nbo-smart-system/projects/server/",
    linkLabel: "打开项目主页",
  },
  {
    id: "jewelry",
    index: "04",
    name: "NBO OS 珠宝修图工作流",
    eyebrow: "PHOTO PRODUCTION OS",
    category: "自动化",
    status: "生产中",
    summary: "从拍摄素材到 Photoshop 精修的标准化交付流程。",
    detail: "用统一任务目录、安全导入、修图步骤与交付规范，让不同设备和制作环节保持一致。旧版已明确归档，避免误用。",
    tags: ["Photoshop", "珠宝摄影", "SOP"],
    tone: "lilac",
    visual: "workflow",
    href: "https://wdmm630202.github.io/nbo-smart-system/projects/jewelry/",
    linkLabel: "打开项目主页",
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
    href: "https://wdmm630202.github.io/nbo-smart-system/projects/odds/",
    linkLabel: "打开项目主页",
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
    href: "https://wdmm630202.github.io/nbo-smart-system/projects/video/",
    linkLabel: "打开项目主页",
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
    href: "https://wdmm630202.github.io/nbo-smart-system/projects/crm/",
    linkLabel: "打开项目主页",
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
    href: "https://wdmm630202.github.io/nbo-smart-system/projects/media-agent/",
    linkLabel: "打开项目主页",
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
    href: "https://wdmm630202.github.io/nbo-smart-system/projects/expand-agent/",
    linkLabel: "打开项目主页",
  },
  {
    id: "meter",
    index: "10",
    name: "Codex 余量 Pro",
    eyebrow: "USAGE MONITOR",
    category: "App",
    status: "主页在线",
    summary: "随时查看 Codex 用量与可用状态的轻量工具。",
    detail: "把频繁查看的余量信息从复杂页面中抽出，逐步迁移为独立网页持续使用。",
    tags: ["网页", "Codex", "用量"],
    tone: "graphite",
    visual: "meter",
    href: "https://wdmm630202.github.io/nbo-smart-system/projects/meter/",
    linkLabel: "打开项目主页",
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
    href: "https://wdmm630202.github.io/nbo-smart-system/projects/risk-agent/",
    linkLabel: "打开项目主页",
  },
  {
    id: "reviews",
    index: "12",
    name: "南铂真实好评助手",
    eyebrow: "REAL REVIEW ASSISTANT",
    category: "网页",
    status: "已上线",
    summary: "AI热门场景一键生成真实评价参考，并直达微信或企业微信。",
    detail: "确认客户真实经历后，一键生成三种自然表达、邀请话术与配图建议；语言库按高频顾虑持续升级，不复制顾客原文。",
    tags: ["AI热门", "微信直达", "真实评价"],
    tone: "orange",
    visual: "reviews",
    href: "https://wdmm630202.github.io/nbo-smart-system/projects/reviews/",
    linkLabel: "打开好评系统",
  },
  {
    id: "portfolio-v2",
    index: "13",
    name: "南铂客户选片中心",
    eyebrow: "CLIENT PORTFOLIO",
    category: "网页",
    status: "已上线",
    summary: "客户用手机或电脑浏览真实客片、筛选主题并整理拍摄偏好。",
    detail: "固定网址长期使用，当前收录 158 张真实客片和 23 个主题；优先保证首屏速度、触摸交互和跨设备访问体验。",
    tags: ["真实客片", "选风格", "跨设备"],
    tone: "silver",
    visual: "portfolio",
    href: "https://wdmm630202.github.io/nbo-smart-system/p/",
    linkLabel: "打开客户选片中心",
  },
  {
    id: "portfolio-insights",
    index: "14",
    name: "南铂成交洞察后台",
    eyebrow: "CONVERSION INSIGHTS",
    category: "网页",
    status: "内部使用",
    summary: "查看匿名浏览时长、热门作品、主题偏好与接近咨询的成交信号。",
    detail: "把访问、有效停留、作品打开、收藏和复制拍摄需求整理成可执行建议；数据仅用于优化客片顺序、渠道和咨询流程。",
    tags: ["匿名统计", "成交信号", "速度体验"],
    tone: "forest",
    visual: "insights",
    href: "https://wdmm630202.github.io/nbo-smart-system/i/",
    linkLabel: "打开成交洞察后台",
  },
];

const filters = ["全部", "App", "网页", "智能体", "自动化"] as const;

function ProjectVisual({ project }: { project: Project }) {
  const marks: Record<Project["visual"], string> = {
    network: "N",
    studio: "15",
    server: "99",
    workflow: "◇",
    odds: "2:1",
    video: "▶",
    crm: "透明",
    agent: "AI",
    expand: "9:16",
    meter: "72%",
    risk: "−18",
    reviews: "★★★★★",
    portfolio: "158",
    insights: "↑",
  };

  if (project.preview) {
    return (
      <div className={`project-visual has-preview visual-${project.visual}`} aria-hidden="true">
        <img className="project-preview" src={project.preview} alt="" loading="eager" />
        <em className="preview-badge">点击进入云端</em>
      </div>
    );
  }

  return (
    <div className={`project-visual visual-${project.visual}`} aria-hidden="true">
      <span>{marks[project.visual]}</span>
      <small>{project.category}</small>
    </div>
  );
}

function ProjectCard({ project }: { project: Project }) {
  return (
    <a
      className={`project-card tone-${project.tone} ${project.featured ? "featured" : ""}`}
      href={project.href}
      target="_blank"
      rel="noreferrer"
      aria-label={`${project.linkLabel}：${project.name}`}
    >
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
      <span className="open-project">立即打开 <b>↗</b></span>
    </a>
  );
}

export default function Home() {
  const [activeFilter, setActiveFilter] = useState<(typeof filters)[number]>("全部");

  const visibleProjects = useMemo(
    () => activeFilter === "全部" ? projects : projects.filter((project) => project.category === activeFilter),
    [activeFilter],
  );

  return (
    <main>
      <nav className="top-nav" aria-label="系统导航">
        <a className="brand" href="#top" aria-label="返回顶部"><span>N</span><b>NBO南铂智能系统</b></a>
        <a className="sync-link" href="https://github.com/wdmm630202/nbo-smart-system" target="_blank" rel="noreferrer"><i />GitHub 已同步</a>
      </nav>

      <section className="work-section" id="top">
        <header className="results-header">
          <div><p>NBO SYSTEM INDEX · 2026</p><h1>NBO南铂智能系统</h1><span>打开即看结果 · 电脑、手机均可使用</span></div>
          <div className="result-count"><strong>{visibleProjects.length}</strong><span>当前结果</span></div>
        </header>
        <div className="filter-bar" role="group" aria-label="按作品类型筛选">
          {filters.map((filter) => <button key={filter} type="button" className={activeFilter === filter ? "active" : ""} onClick={() => setActiveFilter(filter)}><span>{filter}</span><small>{filter === "全部" ? projects.length : projects.filter((project) => project.category === filter).length}</small></button>)}
        </div>
        <div className="project-grid" aria-live="polite">
          {visibleProjects.map((project) => <ProjectCard key={project.id} project={project} />)}
        </div>
      </section>
    </main>
  );
}
