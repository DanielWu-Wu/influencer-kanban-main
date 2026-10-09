'use client';

import { useState } from 'react';
import { Check, ExternalLink, Play, X, RotateCcw } from 'lucide-react';
import './layout.css';

type Status = '待确认' | '已确认' | '已排除';
const samples = [
  { title: 'Модельний ряд зарядних станцій AFERIY ⚡ #україна', name: 'Lotos Reviews', product: 'P280', date: '2026/9/10', terms: 'AFERIY · P280', tone: '#516c61' },
  { title: 'Aferiy P210 vs P280 — чи варто переплачувати?', name: 'Lotos Reviews', product: 'P280', date: '2026/9/9', terms: 'AFERIY · P210 · P280', tone: '#64748b' },
  { title: 'Energía para viajar: probamos la AFERIY P210', name: 'The Camper Van', product: 'P210', date: '2026/9/8', terms: 'AFERIY · P210', tone: '#937a59' },
  { title: 'Nomad 1800 Pro: una semana fuera de la red', name: 'Xplore Van Life', product: 'Nomad1800 Pro', date: '2026/9/6', terms: 'AFERIY · Nomad1800 Pro', tone: '#566a83' },
];
function videoUrl(title: string) { return 'https://www.youtube.com/results?search_query=' + encodeURIComponent(title); }

function Cover({ index, small = false }: { index: number; small?: boolean }) {
  const item = samples[index];
  return <div className="relative aspect-video overflow-hidden rounded-lg bg-slate-700">
    <svg viewBox="0 0 640 360" className="h-full w-full" role="img" aria-label={item.product + ' 视频封面示意'}>
      <rect width="640" height="360" fill={item.tone} />
      <path d="M0 280L130 110L230 210L390 70L640 260V360H0Z" fill="#ffffff" opacity=".12" />
      <rect y="282" width="640" height="78" fill="#162321" opacity=".45" />
      <rect x="346" y="133" width="189" height="168" rx="18" fill="#17232b" />
      <path d="M385 134V110Q385 95 401 95H480Q497 95 497 110V134" fill="none" stroke="#263741" strokeWidth="17" />
      <rect x="370" y="165" width="139" height="47" rx="7" fill="#345064" />
      <text x="387" y="196" fill="#b5eee4" fontSize="23" fontFamily="sans-serif">100%</text>
      <circle cx="394" cy="247" r="13" fill="#526571" /><circle cx="443" cy="247" r="13" fill="#526571" />
      <text x="35" y="77" fill="white" fontSize="34" fontWeight="700" fontFamily="sans-serif">AFERIY</text>
      <text x="35" y="126" fill="white" fontSize="28" fontFamily="sans-serif">{item.product}</text>
      <text x="35" y="320" fill="#fff" opacity=".7" fontSize="17" fontFamily="sans-serif">封面示意 · 布局演示</text>
    </svg>
    {!small && <div className="absolute inset-0 flex items-center justify-center"><span className="flex size-11 items-center justify-center rounded-full bg-black/45 text-white"><Play className="size-5 fill-white" /></span></div>}
    <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1 text-[10px] text-white">12:48</span>
  </div>;
}

