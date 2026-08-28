'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { 
  Zap, 
  Sparkles, 
  ChevronRight, 
  HelpCircle, 
  Eye, 
  EyeOff, 
  Check, 
  X,
  RotateCcw
} from 'lucide-react';

interface FlashcardFact {
  id: number;
  category: string;
  question: string;
  answer: string;
  explanation: string;
}

const SAMPLE_FACTS: FlashcardFact[] = [
  {
    id: 1,
    category: 'Cardiology',
    question: 'What is the most common cause of infective endocarditis in intravenous drug users (IVDUs)?',
    answer: 'Staphylococcus aureus',
    explanation: 'S. aureus commonly affects the tricuspid valve in IV drug users.',
  },
  {
    id: 2,
    category: 'Neurology',
    question: 'Which visual field defect is characteristically caused by a pituitary adenoma compressing the optic chiasm?',
    answer: 'Bitemporal hemianopia',
    explanation: 'Pressure on decussating nasal retinal fibres results in bitemporal visual field loss.',
  },
  {
    id: 3,
    category: 'Endocrinology',
    question: 'What is the first-line medical therapy for prolactinoma?',
    answer: 'Dopamine agonists (e.g. Cabergoline or Bromocriptine)',
    explanation: 'Dopamine inhibits prolactin secretion and causes tumour shrinkage in >80% of cases.',
  },
];

export default function KnowledgeTutorPage() {
  const params = useParams();
  const bankId = params.bankId || '1';

  const [currentIndex, setCurrentIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);

  const currentFact = SAMPLE_FACTS[currentIndex];

  const handleNext = () => {
    setShowAnswer(false);
    setCurrentIndex((prev) => (prev + 1) % SAMPLE_FACTS.length);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-16 text-xs sm:text-sm">
      {/* Header Banner */}
      <div className="bg-white dark:bg-slate-900 rounded-xl p-5 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 flex items-center justify-center font-bold">
            <Zap className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900 dark:text-white">
              Knowledge Tutor
            </h1>
            <p className="text-xs text-slate-500">
              Rapid-fire clinical recall and micro-learning flashcard tutor
            </p>
          </div>
        </div>

        <span className="font-semibold text-xs text-slate-400">
          Fact {currentIndex + 1} of {SAMPLE_FACTS.length}
        </span>
      </div>

      {/* Flashcard Card */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-8 shadow-sm space-y-6 min-h-[300px] flex flex-col justify-between">
        <div className="space-y-4">
          <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-300">
            {currentFact.category}
          </span>

          <h2 className="text-lg font-bold text-slate-900 dark:text-white leading-relaxed">
            {currentFact.question}
          </h2>

          {showAnswer && (
            <div className="mt-6 p-5 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 animate-in fade-in duration-300 space-y-2">
              <div className="flex items-center gap-2 text-emerald-800 dark:text-emerald-300 font-bold text-sm">
                <Check className="h-4 w-4" />
                <span>Answer: {currentFact.answer}</span>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-300">
                {currentFact.explanation}
              </p>
            </div>
          )}
        </div>

        {/* Card Actions */}
        <div className="flex items-center justify-between pt-6 border-t border-slate-100 dark:border-slate-800">
          <button
            onClick={() => setShowAnswer(!showAnswer)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 font-bold text-xs cursor-pointer transition-colors"
          >
            {showAnswer ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            <span>{showAnswer ? 'Hide Answer' : 'Reveal Answer'}</span>
          </button>

          <button
            onClick={handleNext}
            className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-xs cursor-pointer transition-colors"
          >
            <span>Next Fact</span>
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
