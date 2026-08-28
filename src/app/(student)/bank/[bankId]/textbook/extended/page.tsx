'use client';

import React, { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { BookOpen, Bookmark, ChevronRight, Library, Search } from 'lucide-react';

interface ReferenceChapter {
  id: string;
  name: string;
  category: string;
  contentHtml: string;
}

const CHAPTERS: ReferenceChapter[] = [
  {
    id: 'ref-1',
    name: 'Antiplatelet Therapy: Trial Evidence and Advanced Prescribing',
    category: 'Cardiology',
    contentHtml:
      '<h3>Extended textbook note</h3><p>This library keeps the longer-form explanations, guideline nuance, and edge-case prescribing details that sit beyond the quick high-yield summary.</p><h4>Key additions</h4><ul><li>Dual antiplatelet duration by presentation and bleeding risk.</li><li>PPI selection when CYP2C19 interaction matters.</li><li>Common exam traps around secondary prevention.</li></ul>',
  },
  {
    id: 'ref-2',
    name: 'Multiple Sclerosis: Imaging Patterns and Differential Diagnosis',
    category: 'Neurology',
    contentHtml:
      '<h3>Advanced review</h3><p>Use this section when you need to separate classic MRI findings from mimics such as small vessel disease, neuromyelitis optica, and vasculitis.</p><h4>Focus areas</h4><ul><li>Periventricular lesion pattern and dissemination criteria.</li><li>Spinal cord lesion length and red flags.</li><li>When CSF oligoclonal bands change diagnostic confidence.</li></ul>',
  },
  {
    id: 'ref-3',
    name: 'Acid-Base Disorders: Full Interpretation Framework',
    category: 'Clinical Sciences',
    contentHtml:
      '<h3>Structured interpretation</h3><p>This chapter expands the rapid exam approach into a full framework covering compensation, mixed disorders, delta gaps, and common intensive-care patterns.</p><h4>Checklist</h4><ul><li>Primary process first.</li><li>Expected compensation second.</li><li>Always screen for a mixed picture.</li></ul>',
  },
];

function ExtendedTextbookContent() {
  const searchParams = useSearchParams();
  const initialChapterId = searchParams.get('note');

  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [activeChapter, setActiveChapter] = useState<ReferenceChapter>(
    CHAPTERS.find((chapter) => chapter.id === initialChapterId) || CHAPTERS[0]
  );

  const categories = ['All', ...Array.from(new Set(CHAPTERS.map((chapter) => chapter.category)))];

  const filteredChapters = CHAPTERS.filter((chapter) => {
    const matchesSearch =
      chapter.name.toLowerCase().includes(search.toLowerCase()) ||
      chapter.category.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = selectedCategory === 'All' || chapter.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-16 text-xs sm:text-sm">
      <div className="bg-white dark:bg-slate-900 rounded-xl p-5 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 flex items-center justify-center">
            <Library className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900 dark:text-white">Extended Textbook</h1>
            <p className="text-xs text-slate-500">
              Long-form explanations, guideline nuance, and deeper clinical reasoning for each bank topic.
            </p>
          </div>
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search reference chapters..."
            className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-xs text-slate-900 outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900 lg:col-span-4">
          <div className="flex gap-1.5 overflow-x-auto border-b border-slate-100 p-3 dark:border-slate-800">
            {categories.map((category) => (
              <button
                key={category}
                type="button"
                onClick={() => setSelectedCategory(category)}
                className={`whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold transition-all ${
                  selectedCategory === category
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
                }`}
              >
                {category}
              </button>
            ))}
          </div>

          <div className="max-h-[600px] divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
            {filteredChapters.map((chapter) => {
              const isSelected = activeChapter.id === chapter.id;
              return (
                <button
                  key={chapter.id}
                  type="button"
                  onClick={() => setActiveChapter(chapter)}
                  className={`flex w-full items-center justify-between gap-3 p-3.5 text-left transition-colors ${
                    isSelected
                      ? 'border-l-4 border-blue-600 bg-blue-50/70 dark:bg-blue-950/40'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                  }`}
                >
                  <div className="truncate">
                    <p className={`truncate text-xs font-semibold ${isSelected ? 'text-blue-900 dark:text-blue-200' : 'text-slate-900 dark:text-white'}`}>
                      {chapter.name}
                    </p>
                    <span className="text-[11px] font-medium text-slate-400">{chapter.category}</span>
                  </div>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                </button>
              );
            })}
          </div>
        </div>

        <div className="min-h-[500px] rounded-xl border border-slate-200 bg-white p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900 lg:col-span-8 sm:p-8">
          <div className="flex items-center justify-between border-b border-slate-200 pb-4 dark:border-slate-800">
            <div>
              <span className="rounded bg-amber-100 px-2.5 py-0.5 text-[11px] font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                {activeChapter.category}
              </span>
              <h2 className="mt-1.5 text-xl font-bold text-slate-900 dark:text-white">{activeChapter.name}</h2>
            </div>

            <button
              type="button"
              className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
              title="Bookmark chapter"
            >
              <Bookmark className="h-4 w-4" />
            </button>
          </div>

          <div
            className="pm-explanation-container pt-6 leading-relaxed text-slate-800 dark:text-slate-200"
            dangerouslySetInnerHTML={{ __html: activeChapter.contentHtml }}
          />

          <div className="mt-8 rounded-xl bg-slate-50 p-4 dark:bg-slate-800/40">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
              <BookOpen className="h-4 w-4 text-blue-600" />
              <span>How to use this page</span>
            </div>
            <p className="mt-2 text-xs leading-6 text-slate-500 dark:text-slate-300">
              Use the high-yield textbook for rapid recall, then open the extended textbook when you need nuance, guidelines, or full differential framing.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ExtendedTextbookPage() {
  return (
    <Suspense fallback={<div className="p-12 text-center text-slate-400 text-xs">Loading extended textbook...</div>}>
      <ExtendedTextbookContent />
    </Suspense>
  );
}
