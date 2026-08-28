'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { 
  Map, 
  Search, 
  ChevronRight, 
  Activity, 
  Stethoscope, 
  Layers 
} from 'lucide-react';

interface ContentMapNode {
  symptom: string;
  category: string;
  conditions: { name: string; questionCount: number }[];
}

const CONTENT_MAP_DATA: ContentMapNode[] = [
  {
    symptom: 'Chest Pain / Acute Coronary Syndrome',
    category: 'Cardiology',
    conditions: [
      { name: 'ST-Elevation Myocardial Infarction (STEMI)', questionCount: 42 },
      { name: 'Non-ST Elevation Myocardial Infarction (NSTEMI)', questionCount: 38 },
      { name: 'Acute Pericarditis & Myocarditis', questionCount: 29 },
      { name: 'Aortic Dissection (Stanford Type A & B)', questionCount: 31 },
    ],
  },
  {
    symptom: 'Acute Headache & Neurological Deficits',
    category: 'Neurology',
    conditions: [
      { name: 'Acute Ischaemic Stroke & Thrombolysis Protocols', questionCount: 48 },
      { name: 'Subarachnoid Haemorrhage (SAH)', questionCount: 35 },
      { name: 'Temporal Arteritis (Giant Cell Arteritis)', questionCount: 27 },
      { name: 'Migraine with Aura & Cluster Headache', questionCount: 22 },
    ],
  },
  {
    symptom: 'Polyuria, Polydipsia & Metabolic Derangement',
    category: 'Endocrinology',
    conditions: [
      { name: 'Diabetic Ketoacidosis (DKA) Management', questionCount: 40 },
      { name: 'Hyperosmolar Hyperglycaemic State (HHS)', questionCount: 25 },
      { name: 'Diabetes Insipidus (Central vs Nephrogenic)', questionCount: 19 },
      { name: 'Primary Hyperparathyroidism & Hypercalcaemia', questionCount: 33 },
    ],
  },
];

export default function ContentMapPage() {
  const params = useParams();
  const bankId = params.bankId || '1';
  const [search, setSearch] = useState('');

  const filtered = CONTENT_MAP_DATA.filter((n) =>
    n.symptom.toLowerCase().includes(search.toLowerCase()) ||
    n.category.toLowerCase().includes(search.toLowerCase()) ||
    n.conditions.some((c) => c.name.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-16 text-xs sm:text-sm">
      {/* Header Banner */}
      <div className="bg-white dark:bg-slate-900 rounded-xl p-5 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 flex items-center justify-center font-bold">
            <Map className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold text-slate-900 dark:text-white">
                Clinical Content Map
              </h1>
              <span className="px-2 py-0.5 rounded text-[10px] font-extrabold bg-amber-400 text-slate-950">
                BETA
              </span>
            </div>
            <p className="text-xs text-slate-500">
              Interactive diagnostic hierarchy connecting presentations to clinical conditions
            </p>
          </div>
        </div>

        <div className="w-full sm:w-72 relative">
          <Search className="h-4 w-4 absolute left-3 top-2.5 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search symptoms or diseases..."
            className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Map Nodes */}
      <div className="space-y-4">
        {filtered.map((node, idx) => (
          <div
            key={idx}
            className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <Activity className="h-4 w-4 text-emerald-600" />
                <span className="font-bold text-slate-900 dark:text-white text-sm">
                  {node.symptom}
                </span>
              </div>
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                {node.category}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              {node.conditions.map((cond, cIdx) => (
                <Link
                  key={cIdx}
                  href={`/bank/${bankId}/question-bank`}
                  className="p-3 rounded-lg border border-slate-100 dark:border-slate-800 hover:border-blue-500/50 bg-slate-50/50 dark:bg-slate-800/30 flex items-center justify-between group transition-colors"
                >
                  <span className="font-semibold text-xs text-slate-800 dark:text-slate-200 group-hover:text-blue-600 dark:group-hover:text-blue-400">
                    {cond.name}
                  </span>
                  <span className="text-[11px] text-slate-400 flex items-center gap-1 shrink-0">
                    <span>{cond.questionCount} Qs</span>
                    <ChevronRight className="h-3.5 w-3.5" />
                  </span>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
