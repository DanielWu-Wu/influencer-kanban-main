'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { GmailThread } from '@/lib/types';
import { useEmailAISuggestions, useEmailDrafts, useSettings } from '@/lib/data';
import { 
  X, Sparkles, Send, Copy, Check, RefreshCw,
  Lightbulb, ChevronDown, ChevronUp, Loader2,
  ArrowRight, Globe, AlertCircle
} from 'lucide-react';

interface EmailComposerProps {
  thread: GmailThread;
  mode: 'compose' | 'ai';
  onClose: () => void;
  initialMessage?: string;
}

export function EmailComposer({ thread, mode, onClose, initialMessage }: EmailComposerProps) {
  const { addSuggestion, approveSuggestion } = useEmailAISuggestions();
  const { addDraft } = useEmailDrafts();
  const { settings } = useSettings();
  
  const [replyContent, setReplyContent] = useState(initialMessage || '');
  const [userIdeas, setUserIdeas] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiSuggestions, setAiSuggestions] = useState<{
    suggestedReply: string;
    translatedReply: string;
    tone: 'formal' | 'casual' | 'friendly';
    keyPoints: string[];
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [showIdeasTips, setShowIdeasTips] = useState(false);

  // 获取最后一封邮件的语言
  const lastMessage = thread.messages[thread.messages.length - 1];
  const detectLanguage = (text: string): string => {
    if (/[\u4e00-\u9fa5]/.test(text)) return 'zh';
    if (/[\u3040-\u309f\u30a0-\u30ff]/.test(text)) return 'ja';
    if (/[\u0400-\u04ff]/.test(text)) return 'ru';
    if (/[\u0600-\u06ff]/.test(text)) return 'ar';
    if (/\b(der|die|das|und|ich|Sie|mit|für)\b/i.test(text)) return 'de';
    if (/\b(le|la|les|de|des|et|est|un|une)\b/i.test(text)) return 'fr';
    if (/\b(el|la|los|las|de|en|y|que|por)\b/i.test(text)) return 'es';
    if (/\b(il|lo|la|di|che|un|una|per|con)\b/i.test(text)) return 'it';
    if (/\b(de|het|een|en|van|in|dat|op|voor)\b/i.test(text)) return 'nl';
    return 'en';
  };
  const detectedLang = detectLanguage(lastMessage.body);

  // 语言显示
  const langNames: Record<string, string> = {
    en: '英语', zh: '中文', ja: '日语', de: '德语',
    fr: '法语', es: '西班牙语', it: '意大利语', ru: '俄语',
    ar: '阿拉伯语', nl: '荷兰语',
  };

  // AI 生成回复建议（调用真实 API）
  const generateAISuggestion = async () => {
    if (!userIdeas.trim()) return;
    
    setAiLoading(true);
    setAiError('');
    
    try {
      const response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadSubject: thread.subject,
          lastMessage: lastMessage.body,
          userIdeas: userIdeas,
          targetLang: detectedLang,
          customPrompt: settings.aiEmailPrompt || '',
          modelProvider: settings.modelProvider || 'builtin',
          customApiUrl: settings.customApiUrl || '',
          customApiKey: settings.customApiKey || '',
          customModelName: settings.customModelName || '',
        }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'AI 生成失败');
      }

      const suggestion = result.data;
      setAiSuggestions(suggestion);
      
      // 保存到历史建议
      addSuggestion({
        threadId: thread.id,
        messageId: lastMessage.id,
        suggestedReply: suggestion.suggestedReply,
        translatedReply: suggestion.translatedReply,
        tone: suggestion.tone,
        keyPoints: suggestion.keyPoints,
        status: 'pending',
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'AI 生成失败，请稍后重试';
      setAiError(msg);
      console.error('AI 生成失败:', error);
    } finally {
      setAiLoading(false);
    }
  };

  // 保存到草稿箱
  const saveToDrafts = () => {
    const finalReply = replyContent || aiSuggestions?.suggestedReply || '';
    if (!finalReply) return;

    const recipient = lastMessage.from;
    
    addDraft({
      to: recipient,
      subject: `Re: ${thread.subject}`,
      body: finalReply,
    });

    if (aiSuggestions) {
      approveSuggestion(aiSuggestions.suggestedReply);
    }

    onClose();
  };

  // 复制到剪贴板
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getReplyLanguage = () => {
    return langNames[detectedLang] || '英语';
  };

  return (
    <div className="space-y-4">
      {/* 模式切换 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">
            <Globe className="w-3 h-3 mr-1" />
            检测到 {getReplyLanguage()}
          </Badge>
          {mode === 'ai' && (
            <Badge variant="secondary" className="text-xs bg-primary/10 text-primary">
              <Sparkles className="w-3 h-3 mr-1" />
              {settings.modelProvider === 'custom' ? (settings.customModelName || '自定义 AI') : 'DeepSeek AI'}
            </Badge>
          )}
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* AI 辅助模式 */}
      {mode === 'ai' && !aiSuggestions && (
        <div className="space-y-4">
          <div className="rounded-xl bg-primary/5 p-4">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Sparkles className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-foreground mb-2">
                  {settings.modelProvider === 'custom' ? (settings.customModelName || '自定义 AI') : 'DeepSeek AI'} 会根据你的想法生成回复邮件
                </p>
                <p className="text-xs text-muted-foreground mb-3">
                  请用中文描述你想说的内容，AI 会帮你生成一封{getReplyLanguage()}的回复邮件，并提供中文对照方便你检查。
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">你的想法</label>
              <Button 
                variant="ghost" 
                size="sm" 
                className="h-6 text-xs"
                onClick={() => setShowIdeasTips(!showIdeasTips)}
              >
                {showIdeasTips ? '收起提示' : '查看提示'}
                {showIdeasTips ? <ChevronUp className="w-3 h-3 ml-1" /> : <ChevronDown className="w-3 h-3 ml-1" />}
              </Button>
            </div>
            
            {showIdeasTips && (
              <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground space-y-1">
                <p>💡 你可以这样描述：</p>
                <p>• "感谢你的回复，告知合作价格可以接受"</p>
                <p>• "表示对合作感兴趣，询问具体合作细节"</p>
                <p>• "友好地拒绝，说明预算有限，希望保持联系"</p>
              </div>
            )}
            
            <Textarea
              value={userIdeas}
              onChange={(e) => setUserIdeas(e.target.value)}
              placeholder="用中文描述你想说什么..."
              className="min-h-[100px] resize-none"
            />
          </div>

          {aiError && (
            <div className="rounded-lg bg-destructive/10 p-3 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
              <p className="text-sm text-destructive">{aiError}</p>
            </div>
          )}

          <Button 
            className="w-full"
            onClick={generateAISuggestion}
            disabled={!userIdeas.trim() || aiLoading}
          >
            {aiLoading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {settings.modelProvider === 'custom' ? (settings.customModelName || 'AI') : 'DeepSeek AI'} 正在生成回复...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 mr-2" />
                生成回复邮件
              </>
            )}
          </Button>
        </div>
      )}

      {/* AI 建议展示 */}
      {aiSuggestions && (
        <div className="space-y-4">
          {/* 要点回顾 */}
          {aiSuggestions.keyPoints.length > 0 && (
            <div className="rounded-xl bg-primary/5 p-4">
              <div className="flex items-center gap-2 mb-2">
                <Lightbulb className="w-4 h-4 text-primary" />
                <span className="text-sm font-medium">回复要点</span>
              </div>
              <ul className="space-y-1">
                {aiSuggestions.keyPoints.map((point: string, i: number) => (
                  <li key={i} className="text-xs text-muted-foreground flex items-start gap-2">
                    <span className="text-primary">•</span>
                    {point}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 语气选择 */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">语气：</span>
            <Badge variant="outline" className="text-xs">{aiSuggestions.tone === 'formal' ? '正式' : aiSuggestions.tone === 'casual' ? '轻松' : '友好'}</Badge>
          </div>

          {/* 回复内容 */}
          <div className="space-y-3">
            {/* 原文回复 */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">{getReplyLanguage()} 回复</label>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="h-6 text-xs"
                  onClick={() => copyToClipboard(aiSuggestions.suggestedReply)}
                >
                  {copied ? <Check className="w-3 h-3 mr-1" /> : <Copy className="w-3 h-3 mr-1" />}
                  {copied ? '已复制' : '复制'}
                </Button>
              </div>
              <Textarea
                value={aiSuggestions.suggestedReply}
                onChange={(e) => setAiSuggestions({ ...aiSuggestions, suggestedReply: e.target.value })}
                className="min-h-[150px] resize-none font-mono text-sm"
              />
            </div>

            {/* 中文对照 */}
            <div className="space-y-2">
              <label className="text-sm font-medium">中文对照</label>
              <div className="rounded-xl bg-muted/50 p-4">
                <pre className="whitespace-pre-wrap text-sm text-foreground font-sans">
                  {aiSuggestions.translatedReply}
                </pre>
              </div>
            </div>
          </div>

          {/* 操作按钮 */}
          <div className="flex items-center gap-2">
            <Button 
              variant="outline" 
              className="flex-1"
              onClick={() => {
                setAiSuggestions(null);
                setUserIdeas('');
                setAiError('');
              }}
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              重新生成
            </Button>
            <Button 
              className="flex-1"
              onClick={saveToDrafts}
            >
              <ArrowRight className="w-4 h-4 mr-2" />
              保存到草稿箱
            </Button>
          </div>

          <p className="text-xs text-center text-muted-foreground">
            保存后请前往 Gmail 草稿箱确认并发送
          </p>
        </div>
      )}

      {/* 手动编辑模式 */}
      {mode === 'compose' && !aiSuggestions && (
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">回复内容</label>
            <Textarea
              value={replyContent}
              onChange={(e) => setReplyContent(e.target.value)}
              placeholder={`用${getReplyLanguage()}编写回复内容...`}
              className="min-h-[200px] resize-none"
            />
          </div>
          
          <Button 
            className="w-full"
            onClick={saveToDrafts}
            disabled={!replyContent.trim()}
          >
            <ArrowRight className="w-4 h-4 mr-2" />
            保存到草稿箱
          </Button>
        </div>
      )}
    </div>
  );
}
