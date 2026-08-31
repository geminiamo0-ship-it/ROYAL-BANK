const fs = require('fs');
let code = fs.readFileSync('src/components/bank/QuestionBankPageClient.tsx', 'utf8');

// 1. Import Hammer from lucide-react
code = code.replace(/import \{ ChevronRight, Minus, Plus, Search \} from 'lucide-react';/, "import { ChevronRight, Minus, Plus, Search, Hammer } from 'lucide-react';");

// 2. Modify getCountForSelection to use difficulty Breakdown
const oldGetCount = \unction getCountForSelection(
  item: Pick<CategoryWithTopics, 'total' | 'newCount' | 'incorrectCount' | 'flaggedCount' | 'suspendedCount'>,
  selection: QuestionSelection
) {
  switch (selection) {
    case 'new_only':
      return item.newCount;
    case 'incorrect_only':
      return item.incorrectCount;
    case 'flagged_only':
      return item.flaggedCount;
    case 'suspended_only':
      return item.suspendedCount;
    case 'all':
    default:
      return item.total;
  }
}\;

const newGetCount = \unction getCountForSelection(
  item: Pick<CategoryWithTopics, 'totalByDiff' | 'attemptedByDiff' | 'incorrectByDiff' | 'flaggedByDiff' | 'suspendedByDiff'>,
  selection: QuestionSelection,
  difficulties: string[]
) {
  const sum = (counts: Record<string, number>) => difficulties.reduce((acc, d) => acc + (counts[d] || 0), 0);
  
  switch (selection) {
    case 'new_only':
      return Math.max(sum(item.totalByDiff) - sum(item.attemptedByDiff), 0);
    case 'incorrect_only':
      return sum(item.incorrectByDiff);
    case 'flagged_only':
      return sum(item.flaggedByDiff);
    case 'suspended_only':
      return sum(item.suspendedByDiff);
    case 'all':
    default:
      return sum(item.totalByDiff);
  }
}\;
code = code.replace(oldGetCount, newGetCount);

// 3. Update calls to getCountForSelection
code = code.replace(/getCountForSelection\\(category, questionSelection\\)/g, 'getCountForSelection(category, questionSelection, selectedDifficulties)');
code = code.replace(/getCountForSelection\\(topic, questionSelection\\)/g, 'getCountForSelection(topic, questionSelection, selectedDifficulties)');
code = code.replace(/const totalAvailable = categories\\.reduce\\(\\(acc, cat\\) => acc \\+ getCountForSelection\\(cat, questionSelection\\), 0\\);/, 'const totalAvailable = categories.reduce((acc, cat) => acc + getCountForSelection(cat, questionSelection, selectedDifficulties), 0);');

// 4. Update Hammers UI
const oldDifficultyUI = \{[
                { value: '1', label: '1' },
                { value: '2', label: '2' },
                { value: '3', label: '3' },
              ].map((difficulty) => (\;
const newDifficultyUI = \{[
                { value: '1', label: '1' },
                { value: '2', label: '2' },
                { value: '3', label: '3' },
              ].map((difficulty) => (\;
// Wait, I will use replace on the whole map block
const oldMapBlock = \{[
                { value: '1', label: '1' },
                { value: '2', label: '2' },
                { value: '3', label: '3' },
              ].map((difficulty) => (
                <label key={difficulty.value} className="inline-flex items-center gap-2 text-[13px] text-white">
                  <input
                    type="checkbox"
                    checked={selectedDifficulties.includes(difficulty.value)}
                    onChange={() => toggleDifficulty(difficulty.value)}
                    className="h-[12px] w-[12px] rounded-[2px] accent-[#3e73ff]"
                  />
                  <span>{difficulty.label}</span>
                </label>
              ))}\;

const newMapBlock = \{[
                { value: '1', hammers: 1 },
                { value: '2', hammers: 2 },
                { value: '3', hammers: 3 },
              ].map((difficulty) => (
                <label key={difficulty.value} className="inline-flex items-center gap-2 text-[13px] text-white cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedDifficulties.includes(difficulty.value)}
                    onChange={() => toggleDifficulty(difficulty.value)}
                    className="h-[14px] w-[14px] rounded-[2px] accent-[#3e73ff]"
                  />
                  <span className="flex items-center gap-1">
                    {Array.from({ length: difficulty.hammers }).map((_, i) => (
                      <Hammer key={i} size={14} className={selectedDifficulties.includes(difficulty.value) ? 'text-[#ff9500]' : 'text-gray-500'} />
                    ))}
                  </span>
                </label>
              ))}\;
code = code.replace(oldMapBlock, newMapBlock);

fs.writeFileSync('src/components/bank/QuestionBankPageClient.tsx', code);
