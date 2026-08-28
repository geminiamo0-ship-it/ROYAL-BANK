# Royal Bank — Project Handover & Codex Migration Guide

This document contains everything needed to migrate, set up, and continue developing **Royal Bank** in **Codex**, **VS Code**, or any other development environment.

---

## 1. Project Location & File Structure

The entire production codebase is located at:
```
C:\Users\Administrator\.gemini\antigravity\scratch\royal-bank
```

### Key Folders & Files:
- **`src/app/`**: Next.js 15 App Router pages:
  - `(auth)/login` & `(auth)/register`: Authentication screens.
  - `(student)/dashboard`: Medical Examination Pathways catalog (MRCP, MRCOG, MRCS, PLAB).
  - `(student)/pathway/[slug]`: Isolated Question Banks Catalog (PassMedicine, Pastest, 1Exam).
  - `(student)/bank/[bankId]`: Question bank home (Category picker, difficulty levels, AI sequence optimization).
  - `(student)/bank/[bankId]/textbook/high-yield`: Clinical textbook reader (650+ chapters).
  - `(student)/bank/[bankId]/saved-concepts`: Saved medical concepts review page.
  - `(student)/exam/[sessionId]`: Interactive exam interface with clinical vignettes, peer statistics bars, clues toggle, strike-out tool, notes editor, and sidebar widgets.
  - `(admin)/support`: Support Desk for instant Telegram subscription lookup and 1-click activation.
  - `(admin)/admin`: Full administrative console (users, devices, security, IP blocklist).
- **`src/actions/`**: Next.js Server Actions:
  - `auth.ts`: Supabase authentication handling.
  - `exam.ts`: Question fetching, options loading, answering, scoring, and voting.
  - `pathways.ts`: Isolated pathways and bank metadata provider.
- **`src/components/`**: Modular UI components matching PassMedicine design.
- **`src/stores/`**: Zustand client state (`examStore.ts`, `uiStore.ts`).
- **`supabase/`**:
  - `full_setup.sql`: Complete consolidated schema, tables, triggers, indexes, and RLS policies.
- **`scripts/`**:
  - `resilient_ingest.py`: Direct cloud batch ingestion script for uploading questions and options to Supabase.
- **`C:\Users\Administrator\.gemini\antigravity\scratch\processed_data/`**:
  - 5,444 clean JSON questions (`questions_chunk_01.json` to `11.json`) and 650 library articles.

---

## 2. Environment Variables (`.env.local`)

File location: `C:\Users\Administrator\.gemini\antigravity\scratch\royal-bank\.env.local`

```env
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=https://trnvsgenmzhyuayxxdoq.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_p3T4sz4VpnWVuhjFgT1kwQ_b3mWaoO9
SUPABASE_SERVICE_ROLE_KEY=sb_secret_LfKxUzMNK1tuajaRE0KW3g_hXKjuQdF

# Cloudflare R2 Media Storage CDN
NEXT_PUBLIC_R2_MEDIA_URL=https://media.royalbank.com/questions

# Support & Telegram Link
NEXT_PUBLIC_TELEGRAM_SUPPORT_URL=https://t.me/RoyalBankSupport
```

---

## 3. Database Architecture (Supabase PostgreSQL)

The database schema is fully deployed on Supabase project `trnvsgenmzhyuayxxdoq`.

### 13 Core Tables:
1. `profiles`: User accounts, roles (`student`, `admin`, `support`), subscription tiers.
2. `pathways`: Medical exam qualifications (MRCP Part 1, MRCOG Part 1, MRCS Part A, PLAB 1).
3. `question_banks`: Individual banks under each pathway (PassMedicine, Pastest, 1Exam).
4. `blocks`: Block quota system (Free trial = 1 block, max 70 questions/block).
5. `questions`: Clinical vignettes, `text_html`, `explanation_html`, `category`, `topic`, `concept`, `notes_id`.
6. `options`: Multi-choice answers, `is_correct`, `option_order`, `percentage` (peer stats).
7. `library_articles`: Textbook chapters linked via `notes_id`.
8. `user_pathway_access`: User subscriptions and granted block access.
9. `test_sessions`: Active and completed student exam sessions.
10. `user_answers`: User attempts, flags, timestamps, and correctness.
11. `user_notes`: Student rich-text personal notes per question.
12. `saved_concepts`: Concepts marked Important / Less Important.
13. `login_history` & `ip_blocklist`: Anti-account sharing, IP logging, and firewall rules.

---

## 4. How to Migrate & Open in Codex / VS Code

### Step 1: Open the Project Directory
Open your terminal or Codex workspace pointing to:
```bash
cd "C:\Users\Administrator\.gemini\antigravity\scratch\royal-bank"
```

*(Optional: You can move this entire folder to your Desktop or a custom workspace folder like `C:\Projects\royal-bank`)*.

### Step 2: Initialize Git (Recommended)
If you want to track changes and push to GitHub:
```bash
git init
git add .
git commit -m "feat: Royal Bank full-stack platform matching PassMedicine"
```

### Step 3: Run Development Server
```bash
npm run dev
```
The server will start at `http://localhost:3000`.

### Step 4: Verify Production Build
```bash
npm run build
```

---

## 5. Next Planned Roadmap Items (For Codex Prompting)

You can give Codex this prompt to continue immediately:

```markdown
I am continuing development on Royal Bank, a Next.js 15 medical question bank platform matching PassMedicine.
The codebase is in the current directory with Supabase connected in `.env.local`.

Next priority tasks to implement:
1. Build the Performance & Analytics Heatmap page at `/bank/[bankId]/performance`.
2. Implement Mock Exams & Timed Sets at `/bank/[bankId]/mock-exams`.
3. Complete the Spaced Repetition Review queue at `/bank/[bankId]/review`.
4. Upload offline media images (`E:\extractors\offline_media`) to Cloudflare R2 bucket.
```
