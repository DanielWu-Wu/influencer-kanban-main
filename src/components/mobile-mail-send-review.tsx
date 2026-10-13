'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { emailHtmlToText } from '@/lib/email-content';
import { useMobileLayout } from '@/lib/use-mobile-layout';

type Review = { from: string; to: string; subject: string; html: string; attachmentNames: string[]; identity: string };

// The review changes presentation only; the existing sender owns validation,
// transport, countdown, cancellation and recovery.
export function useMobileMailSendReview({ onSend, blocked, ...current }: Review & {
  blocked: boolean;
  onSend: () => Promise<void>;
}) {
  const mobile = useMobileLayout();
  const [review, setReview] = useState<Review | null>(null);
  const submitting = useRef(false);
  const changed = review !== null && JSON.stringify(review) !== JSON.stringify(current);
  const requestSend = () => {
    if (blocked || submitting.current) return;
    if (mobile) setReview(current);
    else void onSend();
  };
  const confirm = async () => {
    if (!review || changed || blocked || submitting.current) return;
    submitting.current = true;
    setReview(null);
    try { await onSend(); } finally { submitting.current = false; }
  };
  const reviewDialog = (
    <Dialog open={review !== null} onOpenChange={(open) => { if (!open) setReview(null); }}>
      <DialogContent className="mobile-mail-review flex flex-col gap-3 p-4">
        <DialogHeader>
          <DialogTitle>确认发送邮件</DialogTitle>
          <DialogDescription>请核对发送邮箱、收件人和最终正文。确认后沿用现有发送倒计时。</DialogDescription>
        </DialogHeader>
        {review && <>
          <dl className="space-y-2 break-all rounded-lg bg-muted/40 p-3 text-sm">
            <div><dt className="text-muted-foreground">发送邮箱</dt><dd>{review.from}</dd></div>
            <div><dt className="text-muted-foreground">收件人</dt><dd>{review.to}</dd></div>
            <div><dt className="text-muted-foreground">主题</dt><dd>{review.subject}</dd></div>
            <div><dt className="text-muted-foreground">附件</dt><dd>{review.attachmentNames.length ? review.attachmentNames.join('、') : '无'}</dd></div>
          </dl>
          <div className="min-h-20 max-h-[35dvh] overflow-y-auto whitespace-pre-wrap break-words rounded-lg border p-3 text-sm leading-6" aria-label="最终发送正文">{emailHtmlToText(review.html)}</div>
          {changed && <p role="alert" className="text-sm text-amber-700">邮件内容或对象已变化，请返回编辑器重新审核。</p>}
        </>}
        <DialogFooter>
          <Button variant="outline" onClick={() => setReview(null)}>返回编辑</Button>
          <Button disabled={blocked || changed} onClick={() => void confirm()}>确认发送</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
  return { requestSend, reviewDialog };
}
