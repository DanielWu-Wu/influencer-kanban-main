'use client';

import { useState } from 'react';
import { EmailTemplate } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Mail, Copy, Check, FileText, Clock, Gift, Heart } from 'lucide-react';

interface EmailTemplateManagerProps {
  templates: EmailTemplate[];
  onCopy: (content: string) => void;
  onAdd?: (template: Omit<EmailTemplate, 'id'>) => void;
  onUpdate?: (id: string, template: Partial<EmailTemplate>) => void;
}

const label = {
  all: '\u5168\u90e8',
  cold: '\u51b7\u5f00\u53d1',
  follow: '\u8ddf\u8fdb',
  care: '\u5173\u6000/\u611f\u8c22',
  subject: '\u4e3b\u9898',
  content: '\u5185\u5bb9',
  variables: '\u53ef\u7528\u53d8\u91cf',
  preview: '\u9884\u89c8',
  copySubject: '\u590d\u5236\u4e3b\u9898',
  copyContent: '\u590d\u5236\u5185\u5bb9',
  copyAll: '\u590d\u5236\u5168\u90e8',
  copied: '\u5df2\u590d\u5236',
  defaultTemplate: '\u9ed8\u8ba4\u6a21\u677f',
};

const TEMPLATE_ICONS: Record<string, React.ReactNode> = {
  cold: <Mail className="w-4 h-4" />,
  follow_up_1: <Clock className="w-4 h-4" />,
  follow_up_2: <Clock className="w-4 h-4" />,
  follow_up_3: <Clock className="w-4 h-4" />,
  inquiry: <Mail className="w-4 h-4" />,
  shipping: <Mail className="w-4 h-4" />,
  care: <Heart className="w-4 h-4" />,
  thank: <Gift className="w-4 h-4" />,
  custom: <FileText className="w-4 h-4" />,
};

const TEMPLATE_COLORS: Record<string, string> = {
  cold: 'bg-blue-100 text-blue-800',
  follow_up_1: 'bg-yellow-100 text-yellow-800',
  follow_up_2: 'bg-orange-100 text-orange-800',
  follow_up_3: 'bg-red-100 text-red-800',
  inquiry: 'bg-purple-100 text-purple-800',
  shipping: 'bg-cyan-100 text-cyan-800',
  care: 'bg-pink-100 text-pink-800',
  thank: 'bg-green-100 text-green-800',
  custom: 'bg-slate-100 text-slate-800',
};

const exampleValues: Record<string, string> = {
  brandName: 'BrandName',
  channelName: 'Tech Review Lab',
  creatorName: 'Alex',
  senderName: 'Daniel',
  channelTopic: 'smart home product reviews',
  personalizedReason: 'your audience cares about practical, easy-to-understand product tests',
  productName: 'Smart Home Camera',
  targetBudget: '$100',
};

