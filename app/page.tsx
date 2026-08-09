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
  };

  return (
    <div className={`project-visual visual-${project.visual}`} aria-hidden="true">
      <span>{marks[project.visual]}</span>
      <small>{project.category}</small>
    </div>
  );
}

function ProjectCard({ project, onOpen }: { project: Project; onOpen: () => void }) {
  return (
    <button
      className={`project-card tone-${project.tone} ${project.featured ? "featured" : ""}`}
      type="button"
      onClick={onOpen}
      aria-label={`查看 ${project.name}`}
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
          {visibleProjects.map((project) => <ProjectCard key={project.id} project={project} onOpen={() => setSelected(project)} />)}
        </div>
      </section>

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
