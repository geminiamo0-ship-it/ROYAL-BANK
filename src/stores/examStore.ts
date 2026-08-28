import { create } from 'zustand';
import { Question, Option } from '@/types/database';

export interface UserExamAnswer {
  questionId: number;
  selectedOptionId: number | null;
  isCorrect: boolean;
  timeSpentSeconds: number;
}

interface ExamState {
  sessionId: string | null;
  questions: Question[];
  currentIndex: number;
  answers: Record<number, UserExamAnswer>;
  pendingSelections: Record<number, number | null>;
  flaggedQuestionIds: Set<number>;
  struckOutOptionIds: Set<number>;
  userNotes: Record<number, string>;
  activeHighlighterColor: string | null; // e.g. '#ffeb3b', '#a5d6a7', '#90caf9', '#f48fb1'
  isExamSubmitted: boolean;
  elapsedSeconds: number;
  timeLimitMinutes: number | null;
  isTimerRunning: boolean;
  showClues: boolean;

  // Actions
  initExam: (sessionId: string, questions: Question[], timeLimitMinutes?: number | null) => void;
  setCurrentIndex: (index: number) => void;
  nextQuestion: () => void;
  prevQuestion: () => void;
  selectOption: (questionId: number, option: Option) => void;
  submitAnswer: (questionId: number) => void;
  toggleFlag: (questionId: number) => void;
  toggleStrikeOut: (optionId: number) => void;
  toggleClues: () => void;
  setNote: (questionId: number, noteHtml: string) => void;
  setHighlighterColor: (color: string | null) => void;
  tickTimer: () => void;
  submitExam: () => void;
  resetExam: () => void;
}

export const useExamStore = create<ExamState>((set, get) => ({
  sessionId: null,
  questions: [],
  currentIndex: 0,
  answers: {},
  pendingSelections: {},
  flaggedQuestionIds: new Set<number>(),
  struckOutOptionIds: new Set<number>(),
  userNotes: {},
  activeHighlighterColor: null,
  isExamSubmitted: false,
  elapsedSeconds: 0,
  timeLimitMinutes: null,
  isTimerRunning: false,
  showClues: false,

  initExam: (sessionId, questions, timeLimitMinutes = null) => {
    set({
      sessionId,
      questions,
      currentIndex: 0,
      answers: {},
      pendingSelections: {},
      flaggedQuestionIds: new Set<number>(),
      struckOutOptionIds: new Set<number>(),
      userNotes: {},
      activeHighlighterColor: null,
      isExamSubmitted: false,
      elapsedSeconds: 0,
      timeLimitMinutes,
      isTimerRunning: true,
    });
  },

  setCurrentIndex: (index) => {
    const { questions } = get();
    if (index >= 0 && index < questions.length) {
      set({ currentIndex: index });
    }
  },

  nextQuestion: () => {
    const { currentIndex, questions } = get();
    if (currentIndex < questions.length - 1) {
      set({ currentIndex: currentIndex + 1 });
    }
  },

  prevQuestion: () => {
    const { currentIndex } = get();
    if (currentIndex > 0) {
      set({ currentIndex: currentIndex - 1 });
    }
  },

  selectOption: (questionId, option) => {
    const { answers, pendingSelections } = get();
    if (answers[questionId]) {
      return;
    }

    set({
      pendingSelections: {
        ...pendingSelections,
        [questionId]: option.id,
      },
    });
  },

  submitAnswer: (questionId) => {
    const { answers, pendingSelections, questions } = get();
    if (answers[questionId]) {
      return;
    }

    const selectedOptionId = pendingSelections[questionId];
    if (!selectedOptionId) {
      return;
    }

    const question = questions.find((item) => item.id === questionId);
    const option = question?.options?.find((item) => item.id === selectedOptionId);
    if (!option) {
      return;
    }

    set({
      answers: {
        ...answers,
        [questionId]: {
          questionId,
          selectedOptionId: option.id,
          isCorrect: option.is_correct,
          timeSpentSeconds: 1,
        },
      },
    });
  },

  toggleFlag: (questionId) => {
    const { flaggedQuestionIds } = get();
    const nextFlags = new Set(flaggedQuestionIds);
    if (nextFlags.has(questionId)) {
      nextFlags.delete(questionId);
    } else {
      nextFlags.add(questionId);
    }
    set({ flaggedQuestionIds: nextFlags });
  },

  toggleStrikeOut: (optionId) => {
    set((state) => {
      const next = new Set(state.struckOutOptionIds);
      if (next.has(optionId)) {
        next.delete(optionId);
      } else {
        next.add(optionId);
      }
      return { struckOutOptionIds: next };
    });
  },

  toggleClues: () => {
    set((state) => ({ showClues: !state.showClues }));
  },

  setNote: (questionId, noteHtml) => {
    const { userNotes } = get();
    set({
      userNotes: {
        ...userNotes,
        [questionId]: noteHtml,
      },
    });
  },

  setHighlighterColor: (color) => {
    set({ activeHighlighterColor: color });
  },

  tickTimer: () => {
    const { isTimerRunning, elapsedSeconds } = get();
    if (isTimerRunning) {
      set({ elapsedSeconds: elapsedSeconds + 1 });
    }
  },

  submitExam: () => {
    set({ isExamSubmitted: true, isTimerRunning: false });
  },

  resetExam: () => {
    set({
      sessionId: null,
      questions: [],
      currentIndex: 0,
      answers: {},
      pendingSelections: {},
      flaggedQuestionIds: new Set<number>(),
      struckOutOptionIds: new Set<number>(),
      userNotes: {},
      activeHighlighterColor: null,
      isExamSubmitted: false,
      elapsedSeconds: 0,
      timeLimitMinutes: null,
      isTimerRunning: false,
    });
  },
}));
