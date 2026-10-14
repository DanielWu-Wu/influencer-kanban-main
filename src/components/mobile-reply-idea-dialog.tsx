'use client';

import { useEffect, useRef, type RefObject } from 'react';
import { ArrowLeft, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';

// Uses the composer's existing value/dirty tracking; completing this view only
// dismisses it. Generation, draft saving and sending remain separate actions.
export function MobileReplyIdeaDialog({
  open, onOpenChange, value, onChange, inputRef, recipient, recipientConfirmed, subject, warning,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: string;
  onChange: (value: string) => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  recipient: string;
  recipientConfirmed: boolean;
  subject: string;
  warning?: string;
}) {
  const previousValue = useRef(value);
  useEffect(() => {
    const input = inputRef.current;
    // Background save/analysis renders must not replace an IME's pending DOM
    // text. Apply restored parent text only while this field is still unchanged.
    if (open && input && input.value === previousValue.current) input.value = value;
    previousValue.current = value;
  }, [inputRef, open, value]);
  const complete = () => {
    // Read the DOM too, so a final IME update is kept before unmounting.
    const current = inputRef.current?.value;
    if (current !== undefined && current !== value) onChange(current);
    onOpenChange(false);
  };
  return <Dialog open={open} onOpenChange={(next) => next ? onOpenChange(true) : complete()}>
    <DialogContent className="mobile-reply-idea-dialog flex flex-col gap-0 overflow-hidden p-0" showCloseButton={false}
      onOpenAutoFocus={(event) => { event.preventDefault(); inputRef.current?.focus({ preventScroll: true }); }}>
      <DialogHeader className="mobile-idea-header flex-row items-center gap-2 border-b px-2 py-1 text-left">
        <Button variant="ghost" size="icon" aria-label="返回回复界面，保留想法" onClick={complete}><ArrowLeft /></Button>
        <DialogTitle className="flex-1 text-base">AI 辅助回复</DialogTitle>
        <DialogDescription className="text-xs">填写回复想法</DialogDescription>
      </DialogHeader>
      <details className="mobile-idea-context shrink-0 border-b bg-primary/[0.035] px-3 text-xs">
        <summary className="flex min-h-11 cursor-pointer items-center gap-2">
          <Mail className="size-4 shrink-0 text-primary" />
          <span className={`min-w-0 flex-1 truncate ${recipientConfirmed ? 'text-muted-foreground' : 'text-destructive'}`}>回复给：{recipient || '收件人尚未确认'}{recipient && !recipientConfirmed ? '（待确认）' : ''}</span>
          <span className="shrink-0 text-primary">详情</span>
        </summary>
        <div className="space-y-1 pb-2 [overflow-wrap:anywhere]">
          <p>收件人：{recipient || '发送前需确认'}</p><p>主题：{subject || '(无主题)'}</p>
        </div>
      </details>
      <div className="mobile-idea-body flex min-h-0 flex-1 flex-col gap-2 px-3 py-2">
        <label htmlFor="ai-reply-strategy" className="mobile-idea-label flex shrink-0 items-center justify-between text-sm font-medium">
          回复想法<span className="text-xs font-normal text-muted-foreground">用自己的话写即可</span>
        </label>
        <Textarea ref={inputRef} id="ai-reply-strategy" aria-label="回复想法" defaultValue={value}
          onChange={(event) => onChange(event.target.value)}
          onCompositionEnd={(event) => { if (event.currentTarget.value !== value) onChange(event.currentTarget.value); }}
          placeholder="补充预算、底线、产品安排或需要确认的问题…"
          className="field-sizing-fixed min-h-0 flex-1 resize-none overflow-y-auto text-base leading-relaxed [overflow-wrap:anywhere]" />
        {warning && <p role="status" className="mobile-idea-warning shrink-0 text-xs text-amber-700 [overflow-wrap:anywhere]">{warning}</p>}
      </div>
      <div className="mobile-idea-footer shrink-0 border-t bg-white px-3 py-2">
        <Button className="w-full" onClick={complete}>完成填写</Button>
      </div>
    </DialogContent>
  </Dialog>;
}
