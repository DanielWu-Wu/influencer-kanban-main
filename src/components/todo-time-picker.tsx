'use client';

import { useState } from 'react';
import { Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

const HOURS = Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, '0'));
const MINUTES = Array.from({ length: 60 }, (_, index) => String(index).padStart(2, '0'));

export function TodoTimePicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('09:00');
  const hour24 = Number(draft.slice(0, 2));
  const period = hour24 >= 12 ? '下午' : '上午';
  const hour = String(hour24 % 12 || 12).padStart(2, '0');
  const minute = draft.slice(3, 5);
  const columns = [
    { label: '时段', options: ['上午', '下午'], selected: period },
    { label: '小时', options: HOURS, selected: hour },
    { label: '分钟', options: MINUTES, selected: minute },
  ];

  function select(column: number, next: string) {
    const nextPeriod = column === 0 ? next : period;
    const nextHour = Number(column === 1 ? next : hour) % 12 + (nextPeriod === '下午' ? 12 : 0);
    setDraft(`${String(nextHour).padStart(2, '0')}:${column === 2 ? next : minute}`);
  }

  const display = value
    ? `${Number(value.slice(0, 2)) >= 12 ? '下午' : '上午'} ${String(Number(value.slice(0, 2)) % 12 || 12).padStart(2, '0')}:${value.slice(3, 5)}`
    : '选择时间';

  return (
    <Popover open={open} onOpenChange={(nextOpen) => {
      if (nextOpen) setDraft(value || '09:00');
      setOpen(nextOpen);
    }}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" aria-label={`截止时间：${display}`} className="w-full justify-between px-3 font-normal">
          {display}<Clock data-icon="inline-end" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-60 p-2" aria-label="选择截止时间">
        <div className="grid grid-cols-3 gap-2">
          {columns.map((column, columnIndex) => (
            <div key={column.label} className="min-w-0">
              <p className="mb-1 text-center text-xs text-muted-foreground">{column.label}</p>
              <div
                role="listbox"
                aria-label={column.label}
                className="h-48 overflow-y-auto overscroll-contain rounded-md border p-1"
                ref={(element) => {
                  if (!element) return;
                  const selected = element.querySelector<HTMLElement>('[aria-selected="true"]');
                  if (selected) element.scrollTop = selected.offsetTop - element.offsetTop - element.clientHeight / 2 + selected.clientHeight / 2;
                }}
              >
                {column.options.map((option, index) => (
                  <button
                    key={option}
                    type="button"
                    role="option"
                    aria-selected={column.selected === option}
                    tabIndex={column.selected === option ? 0 : -1}
                    className="flex h-8 w-full shrink-0 items-center justify-center rounded text-sm tabular-nums hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring aria-selected:bg-primary/10 aria-selected:font-semibold aria-selected:text-primary"
                    onClick={() => select(columnIndex, option)}
                    onKeyDown={(event) => {
                      const nextIndex = event.key === 'ArrowDown' ? Math.min(index + 1, column.options.length - 1)
                        : event.key === 'ArrowUp' ? Math.max(index - 1, 0)
                          : event.key === 'Home' ? 0 : event.key === 'End' ? column.options.length - 1 : null;
                      if (nextIndex === null) return;
                      event.preventDefault();
                      const target = event.currentTarget.parentElement?.children[nextIndex] as HTMLElement | undefined;
                      select(columnIndex, column.options[nextIndex]);
                      target?.focus();
                    }}
                  >{option}</button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-2 flex items-center justify-between border-t pt-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => { onChange(''); setOpen(false); }}>清空</Button>
          <Button type="button" size="sm" onClick={() => { onChange(draft); setOpen(false); }}>确定</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