export function EmailTemplateManager({ templates, onCopy }: EmailTemplateManagerProps) {
  const [selectedTemplate, setSelectedTemplate] = useState<EmailTemplate | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopy = (template: EmailTemplate, type: 'subject' | 'content' | 'all') => {
    const preview = previewTemplate(template);
    const text =
      type === 'subject'
        ? preview.subject
        : type === 'content'
          ? preview.content
          : `${label.subject}: ${preview.subject}\n\n${preview.content}`;

    onCopy(text);
    setCopiedId(`${template.id}-${type}`);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const renderCards = (items: EmailTemplate[]) => (
    <div className="space-y-3">
      {items.map((template) => (
        <TemplateCard
          key={template.id}
          template={template}
          copiedId={copiedId}
          onSelect={() => setSelectedTemplate(template)}
          onCopy={handleCopy}
        />
      ))}
    </div>
  );

  return (
    <div className="h-full flex flex-col">
      <Tabs defaultValue="all" className="flex-1 flex flex-col">
        <TabsList className="grid grid-cols-4 w-full">
          <TabsTrigger value="all">{label.all}</TabsTrigger>
          <TabsTrigger value="cold">{label.cold}</TabsTrigger>
          <TabsTrigger value="follow">{label.follow}</TabsTrigger>
          <TabsTrigger value="care">{label.care}</TabsTrigger>
        </TabsList>

        <ScrollArea className="flex-1 mt-4">
          <TabsContent value="all" className="m-0">
            {renderCards(templates)}
          </TabsContent>
          <TabsContent value="cold" className="m-0">
            {renderCards(templates.filter((template) => template.type === 'cold'))}
          </TabsContent>
          <TabsContent value="follow" className="m-0">
            {renderCards(templates.filter((template) => ['follow_up_1', 'follow_up_2', 'follow_up_3'].includes(template.type)))}
          </TabsContent>
          <TabsContent value="care" className="m-0">
            {renderCards(templates.filter((template) => ['care', 'thank', 'inquiry', 'shipping'].includes(template.type)))}
          </TabsContent>
        </ScrollArea>
      </Tabs>

      <Dialog open={Boolean(selectedTemplate)} onOpenChange={(open) => !open && setSelectedTemplate(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selectedTemplate && TEMPLATE_ICONS[selectedTemplate.type]}
              {selectedTemplate?.name}
            </DialogTitle>
          </DialogHeader>

          {selectedTemplate && (
            <div className="flex-1 overflow-y-auto space-y-4">
              <div>
                <Label className="text-muted-foreground">{label.subject}</Label>
                <p className="mt-1 p-3 bg-muted rounded-md">{previewTemplate(selectedTemplate).subject}</p>
              </div>
              <div>
                <Label className="text-muted-foreground">{label.content}</Label>
                <pre className="mt-1 p-3 bg-muted rounded-md whitespace-pre-wrap text-sm font-sans">
                  {previewTemplate(selectedTemplate).content}
                </pre>
              </div>
              <div>
                <Label className="text-muted-foreground">{label.variables}</Label>
                <div className="flex flex-wrap gap-2 mt-2">
                  {selectedTemplate.variables.map((variable) => (
                    <Badge key={variable} variant="secondary">
                      {variable}
                    </Badge>
                  ))}
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <Button variant="outline" onClick={() => handleCopy(selectedTemplate, 'subject')}>
                  <Copy className="w-4 h-4 mr-2" />
                  {label.copySubject}
                </Button>
                <Button variant="outline" onClick={() => handleCopy(selectedTemplate, 'content')}>
                  <Copy className="w-4 h-4 mr-2" />
                  {label.copyContent}
                </Button>
                <Button onClick={() => handleCopy(selectedTemplate, 'all')}>
                  <Copy className="w-4 h-4 mr-2" />
                  {label.copyAll}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TemplateCard({
  template,
  copiedId,
  onSelect,
  onCopy,
}: {
  template: EmailTemplate;
  copiedId: string | null;
  onSelect: () => void;
  onCopy: (template: EmailTemplate, type: 'subject' | 'content' | 'all') => void;
}) {
  return (
    <div className="p-4 rounded-xl border bg-card hover:shadow-sm transition-shadow">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs ${TEMPLATE_COLORS[template.type] || TEMPLATE_COLORS.custom}`}>
              {TEMPLATE_ICONS[template.type] || TEMPLATE_ICONS.custom}
              {template.name}
            </span>
            {template.isDefault && <Badge variant="secondary">{label.defaultTemplate}</Badge>}
          </div>
          <p className="mt-3 text-sm font-medium truncate">{template.subject}</p>
          <p className="mt-1 text-sm text-muted-foreground line-clamp-2 whitespace-pre-wrap">{template.content}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button size="sm" variant="outline" onClick={onSelect}>
            {label.preview}
          </Button>
          <Button size="sm" onClick={() => onCopy(template, 'all')}>
            {copiedId === `${template.id}-all` ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          </Button>
        </div>
      </div>
    </div>
  );
}

function previewTemplate(template: EmailTemplate) {
  let subject = template.subject;
  let content = template.content;

  template.variables.forEach((variable) => {
    const regex = new RegExp(`\\{${variable}\\}`, 'g');
    const value = exampleValues[variable] || `[${variable}]`;
    subject = subject.replace(regex, value);
    content = content.replace(regex, value);
  });

  return { subject, content };
}
