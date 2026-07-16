'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Cloud, CloudUpload, LoaderCircle, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/components/auth-provider';
import {
  PRODUCTS_CLOUD_UPDATED_EVENT,
  PRODUCTS_UPDATED_EVENT,
  STORAGE_KEYS,
} from '@/lib/data';
import type { Product } from '@/lib/types';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

const GMAIL_AUTH_KEY = 'gmail-auth';

type SyncState = 'checking' | 'ready' | 'uploading' | 'complete' | 'error';

export function CloudSyncSettings() {
  const { user } = useAuth();
  const [state, setState] = useState<SyncState>('checking');
  const [message, setMessage] = useState('');
  const [localProductCount, setLocalProductCount] = useState(0);
  const [cloudProductCount, setCloudProductCount] = useState(0);

  useEffect(() => {
    const check = async () => {
      const localProducts = readLocal<Product[]>(STORAGE_KEYS.PRODUCTS, []);
      setLocalProductCount(localProducts.length);

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
        setMessage('数据库表尚未建立，请先运行项目提供的 SQL 脚本。');
        return;
      }
      setCloudProductCount(count || 0);
      setState('ready');
    };

    void check();
  }, [user]);

  useEffect(() => {
    const updateLocalCount = (products?: Product[]) => {
      const nextProducts = products || readLocal<Product[]>(STORAGE_KEYS.PRODUCTS, []);
      setLocalProductCount(nextProducts.length);
    };

    const handleProductsUpdated = (event: Event) => {
      updateLocalCount((event as CustomEvent<Product[]>).detail);
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEYS.PRODUCTS) updateLocalCount();
    };

    const refreshCloudCount = async () => {
      const supabase = getSupabaseBrowserClient();
      if (!supabase || !user) return;
      const { count, error } = await supabase
        .from('products')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id);
      if (!error) setCloudProductCount(count || 0);
    };

    const handleCloudProductsUpdated = () => {
      void refreshCloudCount();
    };

    window.addEventListener(PRODUCTS_UPDATED_EVENT, handleProductsUpdated);
    window.addEventListener(PRODUCTS_CLOUD_UPDATED_EVENT, handleCloudProductsUpdated);
    window.addEventListener('storage', handleStorage);

    return () => {
      window.removeEventListener(PRODUCTS_UPDATED_EVENT, handleProductsUpdated);
      window.removeEventListener(PRODUCTS_CLOUD_UPDATED_EVENT, handleCloudProductsUpdated);
      window.removeEventListener('storage', handleStorage);
    };
  }, [user]);

  const uploadLocalData = async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !user) return;

    setState('uploading');
    setMessage('');
    try {
      const localProducts = readLocal<Product[]>(STORAGE_KEYS.PRODUCTS, []);
      const localSettings = readLocal<Record<string, unknown>>(STORAGE_KEYS.SETTINGS, {});
      const localGmailAuth = readLocal<Record<string, unknown> | null>(GMAIL_AUTH_KEY, null);
      const legacyAiKey =
        typeof localSettings.customApiKey === 'string'
          ? localSettings.customApiKey
          : '';

      const safeSettings = { ...localSettings };
      delete safeSettings.customApiKey;
      delete safeSettings.customApiKeyConfigured;
      delete safeSettings.gmailClientSecret;

      const productRows = localProducts.map((product) => ({
        id: product.id,
        user_id: user.id,
        name: product.name,
        model: product.model,
        product_url: product.productUrl,
        selling_points: product.sellingPoints,
        technical_specifications: product.technicalSpecifications,
        image_and_resource_links: product.imageAndResourceLinks,
        notes: product.notes,
        status: product.status,
        market_profiles: product.marketProfiles,
        created_at: product.createdAt,
        updated_at: product.updatedAt,
      }));

      if (productRows.length) {
        const { error } = await supabase.from('products').upsert(productRows);
        if (error) throw error;
      }

      const { error: settingsError } = await supabase.from('app_settings').upsert({
        user_id: user.id,
        data: safeSettings,
        updated_at: new Date().toISOString(),
      });
      if (settingsError) throw settingsError;

      const warnings: string[] = [];
      if (legacyAiKey) {
        const response = await fetch('/api/secrets/ai-key', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiKey: legacyAiKey }),
        });
        if (!response.ok) {
          warnings.push('AI Key 尚未迁移');
        } else {
          window.localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(safeSettings));
        }
      }

      if (localGmailAuth?.refreshToken) {
        const response = await fetch('/api/auth/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(localGmailAuth),
        });
        if (!response.ok) {
          warnings.push('Gmail 授权尚未迁移');
        } else {
          const safeGmailAuth = {
            isConnected: true,
            email: localGmailAuth.email,
            accessToken: localGmailAuth.accessToken,
            expiresAt: localGmailAuth.expiresAt,
          };
          window.localStorage.setItem(GMAIL_AUTH_KEY, JSON.stringify(safeGmailAuth));
        }
      }

      setCloudProductCount(localProducts.length);
      setState('complete');
      setMessage(
        warnings.length
          ? `普通资料已上传；${warnings.join('、')}，请稍后重试。`
          : '本机产品、设置、Gmail 授权和 AI 配置已上传到云端。',
      );
    } catch (error) {
      setState('error');
      setMessage(error instanceof Error ? error.message : '上传失败，请稍后重试。');
    }
  };

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
            <p className="text-xs text-muted-foreground">本机产品资料</p>
            <p className="mt-1 text-lg font-semibold">{localProductCount}</p>
          </div>
          <div className="rounded-lg border border-emerald-200/80 bg-emerald-50/65 p-3">
            <p className="text-xs text-muted-foreground">云端产品资料</p>
            <p className="mt-1 text-lg font-semibold">{cloudProductCount}</p>
          </div>
        </div>

        {message && (
          <div className={`rounded-lg border p-3 text-sm ${
            state === 'error'
              ? 'border-red-200/80 bg-red-50/80 text-red-700'
              : 'border-emerald-200/80 bg-emerald-50/80 text-emerald-700'
          }`}>
            {message}
          </div>
        )}

        <Button
          type="button"
          variant={state === 'complete' ? 'outline' : 'default'}
          className="h-10 w-full gap-2 rounded-lg"
          onClick={uploadLocalData}
          disabled={state === 'checking' || state === 'uploading'}
        >
          {state === 'uploading' ? (
            <LoaderCircle className="h-4 w-4 animate-spin" />
          ) : state === 'complete' ? (
            <CheckCircle2 className="h-4 w-4" />
          ) : (
            <CloudUpload className="h-4 w-4" />
          )}
          {state === 'uploading'
            ? '正在上传...'
            : state === 'complete'
              ? '重新同步本机资料'
              : '上传本机资料到云端'}
        </Button>
      </CardContent>
    </Card>
  );
}

function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}
