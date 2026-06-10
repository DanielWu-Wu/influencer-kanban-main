'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { GmailThread, GmailMessage } from '@/lib/types';
import { useGmailAuth } from '@/lib/data';
import { 
  Search, RefreshCw, Mail, MailOpen, Clock, 
  User, ChevronRight, Inbox, AlertCircle, ExternalLink,
  Settings, Trash2, MoreHorizontal, Star, StarOff, Loader2
} from 'lucide-react';

interface GmailInboxProps {
  onSelectThread: (thread: GmailThread) => void;
  selectedThreadId?: string;
}

// 从 Gmail API 响应中解析邮件头
function getHeader(headers: { name: string; value: string }[], name: string): string {
  const header = headers?.find(h => h.name.toLowerCase() === name.toLowerCase());
  return header?.value || '';
}

// 安全获取嵌套属性
// 从 Gmail API 响应中解析邮件正文（纯文本 + HTML + 嵌套 multipart）
function getBodyData(payload: Record<string, unknown>): string {
  const body = payload?.body as Record<string, unknown> | undefined;
  if (body?.data && typeof body.data === 'string') {
    return atob(body.data.replace(/-/g, '+').replace(/_/g, '/'));
  }
  const parts = payload?.parts as Record<string, unknown>[] | undefined;
  if (parts) {
    // 优先找 text/plain
    const textPart = parts.find((p) => p.mimeType === 'text/plain');
    if (textPart) {
      const textBody = textPart.body as Record<string, unknown> | undefined;
      if (textBody?.data && typeof textBody.data === 'string') {
        return atob(textBody.data.replace(/-/g, '+').replace(/_/g, '/'));
      }
    }
    // 其次找 text/html
    const htmlPart = parts.find((p) => p.mimeType === 'text/html');
    if (htmlPart) {
      const htmlBody = htmlPart.body as Record<string, unknown> | undefined;
      if (htmlBody?.data && typeof htmlBody.data === 'string') {
        return atob(htmlBody.data.replace(/-/g, '+').replace(/_/g, '/'));
      }
    }
    // 递归查找嵌套 multipart
    for (const part of parts) {
      const result = getBodyData(part as Record<string, unknown>);
      if (result) return result;
    }
  }
  return '';
}

// 从 Gmail API thread 响应转换为我们的 GmailThread 类型
function parseGmailThread(apiThread: Record<string, unknown>): GmailThread {
  const messages = (apiThread.messages || []) as Record<string, unknown>[];
  const firstMessage = messages[0];
  const lastMessage = messages[messages.length - 1];

  const lastPayload = (lastMessage?.payload || {}) as Record<string, unknown>;
  const firstPayload = (firstMessage?.payload || {}) as Record<string, unknown>;
  const headers = (lastPayload.headers as { name: string; value: string }[]) || [];
  const firstHeaders = (firstPayload.headers as { name: string; value: string }[]) || [];

  const subject = getHeader(headers, 'Subject') || getHeader(firstHeaders, 'Subject') || '(无主题)';
  const from = getHeader(headers, 'From') || '';
  const date = getHeader(headers, 'Date') || '';

  const hasUnread = messages.some((m: Record<string, unknown>) => {
    const labelIds = m.labelIds as string[] || [];
    return labelIds.includes('UNREAD');
  });

  const snippet = (apiThread.snippet as string) || '';

  return {
    id: apiThread.id as string,
    subject,
    snippet,
    hasUnread,
    participantCount: 0,
    lastMessageDate: date ? new Date(date).toISOString() : new Date().toISOString(),
    messages: messages.map((m: Record<string, unknown>) => {
      const mPayload = (m.payload || {}) as Record<string, unknown>;
      const mHeaders = (mPayload.headers as { name: string; value: string }[]) || [];
      const labelIds = m.labelIds as string[] || [];
      const body = getBodyData(mPayload);
      return {
        id: m.id as string,
        threadId: m.threadId as string,
        from: getHeader(mHeaders, 'From'),
        to: getHeader(mHeaders, 'To'),
        subject: getHeader(mHeaders, 'Subject'),
        snippet: m.snippet as string || '',
        body,
        htmlBody: '',
        date: getHeader(mHeaders, 'Date') ? new Date(getHeader(mHeaders, 'Date')).toISOString() : '',
        isRead: !labelIds.includes('UNREAD'),
      } as GmailMessage;
    }),
  };
}

