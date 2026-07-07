'use client';

import { useEffect, useState } from 'react';
import { ArrowLeft, Check, Clock3, Link2, Mail, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Textarea } from '@/components/ui/textarea';
import { useSettings } from '@/lib/data';
import { sanitizeEmailHtml } from '@/lib/email-content';

function clampDelay(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(60, Math.max(0, Math.round(value)));
}

function normalizeLinkUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export function GmailSignatureSettings({ onBack }: { onBack: () => void }) {
  const { settings, updateSettings, loading } = useSettings();
  const [signature, setSignature] = useState('');
  const [sendDelay, setSendDelay] = useState(0);
  const [linkText, setLinkText] = useState('AFERIY EU');
  const [linkUrl, setLinkUrl] = useState('');
  const [linkError, setLinkError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (loading) return;
    setSignature(settings.emailSignature || '');
    setSendDelay(clampDelay(settings.emailSendDelaySeconds ?? 0));
  }, [loading, settings.emailSendDelaySeconds, settings.emailSignature]);

  const handleInsertLink = () => {
    const normalizedUrl = normalizeLinkUrl(linkUrl);
    if (!linkText.trim() || !normalizedUrl) {
      setLinkError('请填写链接文字和店铺链接。');
      return;
    }
    if (!/^https?:\/\/[^\s.]+\.[^\s]+/i.test(normalizedUrl)) {
      setLinkError('请输入有效链接，例如 https://es.aferiy.com。');
      return;
    }
    const markdownLink = `[${linkText.trim()}](${normalizedUrl})`;
    setSignature((current) => {
      const suffix = current.trimEnd();
      return suffix ? `${suffix}\n${markdownLink}` : markdownLink;
    });
    setLinkError('');
  };

  const handleSave = () => {
    updateSettings({
      emailSignature: signature.trim(),
      emailSendDelaySeconds: clampDelay(sendDelay),
    });
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-6 py-6">
        <div className="glass-panel-strong rounded-lg p-5">
          <div className="border-b border-white/60 pb-4">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg md:hidden" onClick={onBack}>
                <ArrowLeft className="h-4 w-4" />
                <span className="sr-only">返回邮箱</span>
              </Button>
              <Mail className="h-5 w-5 text-red-500" />
              <h2 className="text-lg font-semibold">Gmail 设置</h2>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              管理通过红人工作台发送的邮件行为。
            </p>
          </div>

          <section className="border-b border-white/60 py-6">
            <div className="mb-5 flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/10">
                <Clock3 className="h-4 w-4 text-primary" />
              </div>
              <div>
                <h3 className="font-medium">邮件延迟发送</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  点击发送后先倒计时，在倒计时结束前可以取消发送。设置为 0 秒时立即发送。
                </p>
              </div>
            </div>

            <div className="rounded-lg border border-white/65 bg-white/55 p-4">
              <div className="flex items-center gap-4">
                <Slider
                  value={[sendDelay]}
                  min={0}
                  max={60}
                  step={1}
                  aria-label="邮件延迟发送秒数"
                  onValueChange={(values) => setSendDelay(clampDelay(values[0] ?? 0))}
                />
                <div className="flex shrink-0 items-center gap-2">
                  <Input
                    type="number"
                    min={0}
                    max={60}
                    step={1}
                    value={sendDelay}
                    className="w-20 rounded-lg border-white/65 bg-white/75 text-center"
                    onChange={(event) => setSendDelay(clampDelay(Number(event.target.value)))}
                  />
                  <span className="text-sm text-muted-foreground">秒</span>
                </div>
              </div>
              <div className="mt-3 flex justify-between text-xs text-muted-foreground">
                <span>0 秒（立即发送）</span>
                <span>当前：{sendDelay} 秒</span>
                <span>60 秒</span>
              </div>
            </div>
          </section>

          <section className="py-6">
            <div className="mb-4">
              <h3 className="font-medium">邮件签名</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                发送邮件或保存 Gmail 草稿时，签名会自动添加在正文末尾。链接格式会自动转成可点击链接。
              </p>
            </div>

            <div className="mb-4 rounded-lg border border-white/65 bg-white/55 p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-medium">
                <Link2 className="h-4 w-4 text-primary" />
                添加店铺首页链接
              </div>
              <div className="grid gap-3 md:grid-cols-[180px_minmax(0,1fr)_auto]">
                <Input
                  value={linkText}
                  onChange={(event) => setLinkText(event.target.value)}
                  placeholder="链接文字，例如 AFERIY EU"
                  className="rounded-lg border-white/65 bg-white/75"
                />
                <Input
                  value={linkUrl}
                  onChange={(event) => setLinkUrl(event.target.value)}
                  placeholder="店铺首页链接，例如 https://es.aferiy.com"
                  className="rounded-lg border-white/65 bg-white/75"
                />
                <Button type="button" variant="outline" className="h-10 gap-2 rounded-lg border-white/70 bg-white/70" onClick={handleInsertLink}>
                  <Link2 className="h-4 w-4" />
                  插入链接
                </Button>
              </div>
              {linkError ? (
                <p className="mt-2 text-xs text-destructive">{linkError}</p>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground">
                  插入后会显示为 [链接文字](链接地址)，保存草稿或发送时会变成可点击链接。
                </p>
              )}
            </div>

            <Textarea
              value={signature}
              onChange={(event) => setSignature(event.target.value)}
              placeholder={'例如：\nBest regards,\nDaniel Wu\nDigital Marketing Specialist | Aferiy\n[AFERIY EU](https://es.aferiy.com)'}
              className="min-h-44 resize-y rounded-lg border-white/65 bg-white/75"
            />

            <div className="mt-8 border-t border-white/60 pt-6">
              <p className="mb-3 text-sm font-medium">签名预览</p>
              <div
                className="min-h-28 whitespace-pre-wrap rounded-lg border border-white/65 bg-white/75 p-4 text-sm"
                dangerouslySetInnerHTML={{
                  __html: signature
                    ? sanitizeEmailHtml(signature)
                    : '<span class="text-muted-foreground">尚未设置邮件签名</span>',
                }}
              />
            </div>
          </section>

          <div className="sticky bottom-0 flex justify-end border-t border-white/60 bg-white/65 py-4 backdrop-blur-xl">
            <Button onClick={handleSave} className="h-10 gap-2 rounded-lg shadow-apple">
              {saved ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
              {saved ? '已保存' : '保存 Gmail 设置'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