export function MonitorDemo({ layout }: { layout: 'row' | 'cards' | 'gallery' }) {
  const [selected, setSelected] = useState(0);
  const [statuses, setStatuses] = useState<Status[]>(samples.map(() => '待确认'));
  const [filter, setFilter] = useState('全部');
  const [closed, setClosed] = useState(false);
  const item = samples[selected];
  function decide(status: Status) { setStatuses(previous => previous.map((value, index) => index === selected ? status : value)); }
  return <main data-layout={layout} className="vml-demo flex h-dvh flex-col bg-slate-100 p-4 pb-20 text-foreground md:p-8 md:pb-20">
    <div className="mb-5 flex items-center justify-between text-sm"><span className="font-semibold">红人推广 · 合作项目</span><span className="text-muted-foreground">封面布局演示 · 示例数据</span></div>
    {closed ? <div className="flex flex-1 items-center justify-center"><button className="rounded-lg bg-primary px-5 py-3 text-primary-foreground" onClick={() => setClosed(false)}>打开检测红人视频</button></div> :
    <section className="mx-auto flex min-h-0 w-full max-w-[1240px] flex-1 flex-col overflow-hidden rounded-xl border bg-white shadow-xl">
      <header className="flex items-start justify-between border-b px-6 py-5"><div><h1 className="text-lg font-semibold">检测红人视频</h1><p className="mt-1 text-xs text-muted-foreground">从合作日期起检查公开视频，查看依据后确认关联。</p></div><button aria-label="关闭演示弹窗" className="rounded p-1 hover:bg-slate-100" onClick={() => setClosed(true)}><X className="size-4" /></button></header>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-slate-50/70 px-6 py-3"><p className="text-xs text-muted-foreground"><span className="mr-3 font-medium text-foreground">检测已完成</span>4 条视频 · {statuses.filter(s => s === '待确认').length} 条待确认</p><button onClick={() => { setStatuses(samples.map(() => '待确认')); setFilter('全部'); }} className="inline-flex items-center gap-1 rounded-md border bg-white px-3 py-2 text-xs"><RotateCcw className="size-3" />重置演示</button></div>
      <div className="flex flex-wrap gap-2 border-b px-6 py-3">{['全部', '待确认', '已确认', '已排除'].map(label => <button key={label} onClick={() => setFilter(label)} className={'rounded-md border px-3 py-1.5 text-xs ' + (filter === label ? 'border-blue-200 bg-blue-50 text-blue-800' : 'bg-white')}>{label} {label === '全部' ? samples.length : statuses.filter(status => status === label).length}</button>)}</div>
      <div className={'grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[320px_1fr] ' + (true ? 'lg:grid-cols-[420px_1fr]' : '')}>
        <aside className="max-h-48 overflow-y-auto border-b md:max-h-none md:border-r md:border-b-0" aria-label="视频列表">{samples.map((video, index) => filter === '全部' || statuses[index] === filter ? <button key={video.title} onClick={() => setSelected(index)} className={'flex w-full gap-3 border-b p-4 text-left hover:bg-slate-50 ' + (selected === index ? 'bg-blue-50/70' : '')}>
          {true && <div className="vml-cover shrink-0"><Cover index={index} small /></div>}
          <div className="min-w-0 flex-1"><p className="line-clamp-2 text-sm font-medium leading-5">{video.title}</p><p className="mt-2 text-xs text-muted-foreground">{video.name} · {video.product}</p><div className="mt-2 flex justify-between text-[11px] text-muted-foreground"><span>{video.date}</span><span>{statuses[index]}</span></div></div>
        </button> : null)}{filter !== '全部' && !statuses.includes(filter as Status) && <p className="p-8 text-center text-sm text-muted-foreground">暂无此类结果</p>}</aside>
        <article className="min-h-0 overflow-y-auto p-5 md:p-6" aria-label="视频详情">
          {false ? <div className="mb-5"><a href={videoUrl(item.title)} target="_blank" rel="noopener noreferrer" className="block max-w-[560px]"><Cover index={selected} /></a><h2 className="mt-4 text-lg font-semibold"><a className="text-foreground hover:underline" href={videoUrl(item.title)} target="_blank" rel="noopener noreferrer">{item.title}</a></h2><p className="mt-2 text-xs text-muted-foreground">{item.name} · {item.date} 公开 · {statuses[selected]}</p></div> :
          <div className="mb-5 flex items-start gap-4">{false && <a href={videoUrl(item.title)} target="_blank" rel="noopener noreferrer" className="w-44 shrink-0"><Cover index={selected} /></a>}<div className="min-w-0"><span className="text-xs text-muted-foreground">视频详情 · {statuses[selected]}</span><h2 className="mt-2 text-base font-semibold leading-6"><a className="text-foreground hover:underline" href={videoUrl(item.title)} target="_blank" rel="noopener noreferrer">{item.title}</a></h2><p className="mt-2 text-xs text-muted-foreground">{item.name} · {item.date} 公开</p></div></div>}
          <div className="mb-5 grid grid-cols-2 gap-4 rounded-lg border bg-slate-50/60 p-4 text-sm"><div><p className="text-xs text-muted-foreground">合作红人</p><p className="mt-1">{item.name}</p></div><div><p className="text-xs text-muted-foreground">合作产品</p><p className="mt-1">{item.product}</p></div><div><p className="text-xs text-muted-foreground">预计发布时间</p><p className="mt-1">9月上旬 · 时间待核实</p></div><div><p className="text-xs text-muted-foreground">文字线索</p><p className="mt-1">{item.terms}</p></div></div>
          <div className="mb-4 rounded-lg border border-blue-100 bg-blue-50/60 p-4 text-sm leading-6"><p className="font-medium">AI 判断说明（示例）</p><p className="mt-2">视频提到了品牌和合作型号，具有相关性。仍需核实是否为本次合作交付，或属于历史产品对比；建议先查看简介中的合作链接。</p></div>
          <details open className="rounded-lg border p-4 text-sm"><summary className="cursor-pointer font-medium">匹配依据 · 2 条</summary><div className="mt-3 space-y-3 text-muted-foreground"><p><span className="font-medium text-foreground">标题</span> · {item.terms}</p><p><span className="font-medium text-foreground">字幕 · 03:24</span> · 本期展示 AFERIY {item.product} 的供电功能。</p></div></details>
          <div className="sticky bottom-[-24px] mt-5 flex flex-wrap items-center gap-2 border-t bg-white py-4"><button onClick={() => decide('已确认')} className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-2 text-xs text-primary-foreground"><Check className="size-3" />确认属于此合作</button><button onClick={() => decide('已排除')} className="rounded-md border px-3 py-2 text-xs">排除</button><button onClick={() => decide('待确认')} className="rounded-md border px-3 py-2 text-xs">改为待确认</button><a href={videoUrl(item.title)} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex items-center gap-1 text-xs text-foreground hover:underline">查找示例视频<ExternalLink className="size-3" /></a></div>
        </article>
      </div>
      <footer className="border-t px-6 py-2 text-[11px] text-muted-foreground">交互仅用于演示；封面为示意图，链接打开标题搜索。实际功能将使用视频真实封面与播放链接。</footer>
    </section>}
  </main>;
}
