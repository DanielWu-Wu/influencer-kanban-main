import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { TodoItem } from '@/lib/types';

export function ProjectReminderLink({ todo, onOpen }: { todo: TodoItem; onOpen?: (todo: TodoItem) => void }) {
  if (!todo.projectReminder || !onOpen) return null;
  return <Button type="button" size="sm" variant="ghost" className="h-7 shrink-0 gap-1 px-2 text-xs text-primary" onClick={() => onOpen(todo)}>
    {todo.projectReminder.target === 'mail' ? '打开邮件' : '打开项目'}<ArrowRight className="size-3.5" />
  </Button>;
}
