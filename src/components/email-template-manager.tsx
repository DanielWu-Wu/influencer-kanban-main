'use client';

import { useState } from 'react';
import { EmailTemplate } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Mail, Copy, Check, Edit2, Plus, FileText, 
  Clock, ArrowRight, Gift, Heart
} from 'lucide-react';

interface EmailTemplateManagerProps {
  templates: EmailTemplate[];
  onCopy: (content: string) => void;
  onAdd?: (template: Omit<EmailTemplate, 'id'>) => void;
  onUpdate?: (id: string, template: Partial<EmailTemplate>) => void;
}

const TEMPLATE_ICONS: Record<string, React.ReactNode> = {
  cold: <Mail className="w-4 h-4" />,
  follow_up_1: <Clock className="w-4 h-4" />,
  follow_up_2: <Clock className="w-4 h-4" />,
  follow_up_3: <Clock className="w-4 h-4" />,
  care: <Heart className="w-4 h-4" />,
  thank: <Gift className="w-4 h-4" />,
  custom: <FileText className="w-4 h-4" />,
};

const TEMPLATE_COLORS: Record<string, string> = {
  cold: 'bg-blue-100 text-blue-800',
  follow_up_1: 'bg-yellow-100 text-yellow-800',
  follow_up_2: 'bg-orange-100 text-orange-800',
  follow_up_3: 'bg-red-100 text-red-800',
  care: 'bg-pink-100 text-pink-800',
  thank: 'bg-green-100 text-green-800',
  custom: 'bg-purple-100 text-purple-800',
};

