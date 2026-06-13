'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Clock3, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';

type SendTaskStatus = 'countdown' | 'sending' | 'error';

type SendTask = {
  id: string;
  recipient: string;
  delaySeconds: number;
  targetAt: number;
  remainingSeconds: number;
  status: SendTaskStatus;
  hidden: boolean;
  error?: string;
};

type SendRequest = {
  accessToken: string;
  raw: string;
  threadId?: string;
  recipient: string;
  delaySeconds: number;
  onSent?: () => void;
  onCancel?: () => void;
  onError?: (message: string) => void;
};

type PendingRequest = SendRequest & {
  timeoutId: number;
  controller?: AbortController;
};

type DelayedEmailContextValue = {
  scheduleEmail: (request: SendRequest) => string;
};

const DelayedEmailContext = createContext<DelayedEmailContextValue | null>(null);

export function useDelayedEmailSender() {
  const context = useContext(DelayedEmailContext);
  if (!context) {
    throw new Error('useDelayedEmailSender must be used inside DelayedEmailProvider.');
  }
  return context;
}

export function DelayedEmailProvider({ children }: { children: ReactNode }) {
  const [tasks, setTasks] = useState<SendTask[]>([]);
  const pendingRef = useRef(new Map<string, PendingRequest>());

  const removeTask = useCallback((id: string) => {
    setTasks((current) => current.filter((task) => task.id !== id));
    pendingRef.current.delete(id);
  }, []);

  const executeSend = useCallback(async (id: string) => {
    const pending = pendingRef.current.get(id);
    if (!pending) return;

    const controller = new AbortController();
    pending.controller = controller;
    setTasks((current) => current.map((task) =>
      task.id === id
        ? { ...task, status: 'sending', remainingSeconds: 0 }
        : task));

    try {
      const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${pending.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          raw: pending.raw,
          ...(pending.threadId ? { threadId: pending.threadId } : {}),
        }),
        signal: controller.signal,
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result.error?.message || '邮件发送失败。');
      }
      pending.onSent?.();
      removeTask(id);
    } catch (error) {
      if (controller.signal.aborted) return;
      const message = error instanceof Error ? error.message : '邮件发送失败。';
      pending.onError?.(message);
      setTasks((current) => current.map((task) =>
        task.id === id ? { ...task, status: 'error', error: message } : task));
    }
  }, [removeTask]);

  const scheduleEmail = useCallback((request: SendRequest) => {
    const delaySeconds = Math.min(60, Math.max(0, Math.round(request.delaySeconds)));
    const id = crypto.randomUUID();
    const targetAt = Date.now() + delaySeconds * 1000;
    const timeoutId = window.setTimeout(() => executeSend(id), delaySeconds * 1000);

    pendingRef.current.set(id, { ...request, delaySeconds, timeoutId });
    setTasks((current) => [
      ...current,
      {
        id,
        recipient: request.recipient,
        delaySeconds,
        targetAt,
        remainingSeconds: delaySeconds,
        status: 'countdown',
        hidden: false,
      },
    ]);
    return id;
  }, [executeSend]);

  const cancelTask = useCallback((id: string) => {
    const pending = pendingRef.current.get(id);
    if (!pending) return;
    window.clearTimeout(pending.timeoutId);
    pending.controller?.abort();
    pending.onCancel?.();
    removeTask(id);
  }, [removeTask]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      const now = Date.now();
      setTasks((current) => current.map((task) => {
        if (task.status !== 'countdown') return task;
        return {
          ...task,
          remainingSeconds: Math.max(0, Math.ceil((task.targetAt - now) / 1000)),
        };
      }));
    }, 200);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    const hasPendingTask = tasks.some(
      (task) => task.status === 'countdown' || task.status === 'sending',
    );
    if (!hasPendingTask) return;

    const protectPendingSend = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', protectPendingSend);
    return () => window.removeEventListener('beforeunload', protectPendingSend);
  }, [tasks]);

  useEffect(() => () => {
    pendingRef.current.forEach((pending) => {
      window.clearTimeout(pending.timeoutId);
      pending.controller?.abort();
    });
  }, []);

  return (
    <DelayedEmailContext.Provider value={{ scheduleEmail }}>
      {children}
      <div className="pointer-events-none fixed bottom-5 right-5 z-[100] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2">
        {tasks.filter((task) => !task.hidden).map((task) => {
          const progress = task.delaySeconds === 0
            ? 100
            : ((task.delaySeconds - task.remainingSeconds) / task.delaySeconds) * 100;
          return (
            <div
              key={task.id}
              className="pointer-events-auto rounded-md border bg-background p-4 shadow-xl"
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
                  {task.status === 'sending'
                    ? <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    : task.status === 'error'
                      ? <X className="h-4 w-4 text-destructive" />
                      : <Clock3 className="h-4 w-4 text-primary" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {task.status === 'error'
                      ? '邮件发送失败'
                      : task.status === 'sending'
                        ? '正在提交给 Gmail'
                        : '邮件正在等待发送'}
                  </p>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {task.status === 'error'
                      ? task.error
                      : task.status === 'sending'
                        ? `正在发送给 ${task.recipient}`
                        : `${task.remainingSeconds} 秒后发送给 ${task.recipient}`}
                  </p>
                </div>
              </div>

              {task.status === 'countdown' && (
                <Progress value={progress} className="mt-3 h-1.5" />
              )}

              <div className="mt-3 flex justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setTasks((current) => current.map((item) =>
                    item.id === task.id ? { ...item, hidden: true } : item))}
                >
                  关闭
                </Button>
                {task.status === 'countdown' && (
                  <Button variant="outline" size="sm" onClick={() => cancelTask(task.id)}>
                    取消发送
                  </Button>
                )}
                {task.status === 'error' && (
                  <Button variant="outline" size="sm" onClick={() => removeTask(task.id)}>
                    知道了
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </DelayedEmailContext.Provider>
  );
}
