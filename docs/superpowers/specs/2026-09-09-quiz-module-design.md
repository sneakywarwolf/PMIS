# Quiz Module Design

Branch: `features/themes-quiz` (Quiz feature; Themes to follow separately)

## Goal

Add a "Quiz" module to PMIS: a daily Question of the Day with a 24-hour
answer window, automatic reveal with stats, a historical Question Log,
per-user Scorecard with leaderboard, and Admin question management
(create/schedule/edit/view responses). Gamified via points, streaks, and
milestone badges (see Gamification section).

## Data model (`apps/backend/prisma/schema.prisma`)

```prisma
enum QuizStatus { SCHEDULED ACTIVE REVEALED }

model QuizQuestion {
  id            String        @id @default(cuid())
  question      String
  options       String[]                 // exactly 4, validated at DTO level
  correctIndex  Int
  explanation   String
  scheduledFor  DateTime
  status        QuizStatus    @default(SCHEDULED)
  revealedAt    DateTime?
  createdById   String        @map("created_by_id")
  createdBy     User          @relation(fields: [createdById], references: [id])
  attempts      QuizAttempt[]
  createdAt     DateTime      @default(now())
}

model QuizAttempt {
  id             String       @id @default(cuid())
  questionId     String       @map("question_id")
  question       QuizQuestion @relation(fields: [questionId], references: [id])
  userId         String       @map("user_id")
  user           User         @relation(fields: [userId], references: [id])
  selectedOption Int
  isCorrect      Boolean
  pointsAwarded  Int          @default(0)
  answeredAt     DateTime     @default(now())

  @@unique([questionId, userId])
}

enum QuizBadge {
  FIRST_CORRECT
  STREAK_5
  STREAK_10
  STREAK_30
  ANSWERED_50
  ANSWERED_100
  PERFECT_WEEK
}

model QuizUserStats {
  userId         String      @id @map("user_id")
  user           User        @relation(fields: [userId], references: [id])
  totalPoints    Int         @default(0)
  currentStreak  Int         @default(0)
  bestStreak     Int         @default(0)
  lastAnsweredOn DateTime?               // date-only comparison, for streak continuity
  badges         QuizBadge[]
}
```

- Add inverse relations on `User`: `quizQuestions QuizQuestion[]`,
  `quizAttempts QuizAttempt[]`, `quizStats QuizUserStats?`.
- Extend `AuditAction` enum with `QUIZ_QUESTION_CREATED` /
  `QUIZ_QUESTION_UPDATED`, following the existing naming convention, and log
  admin question create/edit via the existing `AuditModule`.
- Scorecard/leaderboard **question stats** (participation, correct/incorrect
  counts) stay derived from `QuizAttempt` via grouped queries — no
  materialized table for those, still cheap at this data volume.
  `QuizUserStats` is the one exception: it's a small per-user running total
  (points/streak/badges) that must be updated transactionally at answer time
  anyway to evaluate streak continuity, so it's maintained directly rather
  than recomputed from full attempt history on every read.

## Backend (`apps/backend/src/quiz/`)

Mirrors the shape of the existing `settings` module.

- `quiz.module.ts` — imports `PrismaModule`, `AuditModule`; registers
  `ScheduleModule.forRoot()` once at the app level (new dependency:
  `@nestjs/schedule` — no cron infra exists in this repo yet).
- `quiz.service.ts` — `@Cron(CronExpression.EVERY_MINUTE)` sweep:
  - `SCHEDULED → ACTIVE` where `scheduledFor <= now`.
  - `ACTIVE → REVEALED` where `scheduledFor <= now - 24h` (sets `revealedAt`).
  - Multiple questions may be queued ahead of time; the cron activates
    whichever scheduled question's time arrives next, in order.
- `quiz.controller.ts`:
  - `GET /quiz/today` — any authenticated role. Returns the current `ACTIVE`
    question (question + options only, never `correctIndex`/`explanation`),
    or the most recent `REVEALED` question (full detail + aggregate stats)
    while it's still in its "next day" dashboard display window, or
    `204`/null if no active question exists (empty state, not an error).
  - `POST /quiz/today/answer` — submit `{ selectedOption }`. 409 if the user
    already answered this question (unique constraint / Prisma P2002 →
    mapped to 409) or the question is not `ACTIVE`.
  - `GET /quiz/log` — paginated list of `REVEALED` questions.
  - `GET /quiz/log/:id` — single historical question detail.
  - `GET /quiz/scorecard` — current user's stats (answered, correct,
    incorrect, accuracy %, participation, history).
  - `GET /quiz/scorecard/leaderboard` — all-users ranking, kept fully
    separate from PMIS project-performance stats.
  - Admin-only (`@Roles(UserRole.ADMIN)`):
    - `POST /quiz/questions` — create + schedule.
    - `PUT /quiz/questions/:id` — edit; 400 if question is not `SCHEDULED`
      (no editing an already-active/revealed question).
    - `GET /quiz/questions` — all questions, any status.
    - `GET /quiz/questions/:id/responses` — individual + aggregate stats.
