'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  CircleAlert,
  CircleCheck,
  CircleX,
  Clock3,
  ChevronsUpDown,
  Eye,
  ExternalLink,
  Loader2,
  Mail,
  RefreshCw,
  Search,
  SkipForward,
  Sparkles,
  Youtube,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  COOPERATION_TYPES,
  countryLabel,
  formatCompactNumber,
  type Prospect,
  type ProspectPriority,
  WORKFLOW_META,
} from '@/lib/creator-prospecting';
import type { OutreachAiContext } from '@/lib/outreach-context';
import {
  OUTREACH_LANGUAGE_OPTIONS,
  outreachLanguageLabel,
} from '@/lib/outreach-languages';
import { cn } from '@/lib/utils';

type Props = {
  prospects: Prospect[];
  productOptions: string[];
  outreachPrompt: string;
  getOutreachContext: (prospect: Prospect) => OutreachAiContext;
  translatingVideoTitleIds: string[];
  inferringContactNameIds: string[];
  inferringOutreachLanguageIds: string[];
  checkingHistoryId: string | null;
  onPatch: (id: string, patch: Partial<Prospect>) => void;
  onSave: (prospect: Prospect) => void;
  onConfirmOutreach: (prospect: Prospect) => void;
  onBack: (prospect: Prospect) => void;
  onSkip: (prospect: Prospect) => void;
  onCheckHistory: (prospect: Prospect) => void;
  onInferContactName: (prospect: Prospect, force?: boolean) => Promise<void>;
  onInferOutreachLanguage: (prospect: Prospect, force?: boolean) => Promise<void>;
};

function yesNoUnknown(value?: boolean) {
  if (value === true) return '是';
  if (value === false) return '否';
  return '待确认';
}

function prospectLanguageLabel(prospect: Prospect) {
  if (prospect.outreachLanguageInferenceStatus === 'loading') return '正在识别语言';
  const language = prospect.outreachLanguage || prospect.language;
  return language ? outreachLanguageLabel(language) : '语言未知';
}

function formatVideoEngagementRate(video: NonNullable<Prospect['recentVideos']>[number]) {
  if (
    typeof video.viewCount !== 'number'
    || video.viewCount <= 0
    || typeof video.likeCount !== 'number'
    || typeof video.commentCount !== 'number'
  ) {
    return '-';
  }
  return `${(((video.likeCount + video.commentCount) / video.viewCount) * 100).toFixed(2)}%`;
}

function ConfidenceIcon({ confidence, label }: { confidence: number; label: string }) {
  const Icon = confidence >= 80 ? CircleCheck : confidence >= 60 ? CircleAlert : CircleX;
  const className = confidence >= 80
    ? 'text-emerald-600'
    : confidence >= 60
      ? 'text-amber-600'
      : 'text-red-600';
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={`inline-flex h-8 w-8 items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${className}`}
          aria-label={`${label} ${confidence}%`}
        >
          <Icon className="h-4 w-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6}>
        {label} {confidence}%
      </TooltipContent>
    </Tooltip>
  );
}

