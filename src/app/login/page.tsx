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
  const { user, account, loading, configured, signOut } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('password_changed') === '1') {
      setMessage({ type: 'success', text: '密码已修改，请使用新密码重新登录。' });
    }
  }, []);

  useEffect(() => {
    if (loading || submitting || !user) return;
    if (!account) {
      void signOut();
      setMessage({ type: 'error', text: '账号尚未由主管理员开通，或账号服务暂时不可用。' });
      return;
    }
    if (account.status === 'disabled') {
      void signOut();
      setMessage({ type: 'error', text: '账号已停用，请联系管理员。' });
      return;
    }
    router.replace(account.mustChangePassword ? '/change-password' : '/');
  }, [account, loading, router, signOut, submitting, user]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    setSubmitting(true);
    setMessage(null);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error || !data.session) throw error || new Error('登录失败。');

      const sessionResponse = await fetch('/api/cloud/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: data.session.access_token }),
      });
      const sessionResult = await sessionResponse.json().catch(() => ({}));
      const profileResponse = await fetch('/api/account/me', {
        cache: 'no-store',
        headers: { Authorization: `Bearer ${data.session.access_token}` },
      });
      const profileResult = await profileResponse.json().catch(() => ({}));
      if (!profileResponse.ok || !profileResult.success) {
        await supabase.auth.signOut();
        throw new Error(profileResult.error || sessionResult.error || '账号尚未由管理员开通。');
      }
      if (profileResult.data.status === 'disabled' || !sessionResponse.ok) {
        await supabase.auth.signOut();
        throw new Error(profileResult.data.status === 'disabled'
          ? '账号已停用，请联系管理员。'
          : sessionResult.error || '登录失败。');
      }
      router.replace(profileResult.data.mustChangePassword ? '/change-password' : '/');
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : '操作失败，请稍后重试。',
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
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
              登录工作台
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              账号由管理员创建。登录后只会加载属于你的资料、授权和工作内容。
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

              <div className="space-y-2">
                <Label htmlFor="password">密码</Label>
                <div className="relative">
                  <LockKeyhole className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    minLength={8}
                    className="pl-9"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                  />
                </div>
              </div>

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
                登录
              </Button>

              <p className="text-center text-xs leading-5 text-muted-foreground">
                需要新账号或忘记密码时，请联系主管理员处理。
              </p>
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
