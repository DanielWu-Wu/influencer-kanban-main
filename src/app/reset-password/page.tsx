'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LoaderCircle, LockKeyhole } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    setSubmitting(true);
    setError('');
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSubmitting(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    router.replace('/');
  };

  return (
    <main className="workspace-shell flex min-h-screen items-center justify-center px-6">
      <form onSubmit={handleSubmit} className="glass-panel-strong w-full max-w-sm rounded-xl border p-6 shadow-[var(--glass-shadow)]">
        <div className="mb-6 flex h-10 w-10 items-center justify-center rounded-[10px] border border-primary/15 bg-primary/10">
          <LockKeyhole className="h-5 w-5 text-primary" />
        </div>
        <h1 className="text-xl font-semibold">设置新密码</h1>
        <p className="mt-2 text-sm text-muted-foreground">请输入至少 8 位的新密码。</p>
        <div className="mt-6 space-y-2">
          <Label htmlFor="password">新密码</Label>
          <Input
            id="password"
            type="password"
            minLength={8}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </div>
        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
        <Button className="mt-5 w-full" disabled={submitting}>
          {submitting && <LoaderCircle className="h-4 w-4 animate-spin" />}
          保存新密码
        </Button>
      </form>
    </main>
  );
}
