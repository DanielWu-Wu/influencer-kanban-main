'use client';

import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Edit3,
  ExternalLink,
  GripVertical,
  Image as ImageIcon,
  Link2,
  Loader2,
  MailPlus,
  RefreshCw,
  RotateCcw,
  Search,
  SkipForward,
  Sparkles,
  Youtube,
} from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  countryLabel,
  formatCompactNumber,
  type Prospect,
  WORKFLOW_META,
} from '@/lib/creator-prospecting';
import { appendEmailSignature, stripConfiguredEmailSignature } from '@/lib/email-content';
import { outreachLanguageLabel } from '@/lib/outreach-languages';
import { sanitizeOutreachEmailBody } from '@/lib/outreach-draft-sanitizer';
import {
  buildOutreachEmailHtml,
  clampImagePlacement,
  getRecommendedImagePlacement,
  selectedProductEmailAsset,
  splitEmailParagraphs,
  type OutreachEmailProductAsset,
} from '@/lib/outreach-email-rendering';
import type { Product } from '@/lib/types';

type Props = {
  prospects: Prospect[];
  products: Product[];
  emailSignature?: string;
  generatingId: string | null;
  regeneratingPart: { id: string; part: 'subject' | 'body' } | null;
  savingDraftId: string | null;
  onPatch: (id: string, patch: Partial<Prospect>) => void;
  onGenerate: (prospect: Prospect) => void;
  onRegeneratePart: (prospect: Prospect, part: 'subject' | 'body') => void;
  onSaveDraft: (prospect: Prospect) => void;
  onBack: (prospect: Prospect) => void;
  onSkip: (prospect: Prospect) => void;
};

function prospectLanguageLabel(prospect: Prospect) {
  const language = prospect.outreachLanguage || prospect.language;
  return language ? outreachLanguageLabel(language) : '语言未知';
}

function generationStageLabel(prospect: Prospect) {
  if (prospect.outreachGenerationStage === 'preparing') return '生成准备中';
  if (prospect.outreachGenerationStage === 'streaming_body') return '正在生成正文';
  if (prospect.outreachGenerationStage === 'finalizing') return '正在整理标题和中文翻译';
  if (prospect.outreachGenerationStage === 'error') return '生成失败';
  return '正在生成开发信';
}

function patchDraft(
  prospect: Prospect,
  patch: NonNullable<Prospect['aiDraft']> extends infer Draft ? Partial<Draft> : never,
) {
  return {
    aiDraft: { ...prospect.aiDraft!, ...patch },
  };
}

