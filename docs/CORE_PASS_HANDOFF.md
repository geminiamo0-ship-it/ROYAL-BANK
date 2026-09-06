# Core Pass Handoff

Database/security target is now explicit. The next code changes should be driven by actual application integration, not additional planning documents or speculative SQL. Primary targets: current session-creation RPC, `src/actions/exam.ts`, `src/lib/question-bank.ts`, Question Bank client, and Previous Sessions.
