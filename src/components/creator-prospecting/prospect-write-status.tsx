'use client';
import { Button } from '@/components/ui/button';
import type { Prospect } from '@/lib/creator-prospecting';

const labels = { checking: '检查中', pending: '等待写入', writing: '写入中', success: '已完成', failed: '同步失败', unknown: '结果待核实', review: '待确认' };
export function ProspectWriteStatusLine({ prospect, onRetry }: { prospect: Prospect; onRetry: (prospect: Prospect) => void }) {
  return <div className="flex flex-col gap-2">
    {prospect.resourceContentTypeNotice ? <span className="text-xs text-muted-foreground">{prospect.resourceContentTypeNotice}</span> : null}
    {prospect.stageSyncNotice ? <span className="text-xs text-muted-foreground">{prospect.stageSyncNotice}</span> : null}
    <TaskStatus prospect={prospect} onRetry={onRetry} />
    {(prospect.feishuWriteBacklog || []).filter((task) => task.status !== 'success').map((task) => <TaskStatus key={task.id} prospect={{ ...prospect, feishuWriteTask: task }} onRetry={onRetry} />)}
  </div>;
}
function TaskStatus({ prospect, onRetry }: { prospect: Prospect; onRetry: (prospect: Prospect) => void }) {
  const task = prospect.feishuWriteTask;
  if (!task) return null;
  const busy = ['checking', 'writing'].includes(task.status);
  const completed = task.steps.filter((step) => step.status === 'success').length;
  const developmentCreated = task.steps.some((step) => step.key === 'development' && step.status === 'success');
  const optionalOnly = developmentCreated && task.steps.filter((step) => step.status !== 'success').every((step) => step.key === 'email' || step.key === 'invitation');
  return <div className="flex max-w-sm flex-col gap-1 text-xs" role="status">
    <span>{task.status !== 'success' && optionalOnly ? '开发记录已创建，可继续写信；附带同步未完成' : labels[task.status]}{task.steps.length > 1 ? `（${completed}/${task.steps.length}）` : ''}</span>
    {busy && task.progress ? <span className="text-muted-foreground">{task.progress}</span> : null}
    {task.preparationMs !== undefined && !busy ? <span className="text-muted-foreground">准备耗时 {(task.preparationMs / 1000).toFixed(1)} 秒</span> : null}
    {task.error ? <span className="text-destructive">{task.error}</span> : null}
    {!busy && task.status !== 'success' ? <Button variant="outline" size="sm" onClick={() => onRetry(prospect)}>
      {task.status === 'unknown' ? '核实结果' : task.status === 'review' ? '查看 / 处理' : '重试未完成步骤'}
    </Button> : null}
  </div>;
}
