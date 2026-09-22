'use client';

import { useEffect, useRef, useState } from 'react';
import { Download, ImageIcon, Loader2, Paperclip } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import type { GmailAttachment } from '@/lib/types';

type Props = {
  messageId: string;
  attachments: GmailAttachment[];
  loadData: (messageId: string, attachment: GmailAttachment) => Promise<string>;
  downloadingIds: Set<string>;
  onDownload: (messageId: string, attachment: GmailAttachment) => void;
};

export function MailAttachmentGallery(props: Props) {
  return (
    <section id={`attachments-${props.messageId}`} aria-label="邮件附件" className="flex flex-col gap-2">
      <div className="text-sm font-medium">附件（{props.attachments.length}）</div>
      <div className="grid gap-2 sm:grid-cols-2">
        {props.attachments.map((attachment) => (
          <AttachmentCard key={`${attachment.id}:${attachment.filename}`} {...props} attachment={attachment} />
        ))}
      </div>
    </section>
  );
}

function AttachmentCard({ messageId, attachment, loadData, downloadingIds, onDownload }: Props & { attachment: GmailAttachment }) {
  const [url, setUrl] = useState(attachment.dataUrl || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [zoom, setZoom] = useState(false);
  const pending = useRef<Promise<string> | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const loadVisible = useRef<() => void>(() => {});
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  // Only raster image types are previewed. Other files remain downloadable.
  const image = /^image\/(jpeg|png|gif|webp|bmp|avif)$/i.test(attachment.mimeType);
  const downloadBusy = downloadingIds.has(`${messageId}:${attachment.id}`);
  const size = attachment.size ? attachment.size < 1024 * 1024
    ? `${Math.ceil(attachment.size / 1024)} KB`
    : `${(attachment.size / (1024 * 1024)).toFixed(1)} MB` : '未知大小';

  const load = async (force = false) => {
    if ((!force && url) || pending.current) return;
    setBusy(true);
    setError('');
    if (force) setUrl('');
    const request = loadData(messageId, force ? { ...attachment, dataUrl: undefined } : attachment);
    pending.current = request;
    try {
      const result = await request;
      if (mounted.current) setUrl(result);
    } catch {
      if (mounted.current) setError('图片读取失败，请重试；也可直接下载。');
    } finally {
      pending.current = null;
      if (mounted.current) setBusy(false);
    }
  };
  const download = () => onDownload(messageId, { ...attachment, dataUrl: url || attachment.dataUrl });
  useEffect(() => { loadVisible.current = () => { void load(); }; });
  useEffect(() => {
    if (!image || attachment.size > 2 * 1024 * 1024 || !card.current) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        loadVisible.current();
      }
    });
    observer.observe(card.current);
    return () => observer.disconnect();
  }, [image, attachment.size]);

  return (
    <div ref={card} className="flex min-w-0 flex-col gap-2 rounded-lg border bg-background p-3">
      <div className="flex min-w-0 items-center gap-3">
        <Dialog open={open} onOpenChange={(next) => { setOpen(next); setZoom(false); if (next) void load(); }}>
          <DialogTrigger asChild>
            <Button variant="outline" className="size-14 shrink-0 overflow-hidden p-0" disabled={!image} aria-label={`预览 ${attachment.filename}`}>
              {url && image && !error ? (
                // Authenticated attachment bytes cannot use the Next image optimizer.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={url} alt="" className="size-full object-contain" referrerPolicy="no-referrer" onError={() => setError('此图片暂时无法预览，可重试或下载查看。')} />
              ) : image ? <ImageIcon /> : <Paperclip />}
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-auto">
            <DialogTitle className="break-all pr-8">{attachment.filename}</DialogTitle>
            <DialogDescription>{size} · 图片预览，不会发送或修改邮件</DialogDescription>
            {busy ? <p role="status" className="flex items-center gap-2"><Loader2 className="size-4 animate-spin" />正在读取图片…</p> : null}
            {error ? <p role="status" className="text-sm text-destructive">{error}</p> : null}
            {url && !error ? (
              <div className="max-h-[65vh] overflow-auto rounded-lg bg-muted/30">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt={attachment.filename} referrerPolicy="no-referrer" className={zoom ? 'max-w-none' : 'mx-auto max-h-[65vh] max-w-full object-contain'} onError={() => setError('此图片暂时无法预览，可重试或下载查看。')} />
              </div>
            ) : null}
            <div className="flex flex-wrap justify-end gap-2">
              {error ? <Button variant="outline" disabled={busy} onClick={() => void load(true)}>重试</Button> : null}
              {url && !error ? <Button variant="outline" onClick={() => setZoom(!zoom)}>{zoom ? '适应窗口' : '原始尺寸'}</Button> : null}
              <Button disabled={downloadBusy} onClick={download}><Download data-icon="inline-start" />下载图片</Button>
            </div>
          </DialogContent>
        </Dialog>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={attachment.filename}>{attachment.filename}</p>
          <p className="text-xs text-muted-foreground">{size}</p>
          {attachment.inline ? <Badge variant="secondary">正文图片</Badge> : null}
        </div>
        <Button variant="ghost" size="icon" disabled={downloadBusy} onClick={download} aria-label={`下载 ${attachment.filename}`}>
          {downloadBusy ? <Loader2 className="animate-spin" /> : <Download />}
        </Button>
      </div>
      {image ? <Button variant="ghost" size="sm" onClick={() => { setOpen(true); void load(); }}>查看图片</Button> : null}
      {error && !open ? <p className="text-xs text-muted-foreground">预览暂不可用，点击查看可重试；文件仍可下载。</p> : null}
    </div>
  );
}