function LanguageCombobox({
  id,
  value,
  disabled,
  onValueChange,
}: {
  id: string;
  value?: string;
  disabled?: boolean;
  onValueChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="h-10 min-w-0 flex-1 justify-between bg-white px-3 font-normal"
        >
          <span className={value ? '' : 'text-muted-foreground'}>
            {value ? outreachLanguageLabel(value) : '请选择开发信语言'}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] p-0"
      >
        <Command>
          <CommandInput placeholder="输入中文语言名称搜索" />
          <CommandList>
            <CommandEmpty>没有匹配的语言</CommandEmpty>
            <CommandGroup>
              {OUTREACH_LANGUAGE_OPTIONS.map((option) => (
                <CommandItem
                  key={option.code}
                  value={`${option.label} ${option.code}`}
                  onSelect={() => {
                    onValueChange(option.code);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      'h-4 w-4',
                      value === option.code ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                  {option.label}
                  <span className="ml-auto text-xs text-muted-foreground">{option.code}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function OutreachContextPreview({ context }: { context: OutreachAiContext }) {
  const product = context.products[0];
  return (
    <div className="space-y-5 text-sm">
      <dl className="grid gap-3 sm:grid-cols-2">
        {[
          ['频道', context.channel.title || '未获取'],
          ['联系人姓名', context.channel.contactName || '未填写，将使用频道或团队称呼'],
          ['开发信语言', outreachLanguageLabel(context.preferredLanguage)],
          ['目标产品', context.targetProduct || '未选择'],
          ['合作形式', context.cooperationType || '未选择'],
          ['优先级', context.priority === 'high' ? '高' : context.priority === 'low' ? '低' : '中'],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
            <dd className="mt-1 font-medium">{value}</dd>
          </div>
        ))}
      </dl>

      <div>
        <p className="text-xs font-medium text-muted-foreground">频道简介</p>
        <p className="mt-1 whitespace-pre-wrap rounded-md bg-white p-3 leading-6">
          {context.channel.description || '暂无简介'}
        </p>
      </div>

      <div>
        <p className="text-xs font-medium text-muted-foreground">最近 8 条长视频</p>
        <ul className="mt-2 space-y-2">
          {context.channel.recentVideos.map((video, index) => (
            <li key={video.videoId || video.url || `${video.title}-${index}`} className="rounded-md bg-white p-3">
              <p className="font-medium">{index + 1}. {video.translatedTitle || video.title}</p>
              {video.translatedTitle && (
                <p className="mt-1 text-xs text-muted-foreground">原标题：{video.title}</p>
              )}
              <p className="mt-1 text-xs text-muted-foreground">
                播放 {formatCompactNumber(video.viewCount)}
                {' · '}赞 {formatCompactNumber(video.likeCount)}
                {' · '}评 {formatCompactNumber(video.commentCount)}
                {' · '}ER {formatVideoEngagementRate(video)}
              </p>
            </li>
          ))}
          {!context.channel.recentVideos.length && (
            <li className="rounded-md bg-white p-3 text-muted-foreground">暂无符合条件的长视频。</li>
          )}
        </ul>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <p className="text-xs font-medium text-muted-foreground">合作想法</p>
          <p className="mt-1 whitespace-pre-wrap rounded-md bg-white p-3 leading-6">
            {context.cooperationIdea || '未填写'}
          </p>
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground">本次开发备注</p>
          <p className="mt-1 whitespace-pre-wrap rounded-md bg-white p-3 leading-6">
            {context.userPreference || '无'}
          </p>
        </div>
      </div>

      <div>
        <p className="text-xs font-medium text-muted-foreground">选中产品资料</p>
        {product ? (
          <div className="mt-1 grid gap-3 rounded-md bg-white p-3 leading-6 sm:grid-cols-[160px_minmax(0,1fr)]">
            <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-md border bg-slate-50">
              {product.productImage.previewDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={product.productImage.previewDataUrl}
                  alt={`${product.name} 产品主图`}
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="px-3 text-center text-xs text-muted-foreground">暂无产品主图</span>
              )}
            </div>
            <div className="min-w-0 space-y-2">
              <p className="font-medium">{[product.model, product.name].filter(Boolean).join(' · ')}</p>
              {product.productUrl && (
                <a
                  href={product.productUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex max-w-full items-center gap-1 truncate text-xs text-primary hover:underline"
                >
                  <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                  {product.productUrl}
                </a>
              )}
              <div>
                <p className="text-xs font-medium text-muted-foreground">产品描述卖点</p>
                <p className="mt-1 whitespace-pre-wrap text-muted-foreground">
                  {product.sellingPoints || '产品数据库暂无卖点资料。智能助手只能收到产品名称，请先补充产品卖点。'}
                </p>
              </div>
              {product.technicalSpecifications && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground">技术参数</p>
                  <p className="mt-1 whitespace-pre-wrap text-muted-foreground">
                    {product.technicalSpecifications}
                  </p>
                </div>
              )}
              {product.imageAndResourceLinks && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground">图片/素材说明</p>
                  <p className="mt-1 whitespace-pre-wrap text-muted-foreground">
                    {product.imageAndResourceLinks}
                  </p>
                </div>
              )}
            </div>
          </div>
        ) : (
          <p className="mt-1 rounded-md bg-white p-3 text-muted-foreground">
            当前选项尚未关联产品数据库资料，智能助手只能收到产品名称。请先到设置里的产品数据库补充产品链接和卖点。
          </p>
        )}
      </div>
    </div>
  );
}

export function InvitationConfirmTab({
  prospects,
  productOptions,
  outreachPrompt,
  getOutreachContext,
  translatingVideoTitleIds,
  inferringContactNameIds,
  inferringOutreachLanguageIds,
  checkingHistoryId,
  onPatch,
  onSave,
  onConfirmOutreach,
  onBack,
  onSkip,
  onCheckHistory,
  onInferContactName,
  onInferOutreachLanguage,
}: Props) {
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string>('');
  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return prospects;
    return prospects.filter((item) => [
      item.title,
      item.country,
      item.language,
      item.publicEmail,
    ].some((value) => String(value || '').toLowerCase().includes(normalized)));
  }, [prospects, query]);
  const selected = prospects.find((item) => item.id === selectedId) || visible[0];

  useEffect(() => {
    if (selectedId && !prospects.some((item) => item.id === selectedId)) setSelectedId('');
  }, [prospects, selectedId]);

  useEffect(() => {
    if (
      selected
      && selected.contactNameSource !== 'manual'
      && !selected.contactNameInferenceStatus
    ) {
      void onInferContactName(selected);
    }
    if (
      selected
      && selected.outreachLanguageSource !== 'manual'
      && !selected.outreachLanguageInferenceStatus
    ) {
      void onInferOutreachLanguage(selected);
    }
  }, [onInferContactName, onInferOutreachLanguage, selected]);

  if (!prospects.length) {
    return (
      <div className="flex min-h-96 flex-1 flex-col items-center justify-center rounded-lg border border-dashed bg-white/45 text-center">
        <CheckCircle2 className="mb-3 h-10 w-10 text-muted-foreground" />
        <h3 className="font-semibold">没有待确认邀约方向的红人</h3>
        <p className="mt-1 text-sm text-muted-foreground">先在“红人录入”完成识别、查重、新建线索和确认待开发。</p>
      </div>
    );
  }

  return (
    <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[300px_minmax(0,1fr)]">
      <aside className="flex min-h-0 flex-col border-r border-border/70 pr-3">
        <div className="relative mb-3">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="筛选待确认红人"
            className="h-9 bg-white/75 pl-8"
          />
        </div>
        <div className="min-h-0 space-y-1 overflow-y-auto">
          {visible.map((prospect) => (
            <button
              key={prospect.id}
              type="button"
              onClick={() => setSelectedId(prospect.id)}
              className={`flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors ${
                selected?.id === prospect.id ? 'bg-primary text-primary-foreground' : 'hover:bg-white/80'
              }`}
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-slate-100">
                {prospect.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={prospect.avatarUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <Youtube className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{prospect.title || prospect.inputUrl}</p>
                <p className={`truncate text-xs ${selected?.id === prospect.id ? 'text-primary-foreground/75' : 'text-muted-foreground'}`}>
                  {countryLabel(prospect.country)} · {prospectLanguageLabel(prospect)}
                </p>
              </div>
            </button>
          ))}
        </div>
      </aside>

      {selected && (
        <section className="min-h-0 overflow-y-auto pr-1">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/70 pb-3">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-slate-100">
                {selected.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={selected.avatarUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <Youtube className="h-5 w-5 text-muted-foreground" />
                )}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate text-lg font-semibold">{selected.title || selected.inputUrl}</h2>
                  <Badge variant="outline" className={WORKFLOW_META[selected.workflowStatus].className}>
                    {WORKFLOW_META[selected.workflowStatus].label}
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {countryLabel(selected.country)} · {prospectLanguageLabel(selected)} · 粉丝 {formatCompactNumber(selected.subscriberCount)}
                  {' · '}近期均播 {formatCompactNumber(selected.recentAverageViews)}
                </p>
              </div>
            </div>
            <a
              href={selected.url || selected.sourceUrl || selected.inputUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
            >
              打开频道
              <ExternalLink className="h-4 w-4" />
            </a>
          </div>

          <div className="grid gap-4 py-4 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="space-y-4">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold">最近视频</p>
                  {translatingVideoTitleIds.includes(selected.id) && (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      标题翻译中
                    </span>
                  )}
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {(selected.recentVideos || []).slice(0, 8).map((video) => (
                    <a
                      key={video.videoId || video.url || video.title}
                      href={video.url || selected.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-2 rounded-md border bg-white/70 p-2 hover:border-primary/40"
                    >
                      <div className="h-12 w-20 shrink-0 overflow-hidden rounded bg-slate-100">
                        {video.thumbnail ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={video.thumbnail} alt="" loading="lazy" className="h-full w-full object-cover" />
                        ) : null}
                      </div>
                      <div className="min-w-0">
                        <p className="line-clamp-2 text-xs font-medium" title={video.title}>
                          {video.translatedTitle || video.title}
                        </p>
                        <p className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                          <span>播放 {formatCompactNumber(video.viewCount)}</span>
                          <span>赞 {formatCompactNumber(video.likeCount)}</span>
                          <span>评 {formatCompactNumber(video.commentCount)}</span>
                          <span>ER {formatVideoEngagementRate(video)}</span>
                        </p>
                      </div>
                    </a>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-sm font-semibold">频道简介摘要</p>
                <p className="mt-2 whitespace-pre-wrap rounded-md bg-slate-50/80 p-3 text-sm leading-6 text-muted-foreground">
                  {selected.description?.slice(0, 900) || '暂无频道简介。'}
                </p>
              </div>

              <div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold">历史判断</p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onCheckHistory(selected)}
                    disabled={checkingHistoryId === selected.id || !selected.publicEmail}
                  >
                    {checkingHistoryId === selected.id ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Clock3 className="mr-1 h-4 w-4" />}
                    检查 Gmail 历史
                  </Button>
                </div>
                <dl className="mt-2 grid grid-cols-3 gap-2 text-sm">
                  <div className="rounded-md bg-slate-50 p-2">
                    <dt className="text-xs text-muted-foreground">曾联系过</dt>
                    <dd className="mt-1 font-medium">{yesNoUnknown(selected.contactedBefore)}</dd>
                  </div>
                  <div className="rounded-md bg-slate-50 p-2">
                    <dt className="text-xs text-muted-foreground">曾合作过</dt>
                    <dd className="mt-1 font-medium">{yesNoUnknown(selected.collaboratedBefore)}</dd>
                  </div>
                  <div className="rounded-md bg-slate-50 p-2">
                    <dt className="text-xs text-muted-foreground">疑似竞品合作</dt>
                    <dd className="mt-1 font-medium">
                      {selected.competitorCollaboration === 'suspected' ? '疑似' : selected.competitorCollaboration === 'yes' ? '是' : selected.competitorCollaboration === 'no' ? '否' : '待人工判断'}
                    </dd>
                  </div>
                </dl>
              </div>
            </div>

            <div className="space-y-3 border-l border-border/70 pl-4">
              <div>
                <Label htmlFor={`product-${selected.id}`}>目标产品 *</Label>
                <select
                  id={`product-${selected.id}`}
                  value={selected.targetProduct || ''}
                  onChange={(event) => onPatch(selected.id, { targetProduct: event.target.value })}
                  className="mt-1.5 h-10 w-full rounded-md border bg-white px-3 text-sm"
                >
                  <option value="">请选择目标产品</option>
                  {selected.targetProduct && !productOptions.includes(selected.targetProduct) && (
                    <option value={selected.targetProduct}>{selected.targetProduct}</option>
                  )}
                  {productOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </div>
              <div>
                <Label htmlFor={`cooperation-${selected.id}`}>合作形式 *</Label>
                <select
                  id={`cooperation-${selected.id}`}
                  value={selected.cooperationType || ''}
                  onChange={(event) => onPatch(selected.id, { cooperationType: event.target.value })}
                  className="mt-1.5 h-10 w-full rounded-md border bg-white px-3 text-sm"
                >
                  <option value="">请选择合作形式</option>
                  {COOPERATION_TYPES.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </div>
              <div>
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor={`contact-name-${selected.id}`}>联系人姓名</Label>
                  {selected.contactNameInferenceStatus === 'error' && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => void onInferContactName(selected, true)}
                      disabled={inferringContactNameIds.includes(selected.id)}
                    >
                      <RefreshCw className="mr-1 h-3.5 w-3.5" />
                      重新识别
                    </Button>
                  )}
                </div>
                <div className="mt-1.5 flex items-center gap-1.5">
                  <Input
                    id={`contact-name-${selected.id}`}
                    value={selected.contactName || ''}
                    onChange={(event) => onPatch(selected.id, {
                      contactName: event.target.value,
                      contactNameConfidence: undefined,
                      contactNameSource: 'manual',
                      contactNameInferenceStatus: event.target.value.trim() ? 'found' : 'not_found',
                    })}
                    placeholder={
                      inferringContactNameIds.includes(selected.id)
                        ? '智能助手正在从频道资料中判断...'
                        : '未发现姓名时请人工填写'
                    }
                    className="bg-white"
                  />
                  {inferringContactNameIds.includes(selected.id) ? (
                    <span
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center text-muted-foreground"
                      aria-label="正在识别联系人姓名"
                    >
                      <Loader2 className="h-4 w-4 animate-spin" />
                    </span>
                  ) : selected.contactNameSource === 'ai'
                    && typeof selected.contactNameConfidence === 'number' ? (
                      <ConfidenceIcon
                        confidence={selected.contactNameConfidence}
                        label="智能姓名识别置信度"
                      />
                    ) : null}
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor={`outreach-language-${selected.id}`}>开发信语言 *</Label>
                  {selected.outreachLanguageInferenceStatus === 'error' && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => void onInferOutreachLanguage(selected, true)}
                      disabled={inferringOutreachLanguageIds.includes(selected.id)}
                    >
                      <RefreshCw className="mr-1 h-3.5 w-3.5" />
                      重新识别
                    </Button>
                  )}
                </div>
                <div className="mt-1.5 flex items-center gap-1.5">
                  <LanguageCombobox
                    id={`outreach-language-${selected.id}`}
                    value={selected.outreachLanguage}
                    disabled={inferringOutreachLanguageIds.includes(selected.id)}
                    onValueChange={(value) => onPatch(selected.id, {
                      outreachLanguage: value,
                      outreachLanguageConfidence: undefined,
                      outreachLanguageSource: 'manual',
                      outreachLanguageInferenceStatus: 'found',
                    })}
                  />
                  {inferringOutreachLanguageIds.includes(selected.id) ? (
                    <span
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center text-muted-foreground"
                      aria-label="正在识别开发信语言"
                    >
                      <Loader2 className="h-4 w-4 animate-spin" />
                    </span>
                  ) : selected.outreachLanguageSource === 'ai'
                    && typeof selected.outreachLanguageConfidence === 'number' ? (
                      <ConfidenceIcon
                        confidence={selected.outreachLanguageConfidence}
                        label="智能语言识别置信度"
                      />
                    ) : null}
                </div>
                {selected.outreachLanguageInferenceStatus === 'not_found' && (
                  <p className="mt-1 text-xs text-amber-700">
                    智能助手未能确认语言，请手动搜索并选择后再生成开发信。
                  </p>
                )}
              </div>
              <div>
                <Label htmlFor={`idea-${selected.id}`}>合作想法 *</Label>
                <Textarea
                  id={`idea-${selected.id}`}
                  value={selected.cooperationIdea || ''}
                  onChange={(event) => onPatch(selected.id, { cooperationIdea: event.target.value })}
                  placeholder="写明为什么适合、建议切入角度、希望重点展示的功能。"
                  className="mt-1.5 min-h-28 resize-y bg-white"
                />
              </div>
              <div>
                <Label htmlFor={`priority-${selected.id}`}>优先级</Label>
                <select
                  id={`priority-${selected.id}`}
                  value={selected.priority || 'medium'}
                  onChange={(event) => onPatch(selected.id, { priority: event.target.value as ProspectPriority })}
                  className="mt-1.5 h-10 w-full rounded-md border bg-white px-3 text-sm"
                >
                  <option value="high">高</option>
                  <option value="medium">中</option>
                  <option value="low">低</option>
                </select>
              </div>
              <div>
                <Label htmlFor={`email-${selected.id}`}>邮箱</Label>
                <div className="relative mt-1.5">
                  <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id={`email-${selected.id}`}
                    type="email"
                    value={selected.publicEmail || ''}
                    onChange={(event) => onPatch(selected.id, {
                      publicEmail: event.target.value,
                      emailStatus: event.target.value.trim() ? 'manual' : 'missing',
                    })}
                    placeholder="未获取到邮箱，请人工补充"
                    className="bg-white pl-9"
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-2 border-t pt-3">
                <Button variant="outline" onClick={() => onSave(selected)}>
                  <CheckCircle2 className="mr-1 h-4 w-4" />
                  保存邀约方向
                </Button>
                <Button
                  onClick={() => onConfirmOutreach(selected)}
                  disabled={
                    !selected.targetProduct?.trim()
                    || !selected.cooperationType?.trim()
                    || !selected.outreachLanguage?.trim()
                    || !selected.cooperationIdea?.trim()
                  }
                >
                  <Sparkles className="mr-1 h-4 w-4" />
                  确认生成开发信
                </Button>
                <Dialog>
                  <DialogTrigger asChild>
                    <Button variant="outline">
                      <Eye className="mr-1 h-4 w-4" />
                      查看邮件提示词
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-h-[86vh] sm:max-w-4xl">
                    <DialogHeader>
                      <DialogTitle>开发信智能输入预览</DialogTitle>
                      <DialogDescription>
                        核对邮件生成规则和本次实际提交给智能助手的红人资料。
                      </DialogDescription>
                    </DialogHeader>
                    <Tabs defaultValue="rules" className="min-h-0">
                      <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="rules">邮件生成规则</TabsTrigger>
                        <TabsTrigger value="context">本次红人资料</TabsTrigger>
                      </TabsList>
                      <TabsContent
                        value="rules"
                        className="max-h-[62vh] overflow-y-auto rounded-md border bg-muted/35 p-4"
                      >
                        <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-6 text-foreground">
                          {outreachPrompt}
                        </pre>
                      </TabsContent>
                      <TabsContent
                        value="context"
                        className="max-h-[62vh] overflow-y-auto rounded-md border bg-muted/20 p-4"
                      >
                        <OutreachContextPreview context={getOutreachContext(selected)} />
                      </TabsContent>
                    </Tabs>
                  </DialogContent>
                </Dialog>
                <Button variant="ghost" onClick={() => onBack(selected)}>
                  <ArrowLeft className="mr-1 h-4 w-4" />
                  返回录入
                </Button>
                <Button variant="ghost" onClick={() => onSkip(selected)} className="text-muted-foreground">
                  <SkipForward className="mr-1 h-4 w-4" />
                  跳过该红人
                </Button>
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
