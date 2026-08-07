'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LoaderCircle, LockKeyhole, LogOut } from 'lucide-react';
import { useAuth } from '@/components/auth-provider';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

export default function ChangePasswordPage() {
  const router = useRouter();
  const { user, account, loading, signOut } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (loading) return;
    if (!user || !account || account.status === 'disabled') {
      if (user) {
        void signOut().finally(() => router.replace('/login'));
      } else {
        router.replace('/login');
      }
    }
  }, [account, loading, router, signOut, user]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (newPassword !== confirmation) {
      setError('两次输入的新密码不一致。');
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch('/api/account/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '密码修改失败。');
      await signOut();
      router.replace('/login?password_changed=1');
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '密码修改失败。');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || !user || !account) {
    return <div className="flex min-h-screen items-center justify-center"><LoaderCircle className="animate-spin" /></div>;
  }

  return (
    <main className="workspace-shell flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-primary/10">
            <LockKeyhole className="size-5 text-primary" />
          </div>
          <CardTitle>{account.mustChangePassword ? '请先修改初始密码' : '修改登录密码'}</CardTitle>
          <CardDescription>
            {account.mustChangePassword
              ? '管理员设置的是临时密码。修改成功并重新登录后才能进入工作台。'
              : '修改成功后会退出当前账号，请使用新密码重新登录。'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="current-password">当前密码</FieldLabel>
                <Input id="current-password" type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required />
              </Field>
              <Field>
                <FieldLabel htmlFor="new-password">新密码</FieldLabel>
                <Input id="new-password" type="password" autoComplete="new-password" minLength={8} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required />
              </Field>
              <Field data-invalid={Boolean(error)}>
                <FieldLabel htmlFor="confirm-password">再次输入新密码</FieldLabel>
                <Input id="confirm-password" type="password" autoComplete="new-password" minLength={8} aria-invalid={Boolean(error)} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required />
              </Field>
              {error ? <Alert variant="destructive"><AlertTitle>无法修改密码</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
              <Button type="submit" disabled={submitting}>
                {submitting ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : <LockKeyhole data-icon="inline-start" />}
                保存新密码
              </Button>
              <Button type="button" variant="ghost" onClick={() => void signOut().then(() => router.replace('/login'))}>
                <LogOut data-icon="inline-start" />退出账号
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
