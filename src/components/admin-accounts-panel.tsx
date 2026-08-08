'use client';

import { useCallback, useEffect, useState } from 'react';
import { KeyRound, LoaderCircle, Pencil, Plus, RefreshCw, ShieldCheck, UserRoundCheck, UserRoundX } from 'lucide-react';
import { toast } from 'sonner';
import type { AdminAccountSummary } from '@/lib/account-types';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

function formatAccountDate(value?: string) {
  if (!value) return '尚未登录';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '未知';
  return date.toLocaleString('zh-CN', { hour12: false });
}

export function AdminAccountsPanel() {
  const [accounts, setAccounts] = useState<AdminAccountSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editAccount, setEditAccount] = useState<AdminAccountSummary | null>(null);
  const [resetAccount, setResetAccount] = useState<AdminAccountSummary | null>(null);
  const [disableAccount, setDisableAccount] = useState<AdminAccountSummary | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [editDisplayName, setEditDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadAccounts = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/admin/accounts', { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '账号列表读取失败。');
      setAccounts(result.data || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '账号列表读取失败。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadAccounts(); }, [loadAccounts]);

  const createAccount = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch('/api/admin/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName, email, temporaryPassword }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '账号创建失败。');
      setCreateOpen(false);
      setDisplayName('');
      setEmail('');
      setTemporaryPassword('');
      await loadAccounts();
      toast.success('成员账号已创建，请安全地把临时密码交给成员。');
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : '账号创建失败。');
    } finally {
      setSubmitting(false);
    }
  };

  const updateAccount = async (
    account: AdminAccountSummary,
    action: 'disable' | 'enable' | 'reset_password',
    password?: string,
  ) => {
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch('/api/admin/accounts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: account.userId, action, temporaryPassword: password }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '账号操作失败。');
      setResetAccount(null);
      setDisableAccount(null);
      setTemporaryPassword('');
      await loadAccounts();
      toast.success(
        action === 'disable'
          ? '成员账号已停用，原有数据仍会保留。'
          : action === 'enable'
            ? '成员账号已恢复。'
            : '临时密码已重置，成员下次登录必须修改密码。',
      );
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : '账号操作失败。');
    } finally {
      setSubmitting(false);
    }
  };

  const updateDisplayName = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editAccount) return;

    const nextDisplayName = editDisplayName.trim();
    if (!nextDisplayName) {
      setError('请输入姓名备注。');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      const response = await fetch('/api/admin/accounts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: editAccount.userId,
          action: 'update_display_name',
          displayName: nextDisplayName,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '姓名备注更新失败。');

      setAccounts((currentAccounts) => currentAccounts.map((account) => (
        account.userId === editAccount.userId
          ? { ...account, displayName: nextDisplayName }
          : account
      )));
      setEditAccount(null);
      setEditDisplayName('');
      toast.success('姓名备注已保存。');
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : '姓名备注更新失败。');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden">
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2"><ShieldCheck className="size-5" />账号管理</CardTitle>
            <CardDescription>创建账号、填写姓名备注和管理账号状态。管理员无法查看成员的业务数据、授权或密钥。</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => void loadAccounts()} disabled={loading}>
              <RefreshCw data-icon="inline-start" className={loading ? 'animate-spin' : undefined} />刷新
            </Button>
            <Button onClick={() => { setError(''); setTemporaryPassword(''); setCreateOpen(true); }}>
              <Plus data-icon="inline-start" />新建账号
            </Button>
          </div>
        </CardHeader>
      </Card>

      {error ? <Alert variant="destructive"><AlertTitle>账号操作未完成</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}

      <Card className="min-h-0 flex-1 overflow-hidden">
        <CardContent className="h-full overflow-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>成员</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>创建时间</TableHead>
                <TableHead>最近登录</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={5} className="h-32 text-center"><LoaderCircle className="mx-auto animate-spin" /></TableCell></TableRow>
              ) : accounts.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="h-32 text-center text-muted-foreground">暂无成员账号</TableCell></TableRow>
              ) : accounts.map((item) => (
                <TableRow key={item.userId}>
                  <TableCell>
                    <div className="font-medium">{item.displayName || '未命名成员'}</div>
                    <div className="text-xs text-muted-foreground">{item.email}</div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1.5">
                      <Badge variant={item.status === 'active' ? 'secondary' : 'destructive'}>
                        {item.status === 'active' ? '正常' : '已停用'}
                      </Badge>
                      {item.isAdmin ? <Badge>主管理员</Badge> : null}
                      {item.mustChangePassword ? <Badge variant="outline">待修改密码</Badge> : null}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{formatAccountDate(item.createdAt)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{formatAccountDate(item.lastLoginAt)}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setError('');
                          setEditAccount(item);
                          setEditDisplayName(item.displayName);
                        }}
                      >
                        <Pencil data-icon="inline-start" />编辑姓名备注
                      </Button>
                      {!item.isAdmin ? (
                        <>
                          <Button variant="outline" size="sm" onClick={() => { setError(''); setTemporaryPassword(''); setResetAccount(item); }}>
                            <KeyRound data-icon="inline-start" />重置密码
                          </Button>
                          {item.status === 'active' ? (
                            <Button variant="outline" size="sm" onClick={() => setDisableAccount(item)}>
                              <UserRoundX data-icon="inline-start" />停用
                            </Button>
                          ) : (
                            <Button variant="outline" size="sm" onClick={() => void updateAccount(item, 'enable')} disabled={submitting}>
                              <UserRoundCheck data-icon="inline-start" />恢复
                            </Button>
                          )}
                        </>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <form onSubmit={createAccount}>
            <DialogHeader>
              <DialogTitle>新建成员账号</DialogTitle>
              <DialogDescription>系统不会发送邮件。请把邮箱和临时密码安全地交给成员。</DialogDescription>
            </DialogHeader>
            <FieldGroup className="py-5">
              <Field><FieldLabel htmlFor="account-name">姓名备注</FieldLabel><Input id="account-name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={80} required /></Field>
              <Field><FieldLabel htmlFor="account-email">登录邮箱</FieldLabel><Input id="account-email" type="email" autoComplete="off" value={email} onChange={(event) => setEmail(event.target.value)} required /></Field>
              <Field><FieldLabel htmlFor="account-password">临时密码</FieldLabel><Input id="account-password" type="password" autoComplete="new-password" minLength={8} value={temporaryPassword} onChange={(event) => setTemporaryPassword(event.target.value)} required /></Field>
            </FieldGroup>
            <DialogFooter><Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>取消</Button><Button type="submit" disabled={submitting}>{submitting ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : <Plus data-icon="inline-start" />}创建账号</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(editAccount)}
        onOpenChange={(open) => {
          if (!open) {
            setEditAccount(null);
            setEditDisplayName('');
          }
        }}
      >
        <DialogContent>
          <form onSubmit={updateDisplayName}>
            <DialogHeader>
              <DialogTitle>编辑姓名备注</DialogTitle>
              <DialogDescription>
                用于管理员在账号列表中识别成员，不会修改登录邮箱或成员权限。
              </DialogDescription>
            </DialogHeader>
            <FieldGroup className="py-5">
              <Field>
                <FieldLabel htmlFor="edit-account-name">姓名备注</FieldLabel>
                <Input
                  id="edit-account-name"
                  value={editDisplayName}
                  onChange={(event) => setEditDisplayName(event.target.value)}
                  maxLength={80}
                  autoFocus
                  required
                />
              </Field>
            </FieldGroup>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditAccount(null)}>
                取消
              </Button>
              <Button type="submit" disabled={submitting || !editDisplayName.trim()}>
                {submitting ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : null}
                保存备注
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(resetAccount)} onOpenChange={(open) => { if (!open) setResetAccount(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>设置临时密码</DialogTitle><DialogDescription>{resetAccount?.displayName || resetAccount?.email} 下次登录后必须重新修改密码。</DialogDescription></DialogHeader>
          <FieldGroup className="py-5"><Field><FieldLabel htmlFor="reset-password">新临时密码</FieldLabel><Input id="reset-password" type="password" autoComplete="new-password" minLength={8} value={temporaryPassword} onChange={(event) => setTemporaryPassword(event.target.value)} required /></Field></FieldGroup>
          <DialogFooter><Button variant="outline" onClick={() => setResetAccount(null)}>取消</Button><Button disabled={submitting || temporaryPassword.length < 8} onClick={() => resetAccount && void updateAccount(resetAccount, 'reset_password', temporaryPassword)}>{submitting ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : <KeyRound data-icon="inline-start" />}确认重置</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(disableAccount)} onOpenChange={(open) => { if (!open) setDisableAccount(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>停用这个账号？</AlertDialogTitle><AlertDialogDescription>成员将无法继续访问工作台，现有数据和授权会保留，恢复账号后仍可继续使用。</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction onClick={() => disableAccount && void updateAccount(disableAccount, 'disable')}>确认停用</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
