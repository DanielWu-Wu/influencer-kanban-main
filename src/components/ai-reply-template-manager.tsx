'use client';

import { useEffect, useMemo, useState } from 'react';
import { FilePenLine, FileText, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { isBuiltInAIReplyTemplate, type AIReplyTemplate } from '@/lib/ai-reply-templates';
import type { EmailTemplate } from '@/lib/types';

type TemplateForm = {
  name: string;
  description: string;
  requiredInfo: string;
  content: string;
  rules: string;
  defaultTone: 'friendly' | 'formal' | 'casual';
};

const EMPTY_FORM: TemplateForm = {
  name: '',
  description: '',
  requiredInfo: '',
  content: '',
  rules: '',
  defaultTone: 'friendly',
};

function formFromTemplate(template: AIReplyTemplate, copy = false): TemplateForm {
  return {
    name: copy ? `${template.name}（副本）` : template.name,
    description: template.description,
    requiredInfo: template.requiredInfo.join('\n'),
    content: template.content,
    rules: template.rules.join('\n'),
    defaultTone: template.defaultTone,
  };
}

function toTemplate(form: TemplateForm): Omit<EmailTemplate, 'id'> {
  return {
    name: form.name.trim(),
    type: 'custom',
    subject: '',
    description: form.description.trim(),
    requiredInfo: form.requiredInfo.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
    content: form.content.trim(),
    rules: form.rules.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
    variables: [],
    isDefault: false,
    aiEnabled: true,
    defaultTone: form.defaultTone,
  };
}

export function AIReplyTemplateManager({
  open,
  onOpenChange,
  templates,
  onAdd,
  onUpdate,
  onDelete,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templates: AIReplyTemplate[];
  onAdd: (template: Omit<EmailTemplate, 'id'>) => EmailTemplate;
  onUpdate: (id: string, updates: Partial<EmailTemplate>) => void;
  onDelete: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<TemplateForm>(EMPTY_FORM);
  const [error, setError] = useState('');
  const isEditing = Boolean(editingId);
  const editingTemplate = useMemo(
    () => templates.find((template) => template.id === editingId),
    [editingId, templates],
  );

  useEffect(() => {
    if (!open) {
      setEditingId(null);
      setForm(EMPTY_FORM);
      setError('');
    }
  }, [open]);

  const startCreate = (source?: AIReplyTemplate) => {
    setEditingId('__new__');
    setForm(source ? formFromTemplate(source, true) : EMPTY_FORM);
    setError('');
  };

  const startEdit = (template: AIReplyTemplate) => {
    setEditingId(template.id);
    setForm(formFromTemplate(template));
    setError('');
  };

  const save = () => {
    const next = toTemplate(form);
    if (!next.name || !next.description || !next.content || !next.rules?.length) {
      setError('请填写模板名称、用途、参考结构和至少一条规则。');
      return;
    }
    if (editingId && editingId !== '__new__' && editingTemplate) {
      onUpdate(editingId, next);
      onSelect(editingId);
    } else {
      const created = onAdd(next);
      onSelect(created.id);
    }
    setEditingId(null);
    setForm(EMPTY_FORM);
    setError('');
  };

  const remove = (template: AIReplyTemplate) => {
    if (!window.confirm(`确定删除自定义模板“${template.name}”吗？`)) return;
    onDelete(template.id);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] max-w-3xl flex-col overflow-hidden">
        <DialogHeader className="shrink-0 pr-6">
          <DialogTitle>管理 AI 回复模板</DialogTitle>
          <DialogDescription>
            内置模板不可直接修改。点击编辑图标可创建个人版本后调整，个人模板仅保存在当前账号。
          </DialogDescription>
        </DialogHeader>

        {isEditing ? (
          <div
            data-testid="ai-template-scroll-body"
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-3"
          >
            <div className="grid gap-4 py-1">
              <div className="grid gap-2">
                <Label htmlFor="ai-template-name">模板名称</Label>
                <Input
                  id="ai-template-name"
                  value={form.name}
                  onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder="例如：预算协商模板"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="ai-template-description">适用场景</Label>
                <Input
                  id="ai-template-description"
                  value={form.description}
                  onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                  placeholder="这份模板帮助解决什么邮件场景"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="ai-template-required">建议提供的信息</Label>
                <Textarea
                  id="ai-template-required"
                  value={form.requiredInfo}
                  onChange={(event) => setForm((current) => ({ ...current, requiredInfo: event.target.value }))}
                  placeholder={'每行一项，例如：\n目标预算\n可接受的合作形式'}
                  className="min-h-24"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="ai-template-content">邮件参考结构</Label>
                <Textarea
                  id="ai-template-content"
                  value={form.content}
                  onChange={(event) => setForm((current) => ({ ...current, content: event.target.value }))}
                  placeholder="说明邮件应该按什么顺序表达哪些内容"
                  className="min-h-28"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="ai-template-rules">必须遵守的规则</Label>
                <Textarea
                  id="ai-template-rules"
                  value={form.rules}
                  onChange={(event) => setForm((current) => ({ ...current, rules: event.target.value }))}
                  placeholder={'每行一条，例如：\n不要承诺未确认的发布时间\n缺少金额时不要猜测'}
                  className="min-h-28"
                />
              </div>
              <div className="grid gap-2">
                <Label>默认语气</Label>
                <Select
                  value={form.defaultTone}
                  onValueChange={(value) => setForm((current) => ({
                    ...current,
                    defaultTone: value as TemplateForm['defaultTone'],
                  }))}
                >
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="friendly">自然友好</SelectItem>
                    <SelectItem value="formal">正式专业</SelectItem>
                    <SelectItem value="casual">轻松亲切</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
          </div>
        ) : (
          <div
            data-testid="ai-template-scroll-body"
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-3"
          >
            <div className="grid gap-2">
              {templates.map((template) => {
                const builtIn = isBuiltInAIReplyTemplate(template.id);
                return (
                  <div key={template.id} className="flex items-start gap-3 rounded-xl border bg-white/72 p-3">
                    <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <FileText className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-medium">{template.name}</p>
                        <span className="text-xs text-muted-foreground">{builtIn ? '内置' : '个人'}</span>
                      </div>
                      <p className="mt-1 text-sm leading-5 text-muted-foreground">{template.description}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        title={builtIn ? '基于此模板创建个人版本' : '基于此模板新建个人版本'}
                        aria-label={builtIn ? `基于“${template.name}”创建个人版本` : `基于“${template.name}”新建个人版本`}
                        onClick={() => startCreate(template)}
                      >
                        <FilePenLine />
                      </Button>
                      {!builtIn && (
                        <>
                          <Button variant="ghost" size="icon" title="编辑模板" onClick={() => startEdit(template)}>
                            <Pencil />
                          </Button>
                          <Button variant="ghost" size="icon" title="删除模板" onClick={() => remove(template)}>
                            <Trash2 />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <DialogFooter className="shrink-0 border-t border-border/70 pt-4">
          {isEditing ? (
            <>
              <Button variant="outline" onClick={() => setEditingId(null)}>返回列表</Button>
              <Button onClick={save}>保存模板</Button>
            </>
          ) : (
            <Button onClick={() => startCreate()}><Plus />新建个人模板</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
