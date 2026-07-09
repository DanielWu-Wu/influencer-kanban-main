'use client';

import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  ExternalLink,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
  UserCheck,
  UserPlus,
  Youtube,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import {
  canConfirmInvitation,
  canCreateFeishuRecord,
  countryLabel,
  DEVELOPMENT_STATUS_META,
  formatCompactNumber,
  RESOURCE_STATUS_META,
  type Prospect,
  WORKFLOW_META,
} from '@/lib/creator-prospecting';
import { outreachLanguageLabel } from '@/lib/outreach-languages';

type Props = {
  prospects: Prospect[];
  selectedIds: string[];
  input: string;
  preference: string;
  resolving: boolean;
  checkingDedupe: boolean;
  writingFeishu: boolean;
  preparingDevelopmentPreview: boolean;
  onInputChange: (value: string) => void;
  onPreferenceChange: (value: string) => void;
  onResolve: () => void;
  onCheckDedupe: (items: Prospect[]) => void;
  onAddResources: (items: Prospect[]) => void;
  onCreateRecords: (items: Prospect[]) => void;
  onConfirmInvitation: (items: Prospect[]) => void;
  onPatch: (id: string, patch: Partial<Prospect>) => void;
  onToggleSelected: (id: string, checked: boolean) => void;
  onToggleAll: (ids: string[], checked: boolean) => void;
  onConfirmSuspected: (id: string) => void;
  onUseExistingResource: (id: string) => void;
  onUseExisting: (id: string) => void;
  onRemove: (id: string) => void;
  onClearInput: () => void;
};

function FieldLine({ label, value }: { label: string; value?: string | number | null }) {
  const text = value === null || value === undefined || value === '' ? '未填写' : String(value);
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="truncate text-sm text-slate-800" title={text}>{text}</p>
    </div>
  );
}

function ResourceStatusText({
  prospect,
  className,
  label,
}: {
  prospect: Prospect;
  className: string;
  label: string;
}) {
  if (prospect.resourceStatus !== 'suspected') {
    return <p className={className}>{label}</p>;
  }

  const preview = prospect.resourceMatchPreview;
  return (
    <HoverCard openDelay={120} closeDelay={120}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          className={`${className} cursor-help text-left underline decoration-dotted underline-offset-2`}
        >
          {label}
        </button>
      </HoverCardTrigger>
      <HoverCardContent align="start" side="top" className="w-[460px] p-0">
        <div className="border-b bg-amber-50/80 px-4 py-3">
          <p className="font-medium text-amber-900">疑似资源库记录</p>
          <p className="mt-1 text-xs text-amber-800">
            {preview?.matchReason || '暂无资源库预览，请重新飞书查重'}
          </p>
        </div>
        {preview ? (
          <div className="grid gap-3 p-4 sm:grid-cols-2">
            <div className="space-y-2 rounded-md border bg-white/80 p-3">
              <p className="text-xs font-medium text-slate-900">当前识别频道</p>
              <FieldLine label="频道名" value={prospect.title} />
              <FieldLine label="频道链接" value={prospect.url || prospect.sourceUrl || prospect.inputUrl} />
              <FieldLine label="邮箱" value={prospect.publicEmail} />
              <FieldLine label="地区" value={prospect.country ? countryLabel(prospect.country) : ''} />
            </div>
            <div className="space-y-2 rounded-md border bg-white/80 p-3">
              <p className="text-xs font-medium text-slate-900">飞书资源库记录</p>
              <FieldLine label="频道名" value={preview.channelName} />
              <FieldLine label="频道链接" value={preview.channelUrl} />
              <FieldLine label="邮箱" value={preview.email} />
              <FieldLine label="地区 / 平台" value={[preview.region, preview.platform].filter(Boolean).join(' / ')} />
              <FieldLine label="备注" value={preview.notes} />
            </div>
          </div>
        ) : (
          <div className="p-4 text-sm text-muted-foreground">
            暂无资源库预览，请重新点击“飞书查重”。
          </div>
        )}
      </HoverCardContent>
    </HoverCard>
  );
}