function ProductAssetPanel({
  prospect,
  product,
  onPatch,
}: {
  prospect: Prospect;
  product: OutreachEmailProductAsset | null;
  onPatch: (id: string, patch: Partial<Prospect>) => void;
}) {
  const hasLink = Boolean(product?.productUrl?.trim());
  const hasImage = Boolean(product?.mainImage?.dataUrl);
  const includeImage = hasImage && prospect.aiDraft?.productImageIncluded !== false;
  const resetPlacement = () => onPatch(prospect.id, patchDraft(prospect, {
    productImageIncluded: true,
    productImagePlacement: getRecommendedImagePlacement(prospect.aiDraft?.body || '', product),
  }));

  return (
    <div className="rounded-md border border-slate-200 bg-slate-50/80 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-16 w-20 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-white">
            {product?.mainImage?.dataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={product.mainImage.dataUrl} alt={product.model || product.name || '产品主图'} className="h-full w-full object-cover" />
            ) : (
              <ImageIcon className="h-5 w-5 text-muted-foreground" />
            )}
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-muted-foreground">产品素材</p>
            <p className="mt-1 truncate text-sm font-medium">{product ? [product.name, product.model].filter(Boolean).join(' / ') : prospect.targetProduct || '未选择产品'}</p>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 ${hasLink ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                <Link2 className="h-3 w-3" />
                {hasLink ? '型号已自动加链接' : '未设置产品链接，型号保持纯文本'}
              </span>
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 ${includeImage ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                <ImageIcon className="h-3 w-3" />
                {hasImage ? (includeImage ? '主图会插入邮件正文' : '主图已暂时移除') : '未设置主图，本次不插图'}
              </span>
            </div>
          </div>
        </div>
        {hasImage && (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant={includeImage ? 'outline' : 'default'}
              onClick={() => onPatch(prospect.id, patchDraft(prospect, { productImageIncluded: !includeImage }))}
            >
              <ImageIcon className="mr-1 h-3.5 w-3.5" />
              {includeImage ? '移除主图' : '插入主图'}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={resetPlacement} disabled={!includeImage}>
              <RotateCcw className="mr-1 h-3.5 w-3.5" />
              推荐位置
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function MailPreview({
  prospect,
  product,
  emailSignature,
  onPatch,
}: {
  prospect: Prospect;
  product: OutreachEmailProductAsset | null;
  emailSignature?: string;
  onPatch: (id: string, patch: Partial<Prospect>) => void;
}) {
  const body = stripConfiguredEmailSignature(
    prospect.aiDraft?.body || '',
    emailSignature,
  );
  const paragraphs = splitEmailParagraphs(body);
  const hasImage = Boolean(product?.mainImage?.dataUrl);
  const includeImage = hasImage && prospect.aiDraft?.productImageIncluded !== false;
  const imagePlacement = clampImagePlacement(prospect.aiDraft?.productImagePlacement, body, product);
  const html = appendEmailSignature(buildOutreachEmailHtml({
    body,
    product,
    imageSrc: product?.mainImage?.dataUrl,
    imagePlacement,
    includeImage,
  }), emailSignature);

  const moveImage = (placement: number) => {
    if (!includeImage) return;
    onPatch(prospect.id, patchDraft(prospect, { productImagePlacement: placement, productImageIncluded: true }));
  };

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <Label>邮件预览</Label>
        {includeImage && (
          <span className="text-xs text-muted-foreground">拖动图片到段落之间，保存草稿时会沿用这个位置</span>
        )}
      </div>
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_220px]">
        <div
          className="min-h-64 rounded-md border bg-white p-4 text-sm leading-6 shadow-sm [&_a]:text-primary [&_a]:underline [&_img]:my-2"
          onDragStart={(event) => {
            const target = event.target as HTMLElement;
            if (target.closest('[data-product-image="true"]')) {
              event.dataTransfer.setData('text/plain', 'product-image');
            }
          }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
        {includeImage && (
          <div className="rounded-md border border-dashed bg-slate-50/80 p-2">
            <p className="mb-2 text-xs font-medium text-muted-foreground">主图位置</p>
            <div className="space-y-1">
              {Array.from({ length: Math.max(1, paragraphs.length + 1) }).map((_, index) => (
                <button
                  key={index}
                  type="button"
                  draggable
                  onDragStart={(event) => event.dataTransfer.setData('text/plain', 'product-image')}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    moveImage(index);
                  }}
                  onClick={() => moveImage(index)}
                  className={`flex w-full items-center gap-2 rounded-md border px-2 py-2 text-left text-xs transition-colors ${
                    imagePlacement === index
                      ? 'border-primary/50 bg-primary/10 text-primary'
                      : 'border-transparent bg-white hover:border-primary/30'
                  }`}
                >
                  <GripVertical className="h-3.5 w-3.5 shrink-0" />
                  <span>{index === 0 ? '正文开头' : `第 ${index} 段后`}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function OutreachEmailTab({
  prospects,
  products,
  emailSignature,
  generatingId,
  regeneratingPart,
  savingDraftId,
  onPatch,
  onGenerate,
  onRegeneratePart,
  onSaveDraft,
  onBack,
  onSkip,
}: Props) {
  const [query, setQuery] = useState('');
  const [editingIds, setEditingIds] = useState<string[]>([]);
  const [confirmDraftId, setConfirmDraftId] = useState<string | null>(null);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return prospects;
    return prospects.filter((item) => [
      item.title,
      item.publicEmail,
      item.targetProduct,
      item.cooperationType,
    ].some((value) => String(value || '').toLowerCase().includes(normalized)));
  }, [prospects, query]);
  const confirmProspect = prospects.find((item) => item.id === confirmDraftId);

  if (!prospects.length) {
    return (
      <div className="flex min-h-96 flex-1 flex-col items-center justify-center rounded-lg border border-dashed bg-white/45 text-center">
        <MailPlus className="mb-3 h-10 w-10 text-muted-foreground" />
        <h3 className="font-semibold">没有待处理的开发信</h3>
        <p className="mt-1 text-sm text-muted-foreground">先在“邀约确认”选择产品、合作形式并确认生成开发信。</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 pb-3">
        <div>
          <h2 className="font-semibold">邮件审核队列</h2>
          <p className="text-sm text-muted-foreground">生成后先人工检查和编辑，确认无误才允许写入 Gmail 草稿。</p>
        </div>
        <div className="relative min-w-64">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="筛选频道、邮箱或产品"
            className="h-9 bg-white/75 pl-8"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {filtered.map((prospect) => {
          const isEditing = editingIds.includes(prospect.id);
          const safeDraftBody = sanitizeOutreachEmailBody(prospect.aiDraft?.body);
          const hasDraft = Boolean(prospect.aiDraft?.subject && safeDraftBody);
          const isSaved = prospect.workflowStatus === 'gmail_draft_saved';
          const isGenerating = generatingId === prospect.id
            || ['preparing', 'streaming_body', 'finalizing'].includes(prospect.outreachGenerationStage || '');
          const productAsset = selectedProductEmailAsset(products, prospect.targetProduct);
          const isRegeneratingSubject = regeneratingPart?.id === prospect.id && regeneratingPart.part === 'subject';
          const isRegeneratingBody = regeneratingPart?.id === prospect.id && regeneratingPart.part === 'body';
          return (
            <article key={prospect.id} className="rounded-lg border border-border/70 bg-white/70">
              <header className="flex flex-wrap items-start justify-between gap-3 border-b bg-slate-50/70 px-4 py-3">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-slate-100">
                    {prospect.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={prospect.avatarUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <Youtube className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate font-semibold">{prospect.title || prospect.inputUrl}</h3>
                      <Badge variant="outline" className={WORKFLOW_META[prospect.workflowStatus].className}>
                        {WORKFLOW_META[prospect.workflowStatus].label}
                      </Badge>
                      {!prospect.publicEmail && (
                        <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
                          邮箱缺失，待补充
                        </Badge>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {countryLabel(prospect.country)} · {prospectLanguageLabel(prospect)} · {prospect.targetProduct || '未选产品'} · {prospect.cooperationType || '未选合作形式'}
                    </p>
                  </div>
                </div>
                <a
                  href={prospect.url || prospect.sourceUrl || prospect.inputUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  打开频道
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </header>

              <div className="grid gap-4 p-4 xl:grid-cols-[320px_minmax(0,1fr)]">
                <aside className="space-y-3 text-sm">
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground">邮箱</p>
                    <Input
                      type="email"
                      value={prospect.publicEmail || ''}
                      onChange={(event) => onPatch(prospect.id, {
                        publicEmail: event.target.value,
                        emailStatus: event.target.value.trim() ? 'manual' : 'missing',
                      })}
                      placeholder="补充邮箱后才能保存 Gmail 草稿"
                      className="mt-1.5 h-9 bg-white"
                    />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground">合作想法</p>
                    <p className="mt-1 whitespace-pre-wrap rounded-md bg-slate-50 p-2 leading-5">
                      {prospect.cooperationIdea || '未填写'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground">频道简介摘要</p>
                    <p className="mt-1 line-clamp-5 leading-5 text-muted-foreground">
                      {prospect.description || '暂无简介'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground">最近视频</p>
                    <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
                      {(prospect.recentVideos || []).slice(0, 8).map((video) => (
                        <li key={video.videoId || video.url || video.title} className="line-clamp-1">
                          · {video.translatedTitle || video.title}（{formatCompactNumber(video.viewCount)} 播放）
                        </li>
                      ))}
                    </ul>
                  </div>
                </aside>

                <section className="min-w-0">
                  {!hasDraft ? (
                    isGenerating ? (
                      <div className="rounded-md border border-primary/20 bg-primary/5 p-4">
                        <div className="flex items-start gap-3">
                          <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                            <Loader2 className="h-4 w-4 animate-spin" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="font-medium">{generationStageLabel(prospect)}</p>
                            <p className="mt-1 text-sm text-muted-foreground">
                              正在根据频道资料、目标产品和合作想法起草邮件，正文会先逐步出现。
                            </p>
                          </div>
                        </div>
                        <div className="mt-4 grid gap-3">
                          <div>
                            <Label>邮件标题</Label>
                            <div className="mt-1.5 rounded-md border bg-white/70 px-3 py-2 text-sm text-muted-foreground">
                              {prospect.outreachGenerationStage === 'finalizing' ? '正在生成标题…' : '正文生成后整理标题'}
                            </div>
                          </div>
                          <div>
                            <Label>外语邮件正文</Label>
                            <div className="mt-1.5 min-h-48 whitespace-pre-wrap rounded-md border bg-white px-3 py-2 text-sm leading-6">
                              {prospect.streamingBody || prospect.aiDraft?.body || '正在等待第一段正文…'}
                              <span className="ml-0.5 inline-block h-4 w-1 animate-pulse bg-primary align-[-2px]" />
                            </div>
                          </div>
                          <div>
                            <Label>中文翻译对照</Label>
                            <div className="mt-1.5 rounded-md border bg-white/70 px-3 py-2 text-sm text-muted-foreground">
                              正文生成完成后生成中文对照。
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="flex min-h-64 flex-col items-center justify-center rounded-md border border-dashed text-center">
                        <Sparkles className="mb-3 h-8 w-8 text-muted-foreground" />
                        <p className="font-medium">{prospect.outreachGenerationStage === 'error' ? '开发信生成失败' : '尚未生成开发信'}</p>
                        <p className="mt-1 max-w-md text-sm text-muted-foreground">
                          {prospect.generationError || prospect.error || '智能助手会结合频道资料、产品、合作形式和你的合作想法起草邮件。'}
                        </p>
                        <Button className="mt-4" onClick={() => onGenerate(prospect)} disabled={generatingId === prospect.id}>
                          {generatingId === prospect.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                          {prospect.outreachGenerationStage === 'error' ? '重新生成' : '生成开发信'}
                        </Button>
                      </div>
                    )
                  ) : (
                    <div className="space-y-3">
                      <div>
                        <div className="flex items-center justify-between gap-2">
                          <Label htmlFor={`subject-${prospect.id}`}>邮件标题</Label>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-xs"
                            onClick={() => onRegeneratePart(prospect, 'subject')}
                            disabled={generatingId === prospect.id || isRegeneratingSubject || isRegeneratingBody}
                          >
                            {isRegeneratingSubject ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1 h-3.5 w-3.5" />}
                            重新生成
                          </Button>
                        </div>
                        <Input
                          id={`subject-${prospect.id}`}
                          value={prospect.aiDraft?.subject || ''}
                          readOnly={!isEditing}
                          onChange={(event) => onPatch(prospect.id, {
                            aiDraft: { ...prospect.aiDraft!, subject: event.target.value },
                          })}
                          className={`mt-1.5 ${isEditing ? 'bg-white' : 'bg-slate-50'}`}
                        />
                        {Boolean(prospect.aiDraft?.subjectOptions?.length) && (
                          <div className="mt-2 space-y-2">
                            <p className="text-xs font-medium text-muted-foreground">备选标题（点击可替换当前标题）</p>
                            <div className="grid gap-2">
                              {prospect.aiDraft!.subjectOptions!.slice(0, 3).map((option, index) => {
                                const isSelected = option.subject === prospect.aiDraft?.subject;
                                return (
                                  <button
                                    key={`${option.subject}-${index}`}
                                    type="button"
                                    className={`rounded-md border p-2 text-left transition-colors ${
                                      isSelected
                                        ? 'border-primary/50 bg-primary/5'
                                        : 'border-border/70 bg-slate-50 hover:border-primary/40 hover:bg-white'
                                    }`}
                                    onClick={() => onPatch(prospect.id, {
                                      aiDraft: { ...prospect.aiDraft!, subject: option.subject },
                                    })}
                                  >
                                    <div className="flex items-start gap-2">
                                      <Badge variant={isSelected ? 'default' : 'secondary'} className="mt-0.5 shrink-0 rounded-md">
                                        {index + 1}
                                      </Badge>
                                      <div className="min-w-0">
                                        <p className="break-words text-sm font-medium">{option.subject}</p>
                                        <p className="mt-1 break-words text-xs text-muted-foreground">
                                          中文：{option.translatedSubject || 'AI 未返回中文翻译'}
                                        </p>
                                      </div>
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                      <ProductAssetPanel
                        prospect={prospect}
                        product={productAsset}
                        onPatch={onPatch}
                      />
                      <div className="grid gap-3 2xl:grid-cols-2">
                        <div>
                          <div className="flex items-center justify-between gap-2">
                            <Label htmlFor={`body-${prospect.id}`}>外语邮件正文</Label>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-xs"
                              onClick={() => onRegeneratePart(prospect, 'body')}
                              disabled={generatingId === prospect.id || isRegeneratingSubject || isRegeneratingBody}
                            >
                              {isRegeneratingBody ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1 h-3.5 w-3.5" />}
                              重新生成
                            </Button>
                          </div>
                          <Textarea
                            id={`body-${prospect.id}`}
                            value={safeDraftBody}
                            readOnly={!isEditing}
                            onChange={(event) => onPatch(prospect.id, {
                              aiDraft: { ...prospect.aiDraft!, body: event.target.value },
                            })}
                            className={`mt-1.5 min-h-64 resize-y leading-6 ${isEditing ? 'bg-white' : 'bg-slate-50'}`}
                          />
                        </div>
                        <div>
                          <Label htmlFor={`translation-${prospect.id}`}>中文翻译对照</Label>
                          <Textarea
                            id={`translation-${prospect.id}`}
                            value={prospect.aiDraft?.translatedBody || prospect.aiDraft?.translatedSummary || ''}
                            readOnly={!isEditing}
                            onChange={(event) => onPatch(prospect.id, {
                              aiDraft: { ...prospect.aiDraft!, translatedBody: event.target.value },
                            })}
                            className={`mt-1.5 min-h-64 resize-y leading-6 ${isEditing ? 'bg-white' : 'bg-slate-50'}`}
                          />
                        </div>
                      </div>
                      <MailPreview
                        prospect={{
                          ...prospect,
                          aiDraft: prospect.aiDraft ? { ...prospect.aiDraft, body: safeDraftBody } : undefined,
                        }}
                        product={productAsset}
                        emailSignature={emailSignature}
                        onPatch={onPatch}
                      />
                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="rounded-md bg-blue-50/70 p-3">
                          <p className="text-xs font-semibold text-blue-800">个性化依据</p>
                          <ul className="mt-1 space-y-1 text-sm text-blue-900/80">
                            {(prospect.aiDraft?.personalizationNotes || ['AI 未返回个性化依据']).map((note) => <li key={note}>· {note}</li>)}
                          </ul>
                        </div>
                        <div className="rounded-md bg-amber-50/70 p-3">
                          <p className="flex items-center gap-1 text-xs font-semibold text-amber-800">
                            <AlertTriangle className="h-3.5 w-3.5" />
                            风险提醒
                          </p>
                          <ul className="mt-1 space-y-1 text-sm text-amber-900/80">
                            {[...(prospect.aiDraft?.riskNotes || []), ...(prospect.aiDraft?.missingInfo || [])].map((note) => <li key={note}>· {note}</li>)}
                            {!(prospect.aiDraft?.riskNotes?.length || prospect.aiDraft?.missingInfo?.length) && <li>· 暂无明显风险，保存前仍需人工复核。</li>}
                          </ul>
                        </div>
                      </div>
                    </div>
                  )}
                </section>
              </div>

              <footer className="flex flex-wrap items-center gap-2 border-t px-4 py-3">
                {hasDraft && (
                  <>
                    <Button variant="outline" onClick={() => onGenerate(prospect)} disabled={generatingId === prospect.id}>
                      {generatingId === prospect.id ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1 h-4 w-4" />}
                      重新生成
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setEditingIds((current) => (
                        current.includes(prospect.id)
                          ? current.filter((id) => id !== prospect.id)
                          : [...current, prospect.id]
                      ))}
                    >
                      {isEditing ? <CheckCircle2 className="mr-1 h-4 w-4" /> : <Edit3 className="mr-1 h-4 w-4" />}
                      {isEditing ? '完成编辑' : '编辑邮件'}
                    </Button>
                  </>
                )}
                <Button
                  onClick={() => setConfirmDraftId(prospect.id)}
                  disabled={!hasDraft || !prospect.publicEmail || savingDraftId === prospect.id || isSaved}
                >
                  {savingDraftId === prospect.id ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <MailPlus className="mr-1 h-4 w-4" />}
                  {isSaved ? '草稿已保存' : '保存 Gmail 草稿'}
                </Button>
                <Button variant="ghost" onClick={() => onBack(prospect)}>
                  <ArrowLeft className="mr-1 h-4 w-4" />
                  返回邀约确认
                </Button>
                <Button variant="ghost" onClick={() => onSkip(prospect)} className="text-muted-foreground">
                  <SkipForward className="mr-1 h-4 w-4" />
                  标记为无需开发
                </Button>
              </footer>
            </article>
          );
        })}
      </div>

      <AlertDialog open={Boolean(confirmProspect)} onOpenChange={(open) => !open && setConfirmDraftId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认写入 Gmail 草稿箱</AlertDialogTitle>
            <AlertDialogDescription>
              将为 {confirmProspect?.title || '该红人'} 创建一封收件人为 {confirmProspect?.publicEmail} 的 Gmail 草稿。
              系统不会发送邮件，保存后仍需你前往 Gmail 手动检查和发送。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>继续检查</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmProspect) onSaveDraft(confirmProspect);
                setConfirmDraftId(null);
              }}
            >
              确认保存草稿
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
