'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Cloud, LoaderCircle, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/components/auth-provider';
import { PRODUCTS_CLOUD_UPDATED_EVENT, useProducts } from '@/lib/data';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

type SyncState = 'checking' | 'ready' | 'error';

export function CloudSyncSettings() {
  const { user } = useAuth();
  const { products } = useProducts();
  const [state, setState] = useState<SyncState>('checking');
  const [message, setMessage] = useState('');
  const [cloudProductCount, setCloudProductCount] = useState(0);

  useEffect(() => {
    const refreshCloudCount = async () => {
      const supabase = getSupabaseBrowserClient();
      if (!supabase || !user) {
        setState('error');
        setMessage('尚未登录或 Supabase 连接未生效。');
        return;
      }

      const { count, error } = await supabase
        .from('products')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id);
      if (error) {
        setState('error');
        setMessage('账号数据表尚未就绪，请先完成本次 Supabase 数据库迁移。');
        return;
      }
      setCloudProductCount(count || 0);
      setState('ready');
      setMessage('当前账号的业务资料会自动保存到自己的云端空间。');
    };

    void refreshCloudCount();
    window.addEventListener(PRODUCTS_CLOUD_UPDATED_EVENT, refreshCloudCount);
    return () => window.removeEventListener(PRODUCTS_CLOUD_UPDATED_EVENT, refreshCloudCount);
  }, [user]);

  return (
    <Card className="overflow-hidden rounded-lg border-white/65 bg-white/66 shadow-apple backdrop-blur-xl">
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10 ring-1 ring-emerald-500/10">
              <Cloud className="h-4 w-4 text-emerald-600" />
            </div>
            <div>
              <CardTitle className="text-base">账号与云端数据</CardTitle>
              <CardDescription className="mt-0.5 text-xs">
                {user?.email || '当前账号'} · Supabase 云端同步
              </CardDescription>
            </div>
          </div>
          <Badge variant="outline" className="w-fit gap-1 rounded-md border-white/70 bg-white/55">
            <ShieldCheck className="h-3 w-3" />
            账号数据隔离
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-white/60 bg-white/45 p-3">
            <p className="text-xs text-muted-foreground">当前工作台产品资料</p>
            <p className="mt-1 text-lg font-semibold">{products.length}</p>
          </div>
          <div className="rounded-lg border border-emerald-200/80 bg-emerald-50/65 p-3">
            <p className="text-xs text-muted-foreground">当前账号云端产品资料</p>
            <p className="mt-1 text-lg font-semibold">{cloudProductCount}</p>
          </div>
        </div>

        <div className={`flex items-center gap-2 rounded-lg border p-3 text-sm ${
          state === 'error'
            ? 'border-red-200/80 bg-red-50/80 text-red-700'
            : 'border-emerald-200/80 bg-emerald-50/80 text-emerald-700'
        }`}>
          {state === 'checking'
            ? <LoaderCircle className="h-4 w-4 animate-spin" />
            : <CheckCircle2 className="h-4 w-4" />}
          <span>{state === 'checking' ? '正在检查当前账号的云端空间…' : message}</span>
        </div>
      </CardContent>
    </Card>
  );
}