export function InfluencerImportTab({
  prospects,
  selectedIds,
  input,
  preference,
  resolving,
  checkingDedupe,
  writingFeishu,
  preparingDevelopmentPreview,
  onInputChange,
  onPreferenceChange,
  onResolve,
  onCheckDedupe,
  onAddResources,
  onCreateRecords,
  onConfirmInvitation,
  onPatch,
  onToggleSelected,
  onToggleAll,
  onConfirmSuspected,
  onUseExistingResource,
  onUseExisting,
  onRemove,
  onClearInput,
}: Props) {
  const [query, setQuery] = useState('');
  const selected = useMemo(
    () => prospects.filter((item) => selectedIds.includes(item.id)),
    [prospects, selectedIds],
  );
  const visibleProspects = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return prospects;
    return prospects.filter((item) => [
      item.title,
      item.channelId,
      item.publicEmail,
      item.url,
      item.inputUrl,
    ].some((value) => String(value || '').toLowerCase().includes(normalized)));
  }, [prospects, query]);
  const allVisibleSelected = visibleProspects.length > 0
    && visibleProspects.every((item) => selectedIds.includes(item.id));
  const canCheck = selected.some((item) => item.workflowStatus === 'resolved');
  const canCreate = selected.some(canCreateFeishuRecord);
  const canAddResource = selected.some((item) => item.resourceStatus === 'missing' && !item.resourceRecordId);
  const canConfirm = selected.some(canConfirmInvitation);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <section className="grid gap-3 border-b border-border/70 pb-4 xl:grid-cols-[minmax(360px,0.9fr)_minmax(0,1.1fr)]">
        <div>
          <label htmlFor="creator-links" className="mb-1.5 block text-sm font-semibold">
            批量导入频道链接
          </label>
          <Textarea
            id="creator-links"
            value={input}
            onChange={(event) => onInputChange(event.target.value)}
            placeholder={'每行一个 YouTube 频道链接\n支持 @handle、channel/UC、c/、user/ 和视频链接'}
            className="min-h-28 resize-y bg-white/75"
          />
        </div>
        <div>
          <label htmlFor="creator-preference" className="mb-1.5 block text-sm font-semibold">
            本次开发备注
          </label>
          <Textarea
            id="creator-preference"
            value={preference}
            onChange={(event) => onPreferenceChange(event.target.value)}
            placeholder="填写开发目的、主推产品、预算范围、语气要求等；后续生成开发信时会作为补充背景。"
            className="min-h-28 resize-y bg-white/75"
          />
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={onResolve} disabled={resolving}>
          {resolving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          识别频道
        </Button>
        <Button variant="outline" onClick={() => onCheckDedupe(selected)} disabled={!canCheck || checkingDedupe}>
          {checkingDedupe ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Database className="mr-2 h-4 w-4" />}
          飞书查重
        </Button>
        <Button variant="outline" onClick={() => onAddResources(selected)} disabled={!canAddResource || writingFeishu}>
          <UserPlus className="mr-2 h-4 w-4" />
          加入资源库
        </Button>
        <Button
          variant="outline"
          onClick={() => onCreateRecords(selected)}
          disabled={!canCreate || preparingDevelopmentPreview || writingFeishu}
        >
          {preparingDevelopmentPreview ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserPlus className="mr-2 h-4 w-4" />}
          {preparingDevelopmentPreview ? '准备预览中…' : '新建开发记录'}
        </Button>
        <Button variant="outline" onClick={() => onConfirmInvitation(selected)} disabled={!canConfirm}>
          <UserCheck className="mr-2 h-4 w-4" />
          确认待开发
        </Button>
        <Button variant="ghost" onClick={onClearInput} disabled={!input}>
          清空输入
        </Button>
        <div className="relative ml-auto min-w-56">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="筛选频道、邮箱或链接"
            className="h-9 bg-white/75 pl-8"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-border/70 bg-white/70">
        <Table className="min-w-[1180px]">
          <TableHeader className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur">
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={allVisibleSelected}
                  onCheckedChange={(checked) => onToggleAll(visibleProspects.map((item) => item.id), Boolean(checked))}
                  aria-label="选择全部可见线索"
                />
              </TableHead>
              <TableHead className="w-12">头像</TableHead>
              <TableHead className="min-w-44">频道</TableHead>
              <TableHead>国家/语言</TableHead>
              <TableHead className="text-right">粉丝</TableHead>
              <TableHead className="text-right">近期均播</TableHead>
              <TableHead>邮箱</TableHead>
              <TableHead>飞书双表状态</TableHead>
              <TableHead>当前状态</TableHead>
              <TableHead className="w-28 text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleProspects.map((prospect) => {
              const workflow = WORKFLOW_META[prospect.workflowStatus];
              const resourceStatus = RESOURCE_STATUS_META[prospect.resourceStatus];
              const developmentStatus = DEVELOPMENT_STATUS_META[prospect.developmentStatus];
              const channelUrl = prospect.url || prospect.sourceUrl || prospect.inputUrl;
              return (
                <TableRow key={prospect.id} className="align-middle">
                  <TableCell>
                    <Checkbox
                      checked={selectedIds.includes(prospect.id)}
                      onCheckedChange={(checked) => onToggleSelected(prospect.id, Boolean(checked))}
                      aria-label={`选择 ${prospect.title || prospect.inputUrl}`}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-md bg-slate-100">
                      {prospect.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={prospect.avatarUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <Youtube className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="max-w-64">
                      <p className="truncate font-medium">{prospect.title || prospect.inputUrl}</p>
                      <a
                        href={channelUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-0.5 inline-flex max-w-full items-center gap-1 truncate text-xs text-primary hover:underline"
                      >
                        <span className="truncate">{prospect.customUrl || prospect.channelId || '打开频道'}</span>
                        <ExternalLink className="h-3 w-3 shrink-0" />
                      </a>
                    </div>
                  </TableCell>
                  <TableCell>
                    <p>{countryLabel(prospect.country)}</p>
                    <p className="text-xs text-muted-foreground">
                      {prospect.language ? `${outreachLanguageLabel(prospect.language)}${prospect.languageSource === 'inferred' ? '（推断）' : ''}` : '语言未知'}
                    </p>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatCompactNumber(prospect.subscriberCount)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCompactNumber(prospect.recentAverageViews)}</TableCell>
                  <TableCell className="min-w-52">
                    <Input
                      type="email"
                      value={prospect.publicEmail || ''}
                      onChange={(event) => onPatch(prospect.id, {
                        publicEmail: event.target.value,
                        emailStatus: event.target.value.trim()
                          ? (prospect.emailStatus === 'available' ? 'available' : 'manual')
                          : 'missing',
                      })}
                      placeholder="填写邮箱"
                      className="h-8 bg-white"
                    />
                    <p className={`mt-1 flex items-center gap-1 text-xs ${
                      prospect.publicEmail ? 'text-emerald-700' : 'text-amber-700'
                    }`}
                    >
                      {prospect.publicEmail ? (
                        '会写入资源库和开发记录表'
                      ) : (
                        <>
                          <AlertTriangle className="h-3.5 w-3.5" />
                          未填邮箱时双表邮箱为空
                        </>
                      )}
                    </p>
                  </TableCell>
                  <TableCell>
                    <ResourceStatusText
                      prospect={prospect}
                      className={resourceStatus.className}
                      label={resourceStatus.label}
                    />
                    <p className={`mt-0.5 text-xs ${developmentStatus.className}`}>{developmentStatus.label}</p>
                    {prospect.duplicateReason && (
                      <p className="mt-0.5 max-w-40 truncate text-xs text-muted-foreground" title={prospect.duplicateReason}>
                        {prospect.duplicateReason}
                      </p>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={workflow.className}>{workflow.label}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {(prospect.resourceStatus === 'suspected' || prospect.developmentStatus === 'suspected')
                        && !prospect.duplicateConfirmedUnique && (
                        <Button
                          variant="ghost"
                          size="sm"
                          title="不关联疑似记录，允许新建红人信息"
                          onClick={() => onConfirmSuspected(prospect.id)}
                        >
                          <CheckCircle2 className="mr-1 h-4 w-4" />
                          确认为新红人
                        </Button>
                      )}
                      {prospect.resourceStatus === 'suspected' && prospect.resourceRecordId && (
                        <Button variant="ghost" size="sm" onClick={() => onUseExistingResource(prospect.id)}>
                          关联资源记录
                        </Button>
                      )}
                      {prospect.developmentStatus === 'suspected' && prospect.duplicateRecordId && (
                        <Button variant="ghost" size="sm" onClick={() => onUseExisting(prospect.id)}>
                          关联开发记录
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        title="移除线索"
                        aria-label={`移除 ${prospect.title || prospect.inputUrl}`}
                        onClick={() => onRemove(prospect.id)}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
            {visibleProspects.length === 0 && (
              <TableRow>
                <TableCell colSpan={10} className="h-44 text-center">
                  <Youtube className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
                  <p className="font-medium">{prospects.length ? '没有符合筛选条件的线索' : '还没有录入红人'}</p>
                  <p className="mt-1 text-sm text-muted-foreground">粘贴 YouTube 频道链接并点击“识别频道”。</p>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
