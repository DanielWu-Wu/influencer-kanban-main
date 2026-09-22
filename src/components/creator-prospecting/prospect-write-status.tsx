'use client';
import { Button } from '@/components/ui/button';
import type { Prospect } from '@/lib/creator-prospecting';

const labels = { checking: '检查中', pending: '等待写入', writing: '写入中', success: '已完成', failed: '同步失败', unknown: '结果待核实', review: '待确认' };
export function ProspectWriteStatusLine({ prospect, onRetry }: { prospect: Prospect; onRetry: (prospect: Prospect) => void }) {
  return <div className="flex flex-col gap-2">
    <TaskStatus prospect={prospect} onRetry={onRetry} />
    {(prospect.feishuWriteBacklog || []).filter((task) => task.status !== 'success').map((task) => <TaskStatus key={task.id} prospect={{ ...prospect, feishuWriteTask: task }} onRetry={onRetry} />)}
  </div>;
}
function TaskStatus({ prospect, onRetry }: { prospect: Prospect; onRetry: (prospect: Prospect) => void }) {
  const task = prospect.feishuWriteTask;
  if (!task) return null;
  const busy = ['checking', 'writing'].includes(task.status);
  const completed = task.steps.filter((step) => step.status === 'success').length;
  return <div className="flex max-w-sm flex-col gap-1 text-xs" role="status">
    <span>{labels[task.status]}{task.steps.length > 1 ? `（${completed}/${task.steps.length}）` : ''}</span>
    {task.error ? <span className="text-destructive">{task.error}</span> : null}
    {!busy && task.status !== 'success' ? <Button variant="outline" size="sm" onClick={() => onRetry(prospect)}>
      {task.status === 'unknown' ? '核实结果' : task.status === 'review' ? '查看 / 处理' : '重试未完成步骤'}
    </Button> : null}
  </div>;
}
