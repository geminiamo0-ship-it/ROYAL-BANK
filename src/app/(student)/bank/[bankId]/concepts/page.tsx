'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { List, Search, Lightbulb } from 'lucide-react';

const CONCEPTS_LIST = [
  { id: 1, text: 'Clopidogrel is an ADP receptor antagonist metabolized by CYP2C19.', category: 'Cardiology', questionCount: 14 },
  { id: 2, text: 'Multiple Sclerosis diagnosis requires dissemination in time and space (McDonald Criteria).', category: 'Neurology', questionCount: 22 },
  { id: 3, text: 'DiGeorge Syndrome is associated with 22q11.2 microdeletion and hypocalcaemia.', category: 'Clinical Sciences', questionCount: 18 },
  { id: 4, text: 'Primary hyperparathyroidism typically presents with hypercalcaemia and hypophosphataemia.', category: 'Endocrinology', questionCount: 19 },
  { id: 5, text: 'Coeliac disease serology first-line screen is anti-TTG IgA with total serum IgA level.', category: 'Gastroenterology', questionCount: 26 },
];

export default function AllConceptsPage() {
  const params = useParams();
  const bankId = params.bankId || '1';
  const [search, setSearch] = useState('');

  const filtered = CONCEPTS_LIST.filter(c => 
    c.text.toLowerCase().includes(search.toLowerCase()) || 
    c.category.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-16 text-xs sm:text-sm">
      <div className="bg-white dark:bg-slate-900 rounded-xl p-5 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 flex items-center justify-center font-bold">
            <List className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900 dark:text-white">
              All Clinical Concepts
            </h1>
            <p className="text-xs text-slate-500">
              Core medical principles and testable facts across all specialties
            </p>
          </div>
        </div>

        <div className="w-full sm:w-72 relative">
          <Search className="h-4 w-4 absolute left-3 top-2.5 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search concepts..."
            className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800">
        {filtered.map(concept => (
          <div key={concept.id} className="p-4 flex items-start justify-between gap-4 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
            <div className="flex items-start gap-3">
              <Lightbulb className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-slate-900 dark:text-slate-100">{concept.text}</p>
                <span className="text-[11px] text-slate-400">{concept.category} • Tested in {concept.questionCount} questions</span>
              </div>
            </div>

            <Link
              href={`/bank/${bankId}/question-bank`}
              className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold text-xs shrink-0"
            >
              Practice
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
