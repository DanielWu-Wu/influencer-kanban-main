'use client';

import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Edit3,
  ExternalLink,
  Loader2,
  MailPlus,
  RefreshCw,
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

type Props = {
  prospects: Prospect[];
  generatingId: string | null;
  savingDraftId: string | null;
  onPatch: (id: string, patch: Partial<Prospect>) => void;
  onGenerate: (prospect: Prospect) => void;
  onSaveDraft: (prospect: Prospect) => void;
  onBack: (prospect: Prospect) => void;
  onSkip: (prospect: Prospect) => void;
};

export function OutreachEmailTab({
  prospects,
  generatingId,
  savingDraftId,
  onPatch,
  onGenerate,
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
          const hasDraft = Boolean(prospect.aiDraft?.subject && prospect.aiDraft.body);
          const isSaved = prospect.workflowStatus === 'gmail_draft_saved';
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
                      {countryLabel(prospect.country)} · {prospect.language || '语言未知'} · {prospect.targetProduct || '未选产品'} · {prospect.cooperationType || '未选合作形式'}
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
                    <div className="flex min-h-64 flex-col items-center justify-center rounded-md border border-dashed text-center">
                      <Sparkles className="mb-3 h-8 w-8 text-muted-foreground" />
                      <p className="font-medium">尚未生成开发信</p>
                      <p className="mt-1 text-sm text-muted-foreground">AI 会结合频道资料、产品、合作形式和你的合作想法起草邮件。</p>
                      <Button className="mt-4" onClick={() => onGenerate(prospect)} disabled={generatingId === prospect.id}>
                        {generatingId === prospect.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                        生成开发信
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div>
                        <Label htmlFor={`subject-${prospect.id}`}>邮件标题</Label>
                        <Input
                          id={`subject-${prospect.id}`}
                          value={prospect.aiDraft?.subject || ''}
                          readOnly={!isEditing}
                          onChange={(event) => onPatch(prospect.id, {
                            aiDraft: { ...prospect.aiDraft!, subject: event.target.value },
                          })}
                          className={`mt-1.5 ${isEditing ? 'bg-white' : 'bg-slate-50'}`}
                        />
                      </div>
                      <div className="grid gap-3 2xl:grid-cols-2">
                        <div>
                          <Label htmlFor={`body-${prospect.id}`}>外语邮件正文</Label>
                          <Textarea
                            id={`body-${prospect.id}`}
                            value={prospect.aiDraft?.body || ''}
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
