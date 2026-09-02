'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Eraser,
  Highlighter,
  ImagePlus,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Link,
  List,
  ListOrdered,
  Quote,
  Redo2,
  Smile,
  Strikethrough,
  Underline,
  Undo2,
  Unlink,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { isEmailContentEmpty } from '@/lib/email-content';
import { sanitizeEmailHtmlForEditor } from '@/lib/email-editor-html';
import { cn } from '@/lib/utils';

const EMOJIS = [
  '\u{1F600}', '\u{1F60A}', '\u{1F44D}', '\u{1F64F}', '\u{1F389}',
  '\u2728', '\u2764\uFE0F', '\u{1F91D}', '\u{1F4E9}', '\u{1F381}',
  '\u{1F4C5}', '\u2705', '\u{1F4A1}', '\u{1F680}', '\u{1F64C}',
];

const STATE_COMMANDS = [
  'bold',
  'italic',
  'underline',
  'strikeThrough',
  'justifyLeft',
  'justifyCenter',
  'justifyRight',
  'justifyFull',
  'insertUnorderedList',
  'insertOrderedList',
] as const;

function ToolbarButton({
  label,
  icon,
  active = false,
  onAction,
}: {
  label: string;
  icon: ReactNode;
  active?: boolean;
  onAction: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant={active ? 'secondary' : 'ghost'}
          size="icon"
          className="h-8 w-8 shrink-0 rounded-lg hover:bg-white/80"
          aria-label={label}
          aria-pressed={active}
          onMouseDown={(event) => event.preventDefault()}
          onClick={onAction}
        >
          {icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function RichEmailEditor({
  value,
  onChange,
  placeholder = '输入邮件内容...',
  minHeight = '12rem',
  fillHeight = false,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minHeight?: string;
  fillHeight?: boolean;
  className?: string;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const savedRangeRef = useRef<Range | null>(null);
  const lastEmittedValue = useRef<string | null>(null);
  const composing = useRef(false);
  const [formatSimplified, setFormatSimplified] = useState(false);
  const [activeCommands, setActiveCommands] = useState<Set<string>>(new Set());
  const [textColor, setTextColor] = useState('#202124');
  const [highlightColor, setHighlightColor] = useState('#fff2a8');

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || composing.current || value === lastEmittedValue.current) return;
    const cleaned = sanitizeEmailHtmlForEditor(value);
    if (editor.innerHTML !== cleaned.html) {
      editor.innerHTML = cleaned.html;
      savedRangeRef.current = null;
    }
    setFormatSimplified(cleaned.simplified);
  }, [value]);

  const emitChange = useCallback(() => {
    const html = editorRef.current?.innerHTML || '';
    lastEmittedValue.current = html;
    onChange(html);
  }, [onChange]);

  const updateCommandState = useCallback(() => {
    const next = new Set<string>();
    STATE_COMMANDS.forEach((command) => {
      try {
        if (document.queryCommandState(command)) next.add(command);
      } catch {
        // Some browsers do not expose every command state.
      }
    });
    setActiveCommands(next);
  }, []);

  const saveSelection = useCallback(() => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (editor.contains(range.commonAncestorContainer)) {
      savedRangeRef.current = range.cloneRange();
    }
    updateCommandState();
  }, [updateCommandState]);

  const restoreSelection = useCallback(() => {
    const editor = editorRef.current;
    editor?.focus();
    const range = savedRangeRef.current;
    if (!range) return;
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, []);

  const runCommand = useCallback((command: string, commandValue?: string) => {
    restoreSelection();
    document.execCommand('styleWithCSS', false, 'true');
    document.execCommand(command, false, commandValue);
    saveSelection();
    emitChange();
  }, [emitChange, restoreSelection, saveSelection]);

  const insertExternalContent = useCallback((html: string, text: string) => {
    if (html) {
      const cleaned = sanitizeEmailHtmlForEditor(html);
      if (cleaned.simplified) setFormatSimplified(true);
      runCommand('insertHTML', cleaned.html);
    } else {
      runCommand('insertText', text);
    }
  }, [runCommand]);

  const insertLink = useCallback(() => {
    const url = window.prompt('请输入链接地址，例如 https://example.com');
    if (!url) return;
    const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    restoreSelection();
    const selection = window.getSelection();
    if (selection?.isCollapsed) {
      document.execCommand(
        'insertHTML',
        false,
        (() => {
          const link = document.createElement('a');
          link.href = normalized;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.textContent = normalized;
          return sanitizeEmailHtmlForEditor(link.outerHTML).html;
        })(),
      );
      emitChange();
      saveSelection();
      return;
    }
    runCommand('createLink', normalized);
  }, [emitChange, restoreSelection, runCommand, saveSelection]);

  const insertImage = useCallback(() => {
    const url = window.prompt('请输入公开图片地址（https://...）');
    if (!url) return;
    const normalized = /^https:\/\//i.test(url) ? url : `https://${url.replace(/^https?:\/\//i, '')}`;
    runCommand('insertImage', normalized);
  }, [runCommand]);

  const insertEmoji = useCallback((emoji: string) => {
    restoreSelection();
    document.execCommand('insertText', false, emoji);
    emitChange();
    saveSelection();
  }, [emitChange, restoreSelection, saveSelection]);

  return (
    <div
      className={cn(
        'min-w-0 max-w-full overflow-hidden rounded-lg border border-white/65 bg-white/75 shadow-sm backdrop-blur-xl',
        fillHeight && 'flex min-h-0 flex-col',
        className,
      )}
    >
      <div className={cn('relative isolate min-w-0 max-w-full overflow-hidden [contain:inline-size_layout_paint]', fillHeight && 'min-h-0 flex-1')}>
        {isEmailContentEmpty(value) && (
          <div className="pointer-events-none absolute left-3 top-3 text-sm text-muted-foreground">
            {placeholder}
          </div>
        )}
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-label="邮件正文"
          aria-multiline="true"
          className={cn(
            'min-w-0 max-w-full overflow-x-hidden overflow-y-auto break-words px-3 py-3 outline-none [overflow-wrap:anywhere] [&_a]:break-all [&_a]:text-blue-600 [&_a]:underline [&_blockquote]:border-l-4 [&_blockquote]:border-muted-foreground/30 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_img]:my-2 [&_img]:max-w-full [&_ol]:ml-5 [&_ol]:list-decimal [&_ul]:ml-5 [&_ul]:list-disc',
            fillHeight && 'absolute inset-0',
          )}
          style={{
            color: '#202124',
            fontFamily: 'Arial, sans-serif',
            fontSize: '14px',
            lineHeight: 'normal',
            maxHeight: fillHeight ? undefined : 'min(60vh, 40rem)',
            ...(fillHeight ? {} : { minHeight }),
          }}
          onFocus={saveSelection}
          onCompositionStart={() => { composing.current = true; }}
          onCompositionEnd={() => {
            composing.current = false;
            emitChange();
            saveSelection();
          }}
          onPaste={(event) => {
            const html = event.clipboardData.getData('text/html');
            const text = event.clipboardData.getData('text/plain');
            if (!html && !text) return; // File/attachment handling stays with its owner.
            event.preventDefault();
            saveSelection();
            insertExternalContent(html, text);
          }}
          onDragOver={(event) => {
            if (event.dataTransfer.types.some((type) => type === 'text/html' || type === 'text/plain')) event.preventDefault();
          }}
          onDrop={(event) => {
            const html = event.dataTransfer.getData('text/html');
            const text = event.dataTransfer.getData('text/plain');
            if (!html && !text) return;
            event.preventDefault();
            const range = document.caretRangeFromPoint(event.clientX, event.clientY);
            if (range && editorRef.current?.contains(range.commonAncestorContainer)) savedRangeRef.current = range;
            insertExternalContent(html, text);
          }}
          onInput={() => {
            emitChange();
            saveSelection();
          }}
          onKeyUp={saveSelection}
          onMouseUp={saveSelection}
        />
      </div>

      {formatSimplified && (
        <Alert role="status" className="shrink-0 rounded-none border-x-0 px-3 py-1">
          <AlertDescription>为保护工作台布局，已简化部分邮件格式</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap items-center gap-0.5 border-t border-white/60 bg-white/65 px-2 py-1">
        <ToolbarButton label="撤销" icon={<Undo2 className="h-4 w-4" />} onAction={() => runCommand('undo')} />
        <ToolbarButton label="重做" icon={<Redo2 className="h-4 w-4" />} onAction={() => runCommand('redo')} />
        <div className="mx-1 h-5 w-px bg-border" />

        <select
          aria-label="字体"
          className="h-8 max-w-32 rounded-lg border-0 bg-transparent px-1 text-xs outline-none hover:bg-white/80"
          defaultValue="sans-serif"
          onMouseDown={saveSelection}
          onChange={(event) => runCommand('fontName', event.target.value)}
        >
          <option value="sans-serif">Sans Serif</option>
          <option value="Arial">Arial</option>
          <option value="Georgia">Georgia</option>
          <option value="Times New Roman">Times New Roman</option>
          <option value="Verdana">Verdana</option>
          <option value="Tahoma">Tahoma</option>
          <option value="Courier New">Courier New</option>
        </select>
        <select
          aria-label="文字大小"
          className="h-8 rounded-lg border-0 bg-transparent px-1 text-xs outline-none hover:bg-white/80"
          defaultValue="3"
          onMouseDown={saveSelection}
          onChange={(event) => runCommand('fontSize', event.target.value)}
        >
          <option value="1">很小</option>
          <option value="2">小</option>
          <option value="3">正常</option>
          <option value="4">大</option>
          <option value="5">很大</option>
          <option value="6">超大</option>
        </select>
        <div className="mx-1 h-5 w-px bg-border" />

        <ToolbarButton label="粗体" icon={<Bold className="h-4 w-4" />} active={activeCommands.has('bold')} onAction={() => runCommand('bold')} />
        <ToolbarButton label="斜体" icon={<Italic className="h-4 w-4" />} active={activeCommands.has('italic')} onAction={() => runCommand('italic')} />
        <ToolbarButton label="下划线" icon={<Underline className="h-4 w-4" />} active={activeCommands.has('underline')} onAction={() => runCommand('underline')} />
        <ToolbarButton label="删除线" icon={<Strikethrough className="h-4 w-4" />} active={activeCommands.has('strikeThrough')} onAction={() => runCommand('strikeThrough')} />

        <label className="relative flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg hover:bg-white/80" title="文字颜色">
          <span className="border-b-2 text-sm font-semibold" style={{ color: textColor, borderColor: textColor }}>A</span>
          <input
            type="color"
            value={textColor}
            className="absolute inset-0 cursor-pointer opacity-0"
            onMouseDown={saveSelection}
            onChange={(event) => {
              setTextColor(event.target.value);
              runCommand('foreColor', event.target.value);
            }}
          />
        </label>
        <label className="relative flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg hover:bg-white/80" title="背景颜色">
          <Highlighter className="h-4 w-4" style={{ color: highlightColor }} />
          <input
            type="color"
            value={highlightColor}
            className="absolute inset-0 cursor-pointer opacity-0"
            onMouseDown={saveSelection}
            onChange={(event) => {
              setHighlightColor(event.target.value);
              runCommand('hiliteColor', event.target.value);
            }}
          />
        </label>
        <div className="mx-1 h-5 w-px bg-border" />

        <ToolbarButton label="左对齐" icon={<AlignLeft className="h-4 w-4" />} active={activeCommands.has('justifyLeft')} onAction={() => runCommand('justifyLeft')} />
        <ToolbarButton label="居中" icon={<AlignCenter className="h-4 w-4" />} active={activeCommands.has('justifyCenter')} onAction={() => runCommand('justifyCenter')} />
        <ToolbarButton label="右对齐" icon={<AlignRight className="h-4 w-4" />} active={activeCommands.has('justifyRight')} onAction={() => runCommand('justifyRight')} />
        <ToolbarButton label="两端对齐" icon={<AlignJustify className="h-4 w-4" />} active={activeCommands.has('justifyFull')} onAction={() => runCommand('justifyFull')} />
        <ToolbarButton label="编号列表" icon={<ListOrdered className="h-4 w-4" />} active={activeCommands.has('insertOrderedList')} onAction={() => runCommand('insertOrderedList')} />
        <ToolbarButton label="项目列表" icon={<List className="h-4 w-4" />} active={activeCommands.has('insertUnorderedList')} onAction={() => runCommand('insertUnorderedList')} />
        <ToolbarButton label="减少缩进" icon={<IndentDecrease className="h-4 w-4" />} onAction={() => runCommand('outdent')} />
        <ToolbarButton label="增加缩进" icon={<IndentIncrease className="h-4 w-4" />} onAction={() => runCommand('indent')} />
        <div className="mx-1 h-5 w-px bg-border" />

        <ToolbarButton label="插入链接" icon={<Link className="h-4 w-4" />} onAction={insertLink} />
        <ToolbarButton label="移除链接" icon={<Unlink className="h-4 w-4" />} onAction={() => runCommand('unlink')} />
        <ToolbarButton label="插入网络图片" icon={<ImagePlus className="h-4 w-4" />} onAction={insertImage} />
        <ToolbarButton label="引用" icon={<Quote className="h-4 w-4" />} onAction={() => runCommand('formatBlock', 'blockquote')} />

        <Popover>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded-lg hover:bg-white/80"
                  aria-label="插入表情"
                  onMouseDown={saveSelection}
                >
                  <Smile className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent>插入表情</TooltipContent>
          </Tooltip>
          <PopoverContent align="start" className="grid w-52 grid-cols-5 gap-1 rounded-lg border-white/65 bg-white/90 p-2 shadow-apple backdrop-blur-xl">
            {EMOJIS.map((emoji) => (
              <Button
                key={emoji}
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-lg text-lg hover:bg-white/80"
                onClick={() => insertEmoji(emoji)}
              >
                {emoji}
              </Button>
            ))}
          </PopoverContent>
        </Popover>
        <ToolbarButton label="清除格式" icon={<Eraser className="h-4 w-4" />} onAction={() => runCommand('removeFormat')} />
      </div>
    </div>
  );
}
