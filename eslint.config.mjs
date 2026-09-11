import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/components/exam/WindowedExamPageClient.tsx"],
    rules: {
      // The first route render intentionally hydrates React state from the external
      // in-memory launch cache populated by the previous client route.
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    files: [
      "src/components/exam/ExamAnnotationLayer.tsx",
      "src/components/exam/ExamHeader.tsx",
      "src/components/exam/useQuestionAnnotations.ts",
    ],
    rules: {
      // Annotation state is synchronized with external browser state (pointer
      // capture, localStorage and persisted server records). Resetting that state
      // on tool/question changes is intentional and bounded to these components.
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    files: ["src/components/exam/useQuestionAnnotations.ts"],
    rules: {
      // The active-question ref is an imperative stale-response guard for async
      // persistence. It is not used to derive rendered output.
      "react-hooks/refs": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;