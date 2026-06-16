import type { Metadata } from 'next';
import './globals.css';
import { DelayedEmailProvider } from '@/components/delayed-email-provider';
import { AuthProvider } from '@/components/auth-provider';
import { RecordAssistantProvider } from '@/components/record-assistant-provider';

export const metadata: Metadata = {
  title: {
    default: '红人推广看板 | 跨境电商工作台',
    template: '%s | 红人推广看板',
  },
  description:
    '专为跨境电商海外红人推广专员设计的看板工作台，管理红人数据库、合作进度和邮件往来。',
  keywords: [
    '红人推广',
    '海外网红',
    'YouTube推广',
    '跨境电商',
    'KOL管理',
    '网红合作',
  ],
  authors: [{ name: 'Influencer Kanban' }],
  generator: 'Next.js',
  openGraph: {
    title: '红人推广看板',
    description: '跨境电商红人合作管理工作台',
    siteName: '红人推广看板',
    locale: 'zh_CN',
    type: 'website',
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="antialiased">
        <AuthProvider>
          <DelayedEmailProvider>
            <RecordAssistantProvider>{children}</RecordAssistantProvider>
          </DelayedEmailProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
