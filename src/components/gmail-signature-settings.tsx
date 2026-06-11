'use client';

import { useState } from 'react';
import { ArrowLeft, Check, Mail, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useSettings } from '@/lib/data';

export function GmailSignatureSettings({ onBack }: { onBack: () => void }) {
  const { settings, updateSettings } = useSettings();
  const [signature, setSignature] = useState(settings.emailSignature || '');
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    updateSettings({ emailSignature: signature.trim() });
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-6 py-6">
        <div className="border-b pb-4">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" className="h-8 w-8 md:hidden" onClick={onBack}>
              <ArrowLeft className="h-4 w-4" />
              <span className="sr-only">返回邮箱</span>
            </Button>
            <Mail className="h-5 w-5 text-red-500" />
            <h2 className="text-lg font-semibold">Gmail 设置</h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            管理通过工作看板创建的邮件回复。
          </p>
        </div>

        <section className="py-6">
          <div className="mb-4">
            <h3 className="font-medium">邮件签名</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              保存到 Gmail 草稿时，签名会自动添加在邮件正文末尾。
            </p>
          </div>

          <Textarea
            value={signature}
            onChange={(event) => setSignature(event.target.value)}
            placeholder={'例如：\nBest regards,\nDaniel Wu\nDigital Marketing Specialist | Aferiy'}
            className="min-h-44 resize-y"
          />

          <div className="mt-4 flex justify-end">
            <Button onClick={handleSave} className="gap-2">
              {saved ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
              {saved ? '已保存' : '保存签名'}
            </Button>
          </div>

          <div className="mt-8 border-t pt-6">
            <p className="mb-3 text-sm font-medium">签名预览</p>
            <div className="min-h-28 whitespace-pre-wrap rounded-md border bg-white p-4 text-sm">
              {signature || <span className="text-muted-foreground">尚未设置邮件签名</span>}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
