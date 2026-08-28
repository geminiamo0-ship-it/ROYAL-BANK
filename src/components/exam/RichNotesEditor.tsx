'use client';

import React, { useState, useEffect } from 'react';
import { saveUserNote } from '@/actions/exam';
import { useExamStore } from '@/stores/examStore';
import { 
  Bold, 
  Italic, 
  Highlighter, 
  List, 
  ListOrdered, 
  Table, 
  Image as ImageIcon, 
  Link as LinkIcon,
  Check
} from 'lucide-react';

interface RichNotesEditorProps {
  questionId: number;
}

export function RichNotesEditor({ questionId }: RichNotesEditorProps) {
  const { userNotes, setNote } = useExamStore();
  const [saved, setSaved] = useState(false);
  const content = userNotes[questionId] || '';

  useEffect(() => {
    if (!content.trim()) return;

    const timeoutId = window.setTimeout(async () => {
      try {
        await saveUserNote(questionId, content);
        setSaved(true);
        window.setTimeout(() => setSaved(false), 2000);
      } catch {
        setSaved(false);
      }
    }, 700);

    return () => window.clearTimeout(timeoutId);
  }, [content, questionId]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setNote(questionId, val);
  };

  return (
    <div className="mt-8 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden bg-white dark:bg-slate-900 shadow-xs">
      {/* Editor Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 text-xs">
        <div className="flex items-center gap-1 sm:gap-2">
          <button type="button" className="p-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 font-bold" title="Bold">
            <Bold className="h-3.5 w-3.5" />
          </button>
          <button type="button" className="p-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 italic" title="Italic">
            <Italic className="h-3.5 w-3.5" />
          </button>
          <button type="button" className="p-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-amber-500" title="Highlighter">
            <Highlighter className="h-3.5 w-3.5" />
          </button>
          <div className="h-4 w-px bg-slate-300 dark:bg-slate-700 mx-1" />
          <button type="button" className="p-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700" title="Bullet List">
            <List className="h-3.5 w-3.5" />
          </button>
          <button type="button" className="p-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700" title="Numbered List">
            <ListOrdered className="h-3.5 w-3.5" />
          </button>
          <button type="button" className="p-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700" title="Insert Table">
            <Table className="h-3.5 w-3.5" />
          </button>
          <button type="button" className="p-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700" title="Attach Image">
            <ImageIcon className="h-3.5 w-3.5" />
          </button>
          <button type="button" className="p-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700" title="Insert Link">
            <LinkIcon className="h-3.5 w-3.5" />
          </button>
        </div>

        {saved && (
          <span className="text-[11px] text-emerald-600 font-medium flex items-center gap-1">
            <Check className="h-3 w-3" /> Saved
          </span>
        )}
      </div>

      {/* Editor Body */}
      <textarea
        value={content}
        onChange={handleChange}
        placeholder="Type personal revision notes for this question here..."
        rows={3}
        className="w-full p-3.5 text-xs text-slate-800 dark:text-slate-100 bg-white dark:bg-slate-900 border-none resize-y focus:outline-none placeholder-slate-400"
      />
    </div>
  );
}