export function GmailInbox({ onSelectThread, selectedThreadId }: GmailInboxProps) {
  const { auth, connect, disconnect } = useGmailAuth();
  const [threads, setThreads] = useState<GmailThread[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'unread' | 'recent'>('all');
  const [authProcessing, setAuthProcessing] = useState(false);

  // 处理 OAuth 回调
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const gmailConnected = params.get('gmail_connected');
    const authError = params.get('auth_error');

    if (authError) {
      const errorMessages: Record<string, string> = {
        access_denied: '你取消了 Gmail 授权。',
        missing_google_client_id: 'Vercel 尚未配置 GOOGLE_CLIENT_ID。',
        missing_google_oauth_env: 'Vercel 尚未完整配置 Google OAuth 环境变量。',
        token_exchange_failed: 'Google 授权码交换失败，请检查回调地址和 OAuth 配置。',
        callback_failed: 'Gmail 授权回调失败，请稍后重试。',
        no_code: 'Google 没有返回授权码。',
        invalid_state: 'Gmail 授权校验失败，请重新点击连接。',
      };
      setError(errorMessages[authError] || `Gmail 授权失败：${authError}`);
      window.history.replaceState({}, '', window.location.pathname);
      return;
    }

    if (gmailConnected) {
      setAuthProcessing(true);
      fetch('/api/auth/session')
        .then((response) => response.json())
        .then((result) => {
          if (result.success && result.data?.accessToken) {
            connect(result.data);
          } else {
            setError(result.error || '无法保存 Gmail 授权信息，请重新连接。');
          }
        })
        .catch((err) => {
          setError(`Gmail 连接失败：${err.message}`);
        })
        .finally(() => {
          setAuthProcessing(false);
          window.history.replaceState({}, '', window.location.pathname);
        });
    }
  }, [connect]);

  // 获取邮件列表
  const fetchThreads = useCallback(async () => {
    if (!auth?.accessToken) return;
    
    setLoading(true);
    setError(null);
    try {
      let accessToken = auth.accessToken;

      if (auth.refreshToken && auth.expiresAt && auth.expiresAt <= Date.now() + 60_000) {
        const refreshResponse = await fetch('/api/auth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: auth.refreshToken }),
        });
        const refreshResult = await refreshResponse.json();

        if (!refreshResponse.ok || !refreshResult.data?.accessToken) {
          throw new Error(refreshResult.error || 'Gmail 授权已过期，请重新连接。');
        }

        accessToken = refreshResult.data.accessToken;
        connect({
          ...auth,
          accessToken,
          expiresAt: Date.now() + refreshResult.data.expiresIn * 1000,
        });
      }

      // 直接从浏览器调用 Gmail API（因为后端服务器无法访问 Google）
      const headers = {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      };

      // 获取邮件列表
      const listRes = await fetch(
        'https://gmail.googleapis.com/gmail/v1/users/me/threads?maxResults=30',
        { headers }
      );
      
      if (!listRes.ok) {
        const errData = await listRes.json().catch(() => ({}));
        throw new Error(errData.error?.message || '获取邮件列表失败');
      }

      const listData = await listRes.json();
      
      // 获取每个 thread 的详细信息
      if (listData.threads && listData.threads.length > 0) {
        const threadDetails = await Promise.all(
          listData.threads.map(async (thread: { id: string }) => {
            const threadRes = await fetch(
              `https://gmail.googleapis.com/gmail/v1/users/me/threads/${thread.id}?format=full`,
              { headers }
            );
            if (!threadRes.ok) return thread;
            return await threadRes.json();
          })
        );
        const parsedThreads = threadDetails.map(parseGmailThread);
        setThreads(parsedThreads);
      } else {
        setThreads([]);
      }
    } catch (err) {
      setError(`网络错误: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [auth, connect]);

  // 连接后自动获取邮件
  useEffect(() => {
    if (auth?.isConnected && auth?.accessToken) {
      fetchThreads();
    }
  }, [auth?.isConnected, auth?.accessToken, fetchThreads]);

  // 过滤线程
  const filteredThreads = threads.filter(thread => {
    const matchesSearch = 
      thread.subject.toLowerCase().includes(searchQuery.toLowerCase()) ||
      thread.messages.some((m: GmailMessage) => 
        m.from.toLowerCase().includes(searchQuery.toLowerCase()) ||
        m.subject.toLowerCase().includes(searchQuery.toLowerCase())
      );
    
    if (filter === 'unread') return matchesSearch && thread.hasUnread;
    if (filter === 'recent') {
      const lastDate = new Date(thread.lastMessageDate);
      const now = new Date();
      const diffHours = (now.getTime() - lastDate.getTime()) / (1000 * 60 * 60);
      return matchesSearch && diffHours < 24;
    }
    return matchesSearch;
  });

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) {
      return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    } else if (diffDays === 1) {
      return '昨天';
    } else if (diffDays < 7) {
      return `${diffDays}天前`;
    } else {
      return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
    }
  };

  if (authProcessing) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-6">
        <Loader2 className="w-8 h-8 animate-spin text-primary mb-4" />
        <h3 className="text-lg font-semibold mb-2">正在连接 Gmail...</h3>
        <p className="text-sm text-muted-foreground">请稍候</p>
      </div>
    );
  }

  if (!auth?.isConnected) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-6">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-red-50 to-orange-50 flex items-center justify-center mb-4">
          <Mail className="w-8 h-8 text-red-400" />
        </div>
        <h3 className="text-lg font-semibold mb-2">连接 Gmail</h3>
        <p className="text-sm text-muted-foreground mb-4 max-w-xs">
          请先在 Gmail 设置中点击“连接 Gmail”，完成 Google 授权。
        </p>
        {error && (
          <div className="bg-red-50 p-3 rounded-lg mb-4 text-sm text-red-600 max-w-xs">
            {error}
          </div>
        )}
        <Button className="bg-red-500 hover:bg-red-600" onClick={() => {
          window.location.href = '/api/auth/google';
        }}>
          连接 Gmail
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="flex items-center gap-3">
          <h2 className="font-semibold">收件箱</h2>
          <Badge variant="secondary" className="bg-red-100 text-red-600 hover:bg-red-100">
            {filteredThreads.filter(t => t.hasUnread).length} 未读
          </Badge>
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={fetchThreads} disabled={loading}>
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {/* 搜索和过滤 */}
      <div className="px-4 py-2 border-b space-y-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索邮件..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9 text-sm"
          />
        </div>
        <div className="flex gap-1">
          <Button
            variant={filter === 'all' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7 text-xs"
            onClick={() => setFilter('all')}
          >
            全部
          </Button>
          <Button
            variant={filter === 'unread' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7 text-xs"
            onClick={() => setFilter('unread')}
          >
            未读
          </Button>
          <Button
            variant={filter === 'recent' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7 text-xs"
            onClick={() => setFilter('recent')}
          >
            最近
          </Button>
        </div>
      </div>

      {/* 邮件列表 */}
      <ScrollArea className="flex-1">
        {loading && threads.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="p-4 text-center">
            <AlertCircle className="w-8 h-8 text-red-400 mx-auto mb-2" />
            <p className="text-sm text-red-600">{error}</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={fetchThreads}>
              重试
            </Button>
          </div>
        ) : filteredThreads.length === 0 ? (
          <div className="p-4 text-center text-muted-foreground text-sm">
            {searchQuery ? '没有找到匹配的邮件' : '暂无邮件'}
          </div>
        ) : (
          <div>
            {filteredThreads.map(thread => (
              <div
                key={thread.id}
                className={`px-4 py-3 border-b cursor-pointer hover:bg-muted/50 transition-colors ${
                  selectedThreadId === thread.id ? 'bg-muted' : ''
                } ${thread.hasUnread ? 'bg-primary/5' : ''}`}
                onClick={() => onSelectThread(thread)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {thread.hasUnread ? (
                        <Mail className="w-4 h-4 text-primary flex-shrink-0" />
                      ) : (
                        <MailOpen className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      )}
                      <span className={`text-sm truncate ${thread.hasUnread ? 'font-semibold' : 'text-muted-foreground'}`}>
                        {thread.messages[thread.messages.length - 1]?.from?.split('<')[0]?.trim() || '未知发件人'}
                      </span>
                    </div>
                    <p className={`text-sm mt-1 truncate ${thread.hasUnread ? 'font-medium' : ''}`}>
                      {thread.subject}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">
                      {thread.snippet}
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground flex-shrink-0 mt-1">
                    {formatDate(thread.lastMessageDate)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>

      {/* 底部：断开连接 */}
      <div className="px-4 py-2 border-t">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>已连接: {auth.email || 'Gmail'}</span>
          <Button variant="ghost" size="sm" className="h-7 text-xs text-red-500 hover:text-red-600" onClick={disconnect}>
            断开
          </Button>
        </div>
      </div>
    </div>
  );
}
