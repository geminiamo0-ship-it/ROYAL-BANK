'use client';

import React, { useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { 
  BookOpen, 
  Search, 
  Bookmark, 
  ChevronRight
} from 'lucide-react';

interface ArticleItem {
  id: string;
  name: string;
  category: string;
  content_html: string;
}

const SAMPLE_ARTICLES: ArticleItem[] = [
  {
    id: '1_372',
    name: 'Clopidogrel and Antiplatelet Therapy',
    category: 'Cardiology',
    content_html: `
      <h3>Clopidogrel</h3>
      <p>Clopidogrel is an antiplatelet agent used in the secondary prevention of cardiovascular events.</p>
      <h4>Mechanism of Action</h4>
      <p>It is an oral, thienopyridine-class P2Y12 receptor antagonist that irreversibly inhibits platelet aggregation induced by ADP.</p>
      <h4>Key Clinical Indications</h4>
      <ul>
        <li>Acute Coronary Syndrome (STEMI / NSTEMI) in combination with aspirin (Dual Antiplatelet Therapy - DAPT).</li>
        <li>Ischaemic stroke or Transient Ischaemic Attack (TIA) as monotherapy.</li>
        <li>Peripheral arterial disease.</li>
      </ul>
      <h4>Interactions & Contraindications</h4>
      <p>Clopidogrel is a prodrug metabolized by <strong>CYP2C19</strong>. Proton Pump Inhibitors (PPIs) such as omeprazole may reduce its antiplatelet efficacy. Pantoprazole or H2-receptor antagonists are preferred alternatives when gastroprotection is required.</p>
    `,
  },
  {
    id: '1_881',
    name: 'Multiple Sclerosis: Diagnostic Criteria & Investigations',
    category: 'Neurology',
    content_html: `
      <h3>Multiple Sclerosis (MS)</h3>
      <p>Multiple sclerosis is an autoimmune, inflammatory, demyelinating disease of the central nervous system.</p>
      <h4>Diagnostic Criteria (McDonald Criteria)</h4>
      <p>Requires demonstration of dissemination in <strong>time</strong> and dissemination in <strong>space</strong>.</p>
      <h4>Key Diagnostic Investigations</h4>
      <ul>
        <li><strong>MRI Brain and Spinal Cord with Gadolinium:</strong> High-sensitivity imaging showing periventricular white matter lesions (Dawson's fingers).</li>
        <li><strong>Lumbar Puncture / CSF Analysis:</strong> Oligoclonal bands present in CSF that are absent in serum (matched paired samples).</li>
        <li><strong>Visual Evoked Potentials (VEPs):</strong> Delayed P100 latency demonstrating subclinical optic nerve demyelination.</li>
      </ul>
    `,
  },
  {
    id: '1_861',
    name: 'DiGeorge Syndrome (22q11.2 Deletion)',
    category: 'Clinical Sciences',
    content_html: `
      <h3>DiGeorge Syndrome</h3>
      <p>Caused by a microdeletion on chromosome 22q11.2 resulting in failure of development of the 3rd and 4th pharyngeal pouches.</p>
      <h4>Classic Presentation (CATCH-22)</h4>
      <ul>
        <li><strong>C:</strong> Cardiac defects (Tetralogy of Fallot, Truncus Arteriosus, Interrupted aortic arch).</li>
        <li><strong>A:</strong> Abnormal facies (low-set ears, micrognathia).</li>
        <li><strong>T:</strong> Thymic hypoplasia / aplasia (T-cell immunodeficiency).</li>
        <li><strong>C:</strong> Cleft palate.</li>
        <li><strong>H:</strong> Hypocalcaemia (due to parathyroid gland hypoplasia causing hypoparathyroidism).</li>
        <li><strong>22:</strong> 22q11.2 microdeletion detected via FISH or microarray.</li>
      </ul>
    `,
  },
];

function TextbookContent() {
  const searchParams = useSearchParams();
  const initialNoteId = searchParams.get('note');

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [activeArticle, setActiveArticle] = useState<ArticleItem>(
    SAMPLE_ARTICLES.find((a) => a.id === initialNoteId) || SAMPLE_ARTICLES[0]
  );

  const categories = ['All', ...Array.from(new Set(SAMPLE_ARTICLES.map((a) => a.category)))];

  const filteredArticles = SAMPLE_ARTICLES.filter((art) => {
    const matchesSearch =
      art.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      art.category.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === 'All' || art.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-16 text-xs sm:text-sm">
      {/* Header Banner */}
      <div className="bg-white dark:bg-slate-900 rounded-xl p-5 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-pink-100 dark:bg-pink-950/60 text-pink-700 dark:text-pink-300 flex items-center justify-center font-bold">
            <BookOpen className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900 dark:text-white">
              High-Yield Clinical Textbook
            </h1>
            <p className="text-xs text-slate-500">
              650+ comprehensive medical revision articles mapped to MRCP Part 1 questions
            </p>
          </div>
        </div>

        {/* Search */}
        <div className="w-full sm:w-72 relative">
          <Search className="h-4 w-4 absolute left-3 top-2.5 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search textbook topics..."
            className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Main Split Layout: Chapter List & Article Viewer */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left List of Chapters */}
        <div className="lg:col-span-4 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
          {/* Category Pills */}
          <div className="p-3 border-b border-slate-100 dark:border-slate-800 flex gap-1.5 overflow-x-auto">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-2.5 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap transition-all ${
                  selectedCategory === cat
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Articles list */}
          <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-[600px] overflow-y-auto">
            {filteredArticles.map((art) => {
              const isSelected = activeArticle?.id === art.id;
              return (
                <button
                  key={art.id}
                  onClick={() => setActiveArticle(art)}
                  className={`w-full p-3.5 text-left flex items-center justify-between gap-3 transition-colors ${
                    isSelected
                      ? 'bg-blue-50/70 dark:bg-blue-950/40 border-l-4 border-blue-600'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                  }`}
                >
                  <div className="truncate">
                    <p className={`font-semibold text-xs truncate ${isSelected ? 'text-blue-900 dark:text-blue-200' : 'text-slate-900 dark:text-white'}`}>
                      {art.name}
                    </p>
                    <span className="text-[11px] text-slate-400 font-medium">
                      {art.category}
                    </span>
                  </div>
                  <ChevronRight className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                </button>
              );
            })}
          </div>
        </div>

        {/* Right Article Reader */}
        <div className="lg:col-span-8 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-6 sm:p-8 shadow-xs space-y-4 min-h-[500px]">
          {activeArticle ? (
            <div>
              <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-800">
                <div>
                  <span className="px-2.5 py-0.5 rounded text-[11px] font-bold bg-pink-100 text-pink-800 dark:bg-pink-950 dark:text-pink-300">
                    {activeArticle.category}
                  </span>
                  <h2 className="text-xl font-bold text-slate-900 dark:text-white mt-1.5">
                    {activeArticle.name}
                  </h2>
                </div>

                <button
                  className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800"
                  title="Bookmark Chapter"
                >
                  <Bookmark className="h-4 w-4" />
                </button>
              </div>

              <div
                className="pm-explanation-container pt-6 text-slate-800 dark:text-slate-200 leading-relaxed"
                dangerouslySetInnerHTML={{ __html: activeArticle.content_html }}
              />
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-slate-400">
              Select a textbook chapter from the left to read.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function HighYieldTextbookPage() {
  return (
    <Suspense fallback={<div className="p-12 text-center text-slate-400 text-xs">Loading textbook...</div>}>
      <TextbookContent />
    </Suspense>
  );
}
