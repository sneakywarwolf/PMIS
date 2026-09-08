# Quiz Module Design

Branch: `features/themes-quiz` (Quiz feature; Themes to follow separately)

## Goal

Add a "Quiz" module to PMIS: a daily Question of the Day with a 24-hour
answer window, automatic reveal with stats, a historical Question Log,
per-user Scorecard with leaderboard, and Admin question management
(create/schedule/edit/view responses). No gamification (no XP/badges/points).

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
  answeredAt     DateTime     @default(now())

  @@unique([questionId, userId])
}
```

- Add inverse relations on `User`: `quizQuestions QuizQuestion[]`,
  `quizAttempts QuizAttempt[]`.
- Extend `AuditAction` enum with `QUIZ_QUESTION_CREATED` /
  `QUIZ_QUESTION_UPDATED`, following the existing naming convention, and log
  admin question create/edit via the existing `AuditModule`.
- Scorecard/leaderboard data is **derived** from `QuizAttempt` via grouped
  queries — no materialized stats table. Keeps reads always-correct with no
  sync step, acceptable at this data volume.

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
- `scorecard/page.tsx` — personal stats + leaderboard table.
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
- XP, badges, points, or any other gamification mechanic.
- Materialized/cached stats table (revisit only if live aggregation proves
  too slow at scale).