- DTOs in `quiz/dto/` using `class-validator` (matches `auth/dto`
  convention): exactly 4 `options`, `correctIndex` in `[0,3]`.

## Gamification

- **Points**: a correct answer scores 10 base points; an incorrect answer
  scores 0 (still counts toward participation). Streak bonus: `+1` point per
  consecutive correct day, capped at `+10` (so a 10+ day correct streak
  doubles that question's value: 10 base + 10 bonus = 20).
- **Streaks**: `currentStreak` increments on a correct answer if
  `lastAnsweredOn` was the prior active question's day (consecutive
  participation with a correct result); resets to 0 on an incorrect answer
  or a skipped day. `bestStreak` tracks the historical max.
- **Badges** (awarded once, in `POST /quiz/today/answer` right after
  updating `QuizUserStats`, in the same transaction): `FIRST_CORRECT`,
  `STREAK_5`/`STREAK_10`/`STREAK_30`, `ANSWERED_50`/`ANSWERED_100` (lifetime
  attempts), `PERFECT_WEEK` (7/7 correct in a rolling 7-question window).
- All of `QuizAttempt.isCorrect` → point/streak/badge evaluation →
  `QuizUserStats` upsert happens inside one Prisma `$transaction` in
  `POST /quiz/today/answer`, so a crash mid-request can't award points
  without recording the attempt (or vice versa).
- Leaderboard (`GET /quiz/scorecard/leaderboard`) ranks by
  `QuizUserStats.totalPoints` descending, ties broken by accuracy % (still
  derived from `QuizAttempt`). Kept fully separate from PMIS
  project-performance stats, per original requirement.

## Frontend (`apps/frontend/src/app/dashboard/quiz/`)

- Sidebar (`apps/frontend/src/app/dashboard/layout.tsx` `navItems`): one new
  entry, `{ label: 'Quiz', href: '/dashboard/quiz', roles: ['ADMIN','AVP','TEAM_LEAD','TESTER'] }`
  — visible to all roles. Admin management is a sub-route gated in-page
  (`user.role === 'ADMIN'`) plus added to `ADMIN_ONLY_ROUTE_PREFIXES` in
  `lib/rbac.ts`, not a separate sidebar item.
- `page.tsx` — Question of the Day: active question card with option
  selection, "Answer revealed in…" countdown; after reveal (or during the
  next-day display window) shows Reveal → Explanation → Stats. Admin sees an
  extra link into `manage/`.
- `log/page.tsx` — Question Log list; selecting an entry opens historical
  detail in a modal (matches the Findings detail-modal pattern, avoids an
  extra route).
- `scorecard/page.tsx` — personal stats (points, current/best streak, badges
  earned) + leaderboard table ranked by points.
- `manage/page.tsx` (ADMIN only) — create/edit/schedule questions, view
  per-question responses and aggregate stats.
- Conventions followed throughout: single `'use client'` page files, `glass`
  / `glass-card` classNames applied inline (no new wrapper components, no
  new UI library), the shared `api` axios client
  (`contexts/auth-context.tsx`) with local `useState`/`useEffect` (no
  react-query — none is installed), Framer Motion (already a dependency) for
  the countdown, reveal sequence, and count-up stat animations.

## Error handling

- Double submission → DB unique constraint, mapped to `409 Conflict`.
- No active question → `204`/null response, frontend renders a neutral
  empty state.
- Editing a non-`SCHEDULED` question → `400 Bad Request`.
- Cron runs every minute; worst-case reveal lag is under 60 seconds.

## Testing

- Backend: unit tests for the cron's status-transition boundaries
  (`SCHEDULED→ACTIVE`, `ACTIVE→REVEALED`) and the double-submission guard;
  one controller test covering the answer-submission flow end to end.
- Frontend: no automated test suite exists elsewhere in this repo; verify
  manually (dev server + browser) once built, per existing project
  convention.

## Explicitly out of scope

- Themes feature (separate spec, to follow).
- Materialized/cached table for question-level aggregate stats (still
  derived live from `QuizAttempt`; only per-user running totals are stored,
  see Data model note above).
