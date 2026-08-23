'use client';

import { Check, ChevronDown, Mail, Server } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { getMailProviderLabel } from '@/lib/mail-accounts';
import { useMailAccounts } from './mail-account-provider';

export function MailAccountSwitcher({
  onManage,
  placement = 'topbar',
}: {
  onManage?: () => void;
  placement?: 'topbar' | 'mailbox-sidebar';
}) {
  const { accounts, activeAccount, selectAccount } = useMailAccounts();
  if (!activeAccount && !accounts.length) return null;
  const inMailboxSidebar = placement === 'mailbox-sidebar';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className={inMailboxSidebar
            ? 'h-9 w-full min-w-0 justify-start gap-2 rounded-lg border-white/65 bg-white/55 px-2 shadow-sm hover:bg-white/80'
            : 'h-9 max-w-[280px] gap-2 rounded-lg bg-white/75 px-3 shadow-sm'}
          aria-label={activeAccount ? `切换邮箱，当前为${activeAccount.email}` : '选择邮箱'}
          title={activeAccount?.email || '选择邮箱'}
        >
          <Mail className="h-4 w-4 shrink-0 text-primary" />
          <span className={`min-w-0 flex-1 truncate text-left ${inMailboxSidebar ? 'text-sm font-semibold' : 'text-xs'}`}>
            {activeAccount
              ? inMailboxSidebar
                ? getMailProviderLabel(activeAccount.provider)
                : `${getMailProviderLabel(activeAccount.provider)} · ${activeAccount.email}`
              : '选择邮箱'}
          </span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={inMailboxSidebar ? 'start' : 'end'} className="w-80">
        <DropdownMenuLabel>切换邮箱</DropdownMenuLabel>
        {accounts.map((account) => (
          <DropdownMenuItem
            key={account.mailAccountId}
            disabled={account.connectionStatus !== 'connected'}
            onSelect={() => selectAccount(account.mailAccountId)}
            className="items-start gap-3 py-2.5"
          >
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-slate-100">
              {account.provider === 'gmail' ? <Mail className="h-4 w-4 text-red-500" /> : <Server className="h-4 w-4 text-blue-600" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-sm font-medium">
                {getMailProviderLabel(account.provider)}
                {account.isDefault && <span className="text-[11px] font-normal text-muted-foreground">默认</span>}
              </span>
              <span className="block truncate text-xs text-muted-foreground">{account.email}</span>
              {account.connectionStatus !== 'connected' && <span className="block text-xs text-amber-700">需要重新验证</span>}
            </span>
            {activeAccount?.mailAccountId === account.mailAccountId && <Check className="mt-1 h-4 w-4 text-primary" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onManage}>邮箱账号管理</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
