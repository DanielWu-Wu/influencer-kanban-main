'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, LoaderCircle, LockKeyhole, Mail, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/components/auth-provider';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const router = useRouter();
  const { user, loading, configured } = useAuth();
  const [mode, setMode] = useState<'login' | 'signup' | 'forgot'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  useEffect(() => {
    if (!loading && user) router.replace('/');
  }, [loading, router, user]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    setSubmitting(true);
    setMessage(null);
    try {
      if (mode === 'forgot') {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) throw error;
        setMessage({ type: 'success', text: '重置密码邮件已经发送，请检查邮箱。' });
        return;
      }

      if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/`,
          },
        });
        if (error) throw error;
        if (data.session) {
          router.replace('/');
        } else {
          setMessage({ type: 'success', text: '注册成功，请打开验证邮件完成账号确认。' });
        }
        return;
      }

      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      router.replace('/');
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : '操作失败，请稍后重试。',
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <LoaderCircle className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <main className="workspace-shell grid min-h-screen p-3 lg:grid-cols-[minmax(380px,500px)_1fr] lg:p-5">
      <section className="app-sidebar flex items-center justify-center rounded-xl px-6 py-10">
        <div className="w-full max-w-sm rounded-xl border border-white/70 bg-white/48 p-6 shadow-[var(--glass-shadow-soft)]">
          <div className="mb-10 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-[10px] border border-primary/15 bg-primary shadow-[0_6px_16px_rgba(24,119,242,0.2)]">
              <Sparkles className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-semibold">红人推广</h1>
              <p className="text-sm text-muted-foreground">海外红人合作工作台</p>
            </div>
          </div>

          <div className="mb-7">
            <h2 className="text-2xl font-semibold">
              {mode === 'login' ? '登录工作台' : mode === 'signup' ? '创建账号' : '重置密码'}
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {mode === 'forgot'
                ? '输入登录邮箱，我们会发送密码重置链接。'
                : '登录后，产品资料和设置会在不同电脑之间自动同步。'}
            </p>
          </div>

          {!configured ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              Supabase 环境变量尚未生效，请确认 Vercel 已重新部署。
            </div>
          ) : (
            <form className="space-y-4" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <Label htmlFor="email">邮箱</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    className="pl-9"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                  />
                </div>
              </div>

              {mode !== 'forgot' && (
                <div className="space-y-2">
                  <Label htmlFor="password">密码</Label>
                  <div className="relative">
                    <LockKeyhole className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="password"
                      type="password"
                      autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                      minLength={8}
                      className="pl-9"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      required
                    />
                  </div>
                </div>
              )}

              {message && (
                <div className={`rounded-md p-3 text-sm ${
                  message.type === 'success'
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'bg-red-50 text-red-700'
                }`}>
                  {message.text}
                </div>
              )}

              <Button className="w-full" disabled={submitting}>
                {submitting && <LoaderCircle className="h-4 w-4 animate-spin" />}
                {mode === 'login' ? '登录' : mode === 'signup' ? '注册' : '发送重置邮件'}
              </Button>

              <div className="flex items-center justify-between text-sm">
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    setMode(mode === 'signup' ? 'login' : 'signup');
                    setMessage(null);
                  }}
                >
                  {mode === 'signup' ? '已有账号，返回登录' : '还没有账号？注册'}
                </button>
                {mode !== 'signup' && (
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      setMode(mode === 'forgot' ? 'login' : 'forgot');
                      setMessage(null);
                    }}
                  >
                    {mode === 'forgot' ? '返回登录' : '忘记密码'}
                  </button>
                )}
              </div>
            </form>
          )}
        </div>
      </section>

      <section className="material-navigation ml-4 hidden items-center justify-center rounded-xl border border-white/70 px-12 text-foreground shadow-[var(--glass-shadow)] lg:flex">
        <div className="max-w-xl">
          <p className="text-sm font-medium text-primary">一个账号，接着上次继续</p>
          <h2 className="mt-4 text-4xl font-semibold leading-tight">
            把执行工作留给系统，把时间留给判断和统筹。
          </h2>
          <div className="mt-10 flex flex-col gap-5 text-sm text-muted-foreground">
            {[
              '产品资料、市场策略和设置自动保存到云端',
              '每个账号的数据通过数据库权限独立隔离',
              'Gmail 授权和 AI 设置跟随账号保存',
            ].map((item) => (
              <div key={item} className="flex items-center gap-3">
                <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                {item}
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
