'use client';

import { useEffect, useState } from 'react';
import { Check, Mail, Pencil, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  isIgnoredGmailContactEmail,
  normalizeThreadContactEmail,
} from '@/lib/gmail-thread-contact';
import { parseGmailAddresses, type GmailReplyTarget } from '@/lib/gmail-reply-target';

const SOURCE_LABELS: Record<GmailReplyTarget['recipientCandidates'][number]['source'], string> = {
  'reply-to': '邮件 Reply-To',
  from: '邮件发件人',
  to: '原邮件收件人',
  cc: '原邮件抄送人',
  feishu: '飞书匹配邮箱',
  manual: '手动填写',
};

export function GmailReplyTargetBar({
  target,
  ownEmail,
  onRecipientChange,
  onChooseMessage,
}: {
  target: GmailReplyTarget;
  ownEmail?: string;
  onRecipientChange: (email: string) => void;
  onChooseMessage: () => void;
}) {
  const [recipientOpen, setRecipientOpen] = useState(false);
  const [manualEmail, setManualEmail] = useState('');
  const [manualError, setManualError] = useState('');
  const sender = parseGmailAddresses(target.message.from)[0];

  useEffect(() => {
    setManualEmail('');
    setManualError('');
    setRecipientOpen(false);
  }, [target.messageId]);

  const selectManualRecipient = () => {
    const email = normalizeThreadContactEmail(manualEmail);
    const normalizedOwn = normalizeThreadContactEmail(ownEmail);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setManualError('请输入完整有效的邮箱地址。');
      return;
    }
    if (email === normalizedOwn) {
      setManualError('回复收件人不能是当前 Gmail 账号。');
      return;
    }
    if (isIgnoredGmailContactEmail(email)) {
      setManualError('系统通知邮箱不能作为回复收件人。');
      return;
    }
    onRecipientChange(email);
    setRecipientOpen(false);
  };

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border/55 bg-primary/[0.035] px-4 py-2.5">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Mail />
      </span>
      <div className="min-w-48 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-medium">
            正在基于：{sender?.name || sender?.email || target.message.from || '所选邮件'}
          </p>
          <Badge variant="outline">
            {target.direction === 'outgoing' ? '继续沟通' : '回复来信'}
          </Badge>
        </div>
        <p className="truncate text-xs text-muted-foreground">
          {target.subject} · {new Date(target.date).toLocaleString('zh-CN')}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className={target.recipientConfirmed ? 'text-xs text-muted-foreground' : 'text-xs text-destructive'}>
          收件人：{target.recipientEmail || '保存草稿前需确认'}
        </span>
        <Popover open={recipientOpen} onOpenChange={setRecipientOpen}>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" size="sm">
              <Users data-icon="inline-start" />
              {target.recipientEmail ? '更换收件人' : '选择收件人'}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="flex w-80 flex-col gap-3">
            <div>
              <p className="text-sm font-medium">确认最终回复对象</p>
              <p className="text-xs text-muted-foreground">AI 可以先生成；只有保存草稿或发送时必须确认。</p>
            </div>
            {target.recipientCandidates.length > 0 ? (
              <div className="flex flex-col gap-1">
                {target.recipientCandidates.map((candidate) => (
                  <Button
                    key={`${candidate.source}-${candidate.email}`}
                    type="button"
                    variant="ghost"
                    className="h-auto justify-start px-2 py-2 text-left"
                    onClick={() => {
                      onRecipientChange(candidate.email);
                      setRecipientOpen(false);
                    }}
                  >
                    {candidate.email === target.recipientEmail ? <Check data-icon="inline-start" /> : <Mail data-icon="inline-start" />}
                    <span className="min-w-0">
                      <span className="block truncate text-sm">{candidate.name || candidate.email}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {candidate.email} · {SOURCE_LABELS[candidate.source]}
                      </span>
                    </span>
                  </Button>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">这封邮件没有可自动采用的外部联系人。</p>
            )}
            <Field data-invalid={Boolean(manualError)}>
              <FieldLabel htmlFor={`manual-recipient-${target.messageId}`}>手动填写邮箱</FieldLabel>
              <Input
                id={`manual-recipient-${target.messageId}`}
                type="email"
                value={manualEmail}
                aria-invalid={Boolean(manualError)}
                placeholder="name@example.com"
                onChange={(event) => {
                  setManualEmail(event.target.value);
                  setManualError('');
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') selectManualRecipient();
                }}
              />
              <FieldDescription>{manualError || '手动填写后将作为最终收件人，不会自动群发。'}</FieldDescription>
            </Field>
            <Button type="button" size="sm" disabled={!manualEmail.trim()} onClick={selectManualRecipient}>
              确认手动邮箱
            </Button>
          </PopoverContent>
        </Popover>
        <Button type="button" variant="ghost" size="sm" onClick={onChooseMessage}>
          <Pencil data-icon="inline-start" />
          更换邮件
        </Button>
      </div>
    </div>
  );
}