export function EmailTemplateManager({ templates, onCopy, onAdd, onUpdate }: EmailTemplateManagerProps) {
  const [selectedTemplate, setSelectedTemplate] = useState<EmailTemplate | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<EmailTemplate | null>(null);

  const handleCopy = (template: EmailTemplate, type: 'subject' | 'content' | 'all') => {
    let text = '';
    if (type === 'subject') {
      text = template.subject;
    } else if (type === 'content') {
      text = template.content;
    } else {
      text = `主题: ${template.subject}\n\n${template.content}`;
    }
    onCopy(text);
    setCopiedId(template.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // 替换变量为示例值
  const previewTemplate = (template: EmailTemplate) => {
    let content = template.content;
    const exampleValues: Record<string, string> = {
      '品牌名': 'TechGear Pro',
      '频道名': 'Tech Review',
      '红人名': 'John Smith',
      '内容风格': '科技评测',
      '代表作品': 'iPhone 深度测评',
      '产品名': '无线蓝牙耳机 X1',
      '产品价值': '$99',
      '发送人名': '小明',
    };
    
    template.variables.forEach(v => {
      const regex = new RegExp(`\\{${v}\\}`, 'g');
      content = content.replace(regex, exampleValues[v] || `[${v}]`);
    });
    
    let subject = template.subject;
    template.variables.forEach(v => {
      const regex = new RegExp(`\\{${v}\\}`, 'g');
      subject = subject.replace(regex, exampleValues[v] || `[${v}]`);
    });
    
    return { subject, content };
  };

  return (
    <div className="h-full flex flex-col">
      <Tabs defaultValue="all" className="flex-1 flex flex-col">
        <TabsList className="grid grid-cols-4 w-full">
          <TabsTrigger value="all">全部</TabsTrigger>
          <TabsTrigger value="cold">冷开发信</TabsTrigger>
          <TabsTrigger value="follow">跟进</TabsTrigger>
          <TabsTrigger value="care">关怀</TabsTrigger>
        </TabsList>

        <ScrollArea className="flex-1 mt-4">
          <TabsContent value="all" className="m-0 space-y-3">
            {templates.map(template => (
              <TemplateCard
                key={template.id}
                template={template}
                onSelect={() => {
                  setSelectedTemplate(template);
                  setShowPreview(true);
                }}
                onCopy={handleCopy}
                copiedId={copiedId}
              />
            ))}
          </TabsContent>

          <TabsContent value="cold" className="m-0 space-y-3">
            {templates.filter(t => t.type === 'cold').map(template => (
              <TemplateCard
                key={template.id}
                template={template}
                onSelect={() => {
                  setSelectedTemplate(template);
                  setShowPreview(true);
                }}
                onCopy={handleCopy}
                copiedId={copiedId}
              />
            ))}
          </TabsContent>

          <TabsContent value="follow" className="m-0 space-y-3">
            {templates.filter(t => ['follow_up_1', 'follow_up_2', 'follow_up_3'].includes(t.type)).map(template => (
              <TemplateCard
                key={template.id}
                template={template}
                onSelect={() => {
                  setSelectedTemplate(template);
                  setShowPreview(true);
                }}
                onCopy={handleCopy}
                copiedId={copiedId}
              />
            ))}
          </TabsContent>

          <TabsContent value="care" className="m-0 space-y-3">
            {templates.filter(t => ['care', 'thank', 'inquiry', 'shipping'].includes(t.type)).map(template => (
              <TemplateCard
                key={template.id}
                template={template}
                onSelect={() => {
                  setSelectedTemplate(template);
                  setShowPreview(true);
                }}
                onCopy={handleCopy}
                copiedId={copiedId}
              />
            ))}
          </TabsContent>
        </ScrollArea>
      </Tabs>

      {/* 预览弹窗 */}
      <Dialog open={showPreview} onOpenChange={setShowPreview}>
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
                <Label className="text-gray-500">主题</Label>
                <p className="mt-1 p-3 bg-gray-50 rounded-md">
                  {previewTemplate(selectedTemplate).subject}
                </p>
              </div>
              
              <div>
                <Label className="text-gray-500">正文</Label>
                <pre className="mt-1 p-4 bg-gray-50 rounded-md whitespace-pre-wrap text-sm font-sans">
                  {previewTemplate(selectedTemplate).content}
                </pre>
              </div>

              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">可用变量:</Badge>
                {selectedTemplate.variables.map(v => (
                  <Badge key={v} variant="secondary">{`{${v}}`}</Badge>
                ))}
              </div>
            </div>
          )}

          <DialogFooter className="flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => handleCopy(selectedTemplate!, 'subject')}
            >
              <Copy className="w-4 h-4 mr-2" />
              复制主题
            </Button>
            <Button
              variant="outline"
              onClick={() => handleCopy(selectedTemplate!, 'content')}
            >
              <Copy className="w-4 h-4 mr-2" />
              复制正文
            </Button>
            <Button onClick={() => handleCopy(selectedTemplate!, 'all')}>
              <Copy className="w-4 h-4 mr-2" />
              复制全部
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TemplateCard({ 
  template, 
  onSelect, 
  onCopy, 
  copiedId 
}: { 
  template: EmailTemplate;
  onSelect: () => void;
  onCopy: (t: EmailTemplate, type: 'subject' | 'content' | 'all') => void;
  copiedId: string | null;
}) {
  return (
    <div 
      className="bg-white rounded-lg border p-4 hover:shadow-md transition-shadow cursor-pointer"
      onClick={onSelect}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {TEMPLATE_ICONS[template.type]}
            <h4 className="font-medium">{template.name}</h4>
            {template.isDefault && (
              <Badge variant="secondary" className="text-xs">默认</Badge>
            )}
          </div>
          <p className="text-sm text-gray-500 mt-1 truncate">
            {template.subject}
          </p>
        </div>
        <Badge className={`${TEMPLATE_COLORS[template.type]} flex-shrink-0`}>
          {template.type === 'cold' && '开发信'}
          {template.type === 'follow_up_1' && '跟进1'}
          {template.type === 'follow_up_2' && '跟进2'}
          {template.type === 'follow_up_3' && '跟进3'}
          {template.type === 'care' && '关怀'}
          {template.type === 'thank' && '感谢'}
          {template.type === 'custom' && '自定义'}
        </Badge>
      </div>
      
      <div className="mt-3 flex items-center gap-2" onClick={e => e.stopPropagation()}>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onCopy(template, 'all')}
        >
          {copiedId === template.id ? (
            <><Check className="w-4 h-4 mr-1 text-green-500" /> 已复制</>
          ) : (
            <><Copy className="w-4 h-4 mr-1" /> 复制</>
          )}
        </Button>
      </div>
    </div>
  );
}
