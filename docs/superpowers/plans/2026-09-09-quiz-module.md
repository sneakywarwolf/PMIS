# Quiz Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a gamified Quiz module to PMIS — daily question with 24h answer window and auto-reveal, question log, points/streaks/badges scorecard with leaderboard, and admin question management.

**Architecture:** Two new Prisma models (`QuizQuestion`, `QuizAttempt`) plus a small per-user running-totals table (`QuizUserStats`); a NestJS `quiz` module with a minute-level cron sweeping question status (`SCHEDULED → ACTIVE → REVEALED`); a REST controller serving both public (any role) and admin-only (`@Roles(ADMIN)`) endpoints; four new Next.js pages under `/dashboard/quiz` following existing glass-UI/axios/useState conventions (no react-query, no new UI library).

**Tech Stack:** NestJS, Prisma/PostgreSQL, `@nestjs/schedule` (new dependency), Next.js App Router, Tailwind + Framer Motion, Jest.

**Spec:** `docs/superpowers/specs/2026-09-09-quiz-module-design.md`

## Global Constraints

- Exactly 4 options per question, `correctIndex` in `[0,3]` — validated via `class-validator` DTOs.
- A user may answer a question exactly once — enforced by DB unique constraint `@@unique([questionId, userId])` on `QuizAttempt`, not just app logic.
- Correct answer / explanation must never be present in any `GET /quiz/today` response while the question is `ACTIVE` — only after `REVEALED`.
- Admin can only edit a question while it is `SCHEDULED` (400 otherwise).
- Points: 10 base for correct, 0 for incorrect; streak bonus `+1`/consecutive correct day capped at `+10`; badges awarded once each (`FIRST_CORRECT`, `STREAK_5`, `STREAK_10`, `STREAK_30`, `ANSWERED_50`, `ANSWERED_100`, `PERFECT_WEEK`).
- Attempt recording + points/streak/badge update happen in one Prisma `$transaction`.
- No react-query is installed — frontend uses local `useState`/`useEffect` with the shared `api` axios client (`apps/frontend/src/contexts/auth-context.tsx`).
- UI styling uses existing global `.glass`/`.glass-card` CSS classes inline — no new component library, no new wrapper components.
- Follow existing module shape: `apps/backend/src/settings/` is the reference template for the backend; `apps/frontend/src/app/dashboard/settings/page.tsx` and `.../users/page.tsx` are the reference templates for frontend admin pages.

---

## File Structure

**Backend — new:**
- `apps/backend/prisma/schema.prisma` (modify — add models/enums)
- `apps/backend/src/quiz/quiz.module.ts`
- `apps/backend/src/quiz/quiz.service.ts`
- `apps/backend/src/quiz/quiz.service.spec.ts`
- `apps/backend/src/quiz/quiz.controller.ts`
- `apps/backend/src/quiz/quiz.controller.spec.ts`
- `apps/backend/src/quiz/dto/create-quiz-question.dto.ts`
- `apps/backend/src/quiz/dto/update-quiz-question.dto.ts`
- `apps/backend/src/quiz/dto/answer-quiz-question.dto.ts`
- `apps/backend/src/app.module.ts` (modify — register `QuizModule`, `ScheduleModule.forRoot()`)

**Frontend — new:**
- `apps/frontend/src/app/dashboard/layout.tsx` (modify — add sidebar nav item)
- `apps/frontend/src/lib/rbac.ts` (modify — add `/dashboard/quiz/manage` to admin-only prefixes)
- `apps/frontend/src/app/dashboard/quiz/page.tsx`
- `apps/frontend/src/app/dashboard/quiz/log/page.tsx`
- `apps/frontend/src/app/dashboard/quiz/scorecard/page.tsx`
- `apps/frontend/src/app/dashboard/quiz/manage/page.tsx`

---

## Task 1: Prisma schema — Quiz models

**Files:**
- Modify: `apps/backend/prisma/schema.prisma`

**Interfaces:**
- Produces: `QuizStatus` enum (`SCHEDULED`, `ACTIVE`, `REVEALED`), `QuizBadge` enum, `QuizQuestion` model, `QuizAttempt` model, `QuizUserStats` model — used by every later backend task.

- [ ] **Step 1: Add enums and models to schema.prisma**

Find the existing `enum UserRole { ... }` block (near line 10) and the `model User { ... }` block (near line 104) in `apps/backend/prisma/schema.prisma`. Append after the last existing enum/model block, before the final closing of the file:

```prisma
enum QuizStatus {
  SCHEDULED
  ACTIVE
  REVEALED
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

model QuizQuestion {
  id           String        @id @default(cuid())
  question     String
  options      String[]
  correctIndex Int
  explanation  String
  scheduledFor DateTime
  status       QuizStatus    @default(SCHEDULED)
  revealedAt   DateTime?
  createdById  String        @map("created_by_id")
  createdBy    User          @relation(fields: [createdById], references: [id])
  attempts     QuizAttempt[]
  createdAt    DateTime      @default(now())

  @@map("quiz_questions")
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
  @@map("quiz_attempts")
}

model QuizUserStats {
  userId         String      @id @map("user_id")
  user           User        @relation(fields: [userId], references: [id])
  totalPoints    Int         @default(0)
  currentStreak  Int         @default(0)
  bestStreak     Int         @default(0)
  lastAnsweredOn DateTime?
  badges         QuizBadge[]

  @@map("quiz_user_stats")
}
```

Then add inverse relation fields on `model User { ... }` (inside the existing model body, alongside the other relation array fields like `findings`):

```prisma
  quizQuestions QuizQuestion[]
  quizAttempts  QuizAttempt[]
  quizStats     QuizUserStats?
```

Find the existing `enum AuditAction { ... }` block and add two entries following the existing naming pattern:

```prisma
  QUIZ_QUESTION_CREATED
  QUIZ_QUESTION_UPDATED
```

- [ ] **Step 2: Generate migration**

Run: `cd apps/backend && npx prisma migrate dev --name add_quiz_module`
Expected: migration file created under `apps/backend/prisma/migrations/`, applies cleanly against the local dev database, Prisma Client regenerated with no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/prisma/schema.prisma apps/backend/prisma/migrations
git commit -m "feat(quiz): add Prisma models for quiz questions, attempts, and user stats"
```

---

## Task 2: Quiz DTOs

**Files:**
- Create: `apps/backend/src/quiz/dto/create-quiz-question.dto.ts`
- Create: `apps/backend/src/quiz/dto/update-quiz-question.dto.ts`
- Create: `apps/backend/src/quiz/dto/answer-quiz-question.dto.ts`
- Test: `apps/backend/src/quiz/dto/create-quiz-question.dto.spec.ts`

**Interfaces:**
- Consumes: none (pure DTOs).
- Produces: `CreateQuizQuestionDto { question: string; options: string[]; correctIndex: number; explanation: string; scheduledFor: string }`, `UpdateQuizQuestionDto` (all fields of `CreateQuizQuestionDto`, optional), `AnswerQuizQuestionDto { selectedOption: number }` — consumed by `QuizController` (Task 4).

- [ ] **Step 1: Write the failing validation test**

```typescript
// apps/backend/src/quiz/dto/create-quiz-question.dto.spec.ts
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateQuizQuestionDto } from './create-quiz-question.dto';

function validQuestion() {
  return {
    question: 'What does XSS stand for?',
    options: ['Cross-Site Scripting', 'X-Server Script', 'Extended Style Sheet', 'XML Site Sync'],
    correctIndex: 0,
    explanation: 'XSS is Cross-Site Scripting, a client-side injection vulnerability.',
    scheduledFor: '2026-09-10T09:00:00.000Z',
  };
}

describe('CreateQuizQuestionDto', () => {
  it('accepts a valid question', async () => {
    const dto = plainToInstance(CreateQuizQuestionDto, validQuestion());
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects fewer than 4 options', async () => {
    const dto = plainToInstance(CreateQuizQuestionDto, { ...validQuestion(), options: ['a', 'b', 'c'] });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'options')).toBe(true);
  });

  it('rejects more than 4 options', async () => {
    const dto = plainToInstance(CreateQuizQuestionDto, { ...validQuestion(), options: ['a', 'b', 'c', 'd', 'e'] });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'options')).toBe(true);
  });

  it('rejects correctIndex outside 0-3', async () => {
    const dto = plainToInstance(CreateQuizQuestionDto, { ...validQuestion(), correctIndex: 4 });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'correctIndex')).toBe(true);
  });

  it('rejects a missing question text', async () => {
    const dto = plainToInstance(CreateQuizQuestionDto, { ...validQuestion(), question: '' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'question')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/backend && npx jest src/quiz/dto/create-quiz-question.dto.spec.ts`
Expected: FAIL — `Cannot find module './create-quiz-question.dto'`

- [ ] **Step 3: Implement the DTOs**

```typescript
// apps/backend/src/quiz/dto/create-quiz-question.dto.ts
import { ArrayMaxSize, ArrayMinSize, IsDateString, IsInt, IsString, Max, Min, MinLength } from 'class-validator';

export class CreateQuizQuestionDto {
  @IsString()
  @MinLength(1)
  question!: string;

  @ArrayMinSize(4)
  @ArrayMaxSize(4)
  @IsString({ each: true })
  options!: string[];

  @IsInt()
  @Min(0)
  @Max(3)
  correctIndex!: number;

  @IsString()
  @MinLength(1)
  explanation!: string;

  @IsDateString()
  scheduledFor!: string;
}
```

```typescript
// apps/backend/src/quiz/dto/update-quiz-question.dto.ts
import { PartialType } from '@nestjs/mapped-types';
import { CreateQuizQuestionDto } from './create-quiz-question.dto';

export class UpdateQuizQuestionDto extends PartialType(CreateQuizQuestionDto) {}
```

If `@nestjs/mapped-types` is not already a dependency, run `cd apps/backend && npm install @nestjs/mapped-types` before this step (check `apps/backend/package.json` first — `@nestjs/swagger` re-exports `PartialType` too; if `@nestjs/mapped-types` is absent, import `PartialType` from `@nestjs/swagger` instead to avoid adding a dependency).

```typescript
// apps/backend/src/quiz/dto/answer-quiz-question.dto.ts
import { IsInt, Max, Min } from 'class-validator';

export class AnswerQuizQuestionDto {
  @IsInt()
  @Min(0)
  @Max(3)
  selectedOption!: number;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/backend && npx jest src/quiz/dto/create-quiz-question.dto.spec.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/quiz/dto
git commit -m "feat(quiz): add quiz question DTOs with validation"
```

---

## Task 3: QuizService — status transitions, answer submission, gamification

**Files:**
- Create: `apps/backend/src/quiz/quiz.service.ts`
- Test: `apps/backend/src/quiz/quiz.service.spec.ts`

**Interfaces:**
- Consumes: `PrismaService` (`apps/backend/src/prisma/prisma.service.ts`), `AuditService` (`apps/backend/src/audit/audit.service.ts` — check exact export name before use), DTOs from Task 2.
- Produces (used by `QuizController` in Task 4):
  - `sweepQuizStatuses(): Promise<void>` — the cron entrypoint.
  - `getTodayQuestion(userId: string): Promise<QuizTodayResponse | null>`
  - `submitAnswer(userId: string, questionId: string, selectedOption: number): Promise<QuizAttempt>`
  - `getLog(page: number, pageSize: number): Promise<{ items: QuizQuestion[]; total: number }>`
  - `getLogEntry(id: string): Promise<QuizQuestion & { attempts: QuizAttempt[] }>`
  - `getScorecard(userId: string): Promise<ScorecardResponse>`
  - `getLeaderboard(): Promise<LeaderboardEntry[]>`
  - `createQuestion(createdById: string, dto: CreateQuizQuestionDto): Promise<QuizQuestion>`
  - `updateQuestion(id: string, dto: UpdateQuizQuestionDto): Promise<QuizQuestion>`
  - `listQuestions(): Promise<QuizQuestion[]>`
  - `getQuestionResponses(id: string): Promise<{ question: QuizQuestion; attempts: (QuizAttempt & { user: { id: string; name: string } })[] }>`

- [ ] **Step 1: Write failing tests for status sweep**

```typescript
// apps/backend/src/quiz/quiz.service.spec.ts
import { Test } from '@nestjs/testing';
import { QuizService } from './quiz.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

function makePrismaMock() {
  return {
    quizQuestion: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
      count: jest.fn(),
    },
    quizAttempt: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      groupBy: jest.fn(),
      count: jest.fn(),
    },
    quizUserStats: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      findMany: jest.fn(),
    },
    $transaction: jest.fn((cb: any) => cb(prisma)),
  } as any;
}

let prisma: ReturnType<typeof makePrismaMock>;

describe('QuizService.sweepQuizStatuses', () => {
  let service: QuizService;
  let audit: { log: jest.Mock };

  beforeEach(async () => {
    prisma = makePrismaMock();
    audit = { log: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        QuizService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();
    service = moduleRef.get(QuizService);
  });

  it('activates SCHEDULED questions whose scheduledFor has arrived', async () => {
    await service.sweepQuizStatuses();

    expect(prisma.quizQuestion.updateMany).toHaveBeenCalledWith({
      where: { status: 'SCHEDULED', scheduledFor: { lte: expect.any(Date) } },
      data: { status: 'ACTIVE' },
    });
  });

  it('reveals ACTIVE questions older than 24 hours', async () => {
    await service.sweepQuizStatuses();

    expect(prisma.quizQuestion.updateMany).toHaveBeenCalledWith({
      where: { status: 'ACTIVE', scheduledFor: { lte: expect.any(Date) } },
      data: { status: 'REVEALED', revealedAt: expect.any(Date) },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/backend && npx jest src/quiz/quiz.service.spec.ts`
Expected: FAIL — `Cannot find module './quiz.service'`

- [ ] **Step 3: Implement sweepQuizStatuses**

```typescript
// apps/backend/src/quiz/quiz.service.ts (initial slice — extended in later steps)
import { Injectable, ConflictException, BadRequestException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateQuizQuestionDto } from './dto/create-quiz-question.dto';
import { UpdateQuizQuestionDto } from './dto/update-quiz-question.dto';

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const BASE_POINTS = 10;
const MAX_STREAK_BONUS = 10;

@Injectable()
export class QuizService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async sweepQuizStatuses(): Promise<void> {
    const now = new Date();

    await this.prisma.quizQuestion.updateMany({
      where: { status: 'SCHEDULED', scheduledFor: { lte: now } },
      data: { status: 'ACTIVE' },
    });

    await this.prisma.quizQuestion.updateMany({
      where: { status: 'ACTIVE', scheduledFor: { lte: new Date(now.getTime() - TWENTY_FOUR_HOURS_MS) } },
      data: { status: 'REVEALED', revealedAt: now },
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/backend && npx jest src/quiz/quiz.service.spec.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/quiz/quiz.service.ts apps/backend/src/quiz/quiz.service.spec.ts
git commit -m "feat(quiz): add QuizService status-sweep cron"
```

- [ ] **Step 6: Write failing tests for submitAnswer (double-submit + gamification)**

Append to `apps/backend/src/quiz/quiz.service.spec.ts`:

```typescript
describe('QuizService.submitAnswer', () => {
  let service: QuizService;
  let audit: { log: jest.Mock };

  beforeEach(async () => {
    prisma = makePrismaMock();
    audit = { log: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        QuizService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();
    service = moduleRef.get(QuizService);
  });

  it('rejects an answer if the question is not ACTIVE', async () => {
    prisma.quizQuestion.findUnique.mockResolvedValue({ id: 'q1', status: 'REVEALED', correctIndex: 0 });

    await expect(service.submitAnswer('u1', 'q1', 0)).rejects.toThrow(BadRequestException);
  });

  it('rejects a second submission for the same question by the same user', async () => {
    prisma.quizQuestion.findUnique.mockResolvedValue({ id: 'q1', status: 'ACTIVE', correctIndex: 0 });
    prisma.quizAttempt.findUnique.mockResolvedValue({ id: 'existing-attempt' });

    await expect(service.submitAnswer('u1', 'q1', 0)).rejects.toThrow(ConflictException);
  });

  it('awards base points and increments streak on a correct answer', async () => {
    prisma.quizQuestion.findUnique.mockResolvedValue({ id: 'q1', status: 'ACTIVE', correctIndex: 2 });
    prisma.quizAttempt.findUnique.mockResolvedValue(null);
    prisma.quizUserStats.findUnique.mockResolvedValue({
      userId: 'u1',
      totalPoints: 0,
      currentStreak: 0,
      bestStreak: 0,
      lastAnsweredOn: null,
      badges: [],
    });
    prisma.quizAttempt.create.mockResolvedValue({ id: 'a1', isCorrect: true, pointsAwarded: 10 });
    prisma.quizAttempt.count.mockResolvedValue(1);
    prisma.quizAttempt.findMany.mockResolvedValue([{ isCorrect: true }]);

    const result = await service.submitAnswer('u1', 'q1', 2);

    expect(result.isCorrect).toBe(true);
    expect(prisma.quizUserStats.upsert).toHaveBeenCalled();
    const upsertArg = prisma.quizUserStats.upsert.mock.calls[0][0];
    expect(upsertArg.create.totalPoints).toBe(10);
    expect(upsertArg.create.currentStreak).toBe(1);
    expect(upsertArg.create.badges).toContain('FIRST_CORRECT');
  });

  it('awards zero points on an incorrect answer and resets streak', async () => {
    prisma.quizQuestion.findUnique.mockResolvedValue({ id: 'q1', status: 'ACTIVE', correctIndex: 2 });
    prisma.quizAttempt.findUnique.mockResolvedValue(null);
    prisma.quizUserStats.findUnique.mockResolvedValue({
      userId: 'u1',
      totalPoints: 20,
      currentStreak: 3,
      bestStreak: 3,
      lastAnsweredOn: new Date(),
      badges: [],
    });
    prisma.quizAttempt.create.mockResolvedValue({ id: 'a1', isCorrect: false, pointsAwarded: 0 });
    prisma.quizAttempt.count.mockResolvedValue(4);
    prisma.quizAttempt.findMany.mockResolvedValue([]);

    await service.submitAnswer('u1', 'q1', 0);

    const upsertArg = prisma.quizUserStats.upsert.mock.calls[0][0];
    expect(upsertArg.update.currentStreak).toBe(0);
    expect(upsertArg.update.totalPoints).toBe(20);
  });
});
```

- [ ] **Step 7: Run tests to verify they fail**

Run: `cd apps/backend && npx jest src/quiz/quiz.service.spec.ts`
Expected: FAIL — `service.submitAnswer is not a function`

- [ ] **Step 8: Implement submitAnswer with gamification**

Add to `apps/backend/src/quiz/quiz.service.ts` (inside the `QuizService` class, after `sweepQuizStatuses`):

```typescript
  async submitAnswer(userId: string, questionId: string, selectedOption: number) {
    const question = await this.prisma.quizQuestion.findUnique({ where: { id: questionId } });
    if (!question || question.status !== 'ACTIVE') {
      throw new BadRequestException('This question is not currently active.');
    }

    const existing = await this.prisma.quizAttempt.findUnique({
      where: { questionId_userId: { questionId, userId } },
    });
    if (existing) {
      throw new ConflictException('You have already answered this question.');
    }

    const isCorrect = selectedOption === question.correctIndex;

    return this.prisma.$transaction(async (tx) => {
      const stats = (await tx.quizUserStats.findUnique({ where: { userId } })) ?? {
        userId,
        totalPoints: 0,
        currentStreak: 0,
        bestStreak: 0,
        lastAnsweredOn: null as Date | null,
        badges: [] as string[],
      };

      const nextStreak = isCorrect ? stats.currentStreak + 1 : 0;
      const streakBonus = isCorrect ? Math.min(nextStreak - 1, MAX_STREAK_BONUS) : 0;
      const pointsAwarded = isCorrect ? BASE_POINTS + streakBonus : 0;
      const nextBestStreak = Math.max(stats.bestStreak, nextStreak);

      const attempt = await tx.quizAttempt.create({
        data: { questionId, userId, selectedOption, isCorrect, pointsAwarded },
      });

      const totalAnswered = await tx.quizAttempt.count({ where: { userId } });
      const badges = new Set(stats.badges);
      if (isCorrect && totalAnswered === 1) badges.add('FIRST_CORRECT');
      if (nextStreak === 5) badges.add('STREAK_5');
      if (nextStreak === 10) badges.add('STREAK_10');
      if (nextStreak === 30) badges.add('STREAK_30');
      if (totalAnswered === 50) badges.add('ANSWERED_50');
      if (totalAnswered === 100) badges.add('ANSWERED_100');

      const recentAttempts = await tx.quizAttempt.findMany({
        where: { userId },
        orderBy: { answeredAt: 'desc' },
        take: 7,
      });
      if (recentAttempts.length === 7 && recentAttempts.every((a) => a.isCorrect)) {
        badges.add('PERFECT_WEEK');
      }

      await tx.quizUserStats.upsert({
        where: { userId },
        create: {
          userId,
          totalPoints: pointsAwarded,
          currentStreak: nextStreak,
          bestStreak: nextBestStreak,
          lastAnsweredOn: new Date(),
          badges: Array.from(badges) as any,
        },
        update: {
          totalPoints: stats.totalPoints + pointsAwarded,
          currentStreak: nextStreak,
          bestStreak: nextBestStreak,
          lastAnsweredOn: new Date(),
          badges: Array.from(badges) as any,
        },
      });

      return attempt;
    });
  }
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `cd apps/backend && npx jest src/quiz/quiz.service.spec.ts`
Expected: PASS (all tests)

- [ ] **Step 10: Commit**

```bash
git add apps/backend/src/quiz/quiz.service.ts apps/backend/src/quiz/quiz.service.spec.ts
git commit -m "feat(quiz): implement answer submission with points, streaks, badges"
```

- [ ] **Step 11: Implement remaining read/admin methods (no new gamification logic, straightforward Prisma queries)**

Add to `apps/backend/src/quiz/quiz.service.ts`:

```typescript
  async getTodayQuestion(userId: string) {
    const active = await this.prisma.quizQuestion.findFirst({ where: { status: 'ACTIVE' } });
    if (active) {
      const alreadyAnswered = await this.prisma.quizAttempt.findUnique({
        where: { questionId_userId: { questionId: active.id, userId } },
      });
      return {
        id: active.id,
        question: active.question,
        options: active.options,
        scheduledFor: active.scheduledFor,
        status: active.status,
        alreadyAnswered: Boolean(alreadyAnswered),
      };
    }

    const recentlyRevealed = await this.prisma.quizQuestion.findFirst({
      where: { status: 'REVEALED', revealedAt: { gte: new Date(Date.now() - TWENTY_FOUR_HOURS_MS) } },
      orderBy: { revealedAt: 'desc' },
    });
    if (!recentlyRevealed) return null;

    return this.buildRevealedSummary(recentlyRevealed);
  }

  private async buildRevealedSummary(question: { id: string; question: string; options: string[]; correctIndex: number; explanation: string; revealedAt: Date | null }) {
    const attempts = await this.prisma.quizAttempt.findMany({ where: { questionId: question.id } });
    const correctCount = attempts.filter((a) => a.isCorrect).length;
    return {
      id: question.id,
      question: question.question,
      options: question.options,
      correctIndex: question.correctIndex,
      explanation: question.explanation,
      revealedAt: question.revealedAt,
      participants: attempts.length,
      correctCount,
      incorrectCount: attempts.length - correctCount,
    };
  }

  async getLog(page: number, pageSize: number) {
    const [items, total] = await Promise.all([
      this.prisma.quizQuestion.findMany({
        where: { status: 'REVEALED' },
        orderBy: { revealedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.quizQuestion.count({ where: { status: 'REVEALED' } }),
    ]);
    return { items, total };
  }

  async getLogEntry(id: string) {
    const question = await this.prisma.quizQuestion.findUnique({ where: { id } });
    if (!question || question.status !== 'REVEALED') {
      throw new BadRequestException('This question is not in the log.');
    }
    return this.buildRevealedSummary(question);
  }

  async getScorecard(userId: string) {
    const stats = await this.prisma.quizUserStats.findUnique({ where: { userId } });
    const attempts = await this.prisma.quizAttempt.findMany({ where: { userId } });
    const correct = attempts.filter((a) => a.isCorrect).length;
    return {
      totalAnswered: attempts.length,
      correct,
      incorrect: attempts.length - correct,
      accuracy: attempts.length ? Math.round((correct / attempts.length) * 100) : 0,
      totalPoints: stats?.totalPoints ?? 0,
      currentStreak: stats?.currentStreak ?? 0,
      bestStreak: stats?.bestStreak ?? 0,
      badges: stats?.badges ?? [],
    };
  }

  async getLeaderboard() {
    const allStats = await this.prisma.quizUserStats.findMany({
      include: { user: { select: { id: true, name: true } } },
      orderBy: { totalPoints: 'desc' },
    });
    return allStats.map((s: any) => ({
      userId: s.userId,
      name: s.user.name,
      totalPoints: s.totalPoints,
      currentStreak: s.currentStreak,
      bestStreak: s.bestStreak,
      badges: s.badges,
    }));
  }

  async createQuestion(createdById: string, dto: CreateQuizQuestionDto) {
    const created = await this.prisma.quizQuestion.create({
      data: { ...dto, scheduledFor: new Date(dto.scheduledFor), createdById },
    });
    await this.audit.log({ action: 'QUIZ_QUESTION_CREATED', actorId: createdById, targetId: created.id });
    return created;
  }

  async updateQuestion(id: string, dto: UpdateQuizQuestionDto) {
    const question = await this.prisma.quizQuestion.findUnique({ where: { id } });
    if (!question || question.status !== 'SCHEDULED') {
      throw new BadRequestException('Only a scheduled question can be edited.');
    }
    const data: any = { ...dto };
    if (dto.scheduledFor) data.scheduledFor = new Date(dto.scheduledFor);
    return this.prisma.quizQuestion.update({ where: { id }, data });
  }

  async listQuestions() {
    return this.prisma.quizQuestion.findMany({ orderBy: { scheduledFor: 'desc' } });
  }

  async getQuestionResponses(id: string) {
    const question = await this.prisma.quizQuestion.findUnique({ where: { id } });
    if (!question) throw new BadRequestException('Question not found.');
    const attempts = await this.prisma.quizAttempt.findMany({
      where: { questionId: id },
      include: { user: { select: { id: true, name: true } } },
    });
    return { question, attempts };
  }
```

Check `apps/backend/src/audit/audit.service.ts` for the exact `AuditService.log(...)` method signature before writing the `createQuestion` call above — adjust the argument shape to match if it differs from `{ action, actorId, targetId }`.

- [ ] **Step 12: Run full quiz service test suite**

Run: `cd apps/backend && npx jest src/quiz/quiz.service.spec.ts`
Expected: PASS (no regressions from Step 9)

- [ ] **Step 13: Commit**

```bash
git add apps/backend/src/quiz/quiz.service.ts
git commit -m "feat(quiz): add read queries and admin question management to QuizService"
```

---

## Task 4: QuizController + QuizModule wiring

**Files:**
- Create: `apps/backend/src/quiz/quiz.controller.ts`
- Test: `apps/backend/src/quiz/quiz.controller.spec.ts`
- Create: `apps/backend/src/quiz/quiz.module.ts`
- Modify: `apps/backend/src/app.module.ts`
- Modify: `apps/backend/package.json` (add `@nestjs/schedule` if not present)

**Interfaces:**
- Consumes: `QuizService` from Task 3, `RolesGuard`/`@Roles` from `apps/backend/src/auth/decorators/roles.decorator.ts`, `@CurrentUser` from `apps/backend/src/auth/decorators/current-user.decorator.ts`, DTOs from Task 2.
- Produces: HTTP routes consumed by the frontend in Tasks 5-8 — see spec's Backend section for the exact route list.

- [ ] **Step 1: Check/install @nestjs/schedule**

Run: `cd apps/backend && cat package.json | grep schedule`
If absent, run: `cd apps/backend && npm install @nestjs/schedule`

- [ ] **Step 2: Write failing controller tests (auth/role gating + basic flow)**

```typescript
// apps/backend/src/quiz/quiz.controller.spec.ts
import { Test } from '@nestjs/testing';
import { QuizController } from './quiz.controller';
import { QuizService } from './quiz.service';

describe('QuizController', () => {
  let controller: QuizController;
  let service: Partial<Record<keyof QuizService, jest.Mock>>;

  beforeEach(async () => {
    service = {
      getTodayQuestion: jest.fn(),
      submitAnswer: jest.fn(),
      getLog: jest.fn(),
      getLogEntry: jest.fn(),
      getScorecard: jest.fn(),
      getLeaderboard: jest.fn(),
      createQuestion: jest.fn(),
      updateQuestion: jest.fn(),
      listQuestions: jest.fn(),
      getQuestionResponses: jest.fn(),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [QuizController],
      providers: [{ provide: QuizService, useValue: service }],
    }).compile();
    controller = moduleRef.get(QuizController);
  });

  it('getToday delegates to service with the current user id', async () => {
    (service.getTodayQuestion as jest.Mock).mockResolvedValue({ id: 'q1' });

    const result = await controller.getToday({ id: 'u1' } as any);

    expect(service.getTodayQuestion).toHaveBeenCalledWith('u1');
    expect(result).toEqual({ id: 'q1' });
  });

  it('answerToday delegates questionId, userId, and selectedOption', async () => {
    (service.submitAnswer as jest.Mock).mockResolvedValue({ id: 'a1' });

    await controller.answerToday({ id: 'u1' } as any, 'q1', { selectedOption: 2 });

    expect(service.submitAnswer).toHaveBeenCalledWith('u1', 'q1', 2);
  });

  it('createQuestion delegates admin id and dto', async () => {
    (service.createQuestion as jest.Mock).mockResolvedValue({ id: 'q1' });
    const dto = {
      question: 'Q',
      options: ['a', 'b', 'c', 'd'],
      correctIndex: 0,
      explanation: 'E',
      scheduledFor: '2026-09-10T00:00:00.000Z',
    };

    await controller.createQuestion({ id: 'admin-1' } as any, dto as any);

    expect(service.createQuestion).toHaveBeenCalledWith('admin-1', dto);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/backend && npx jest src/quiz/quiz.controller.spec.ts`
Expected: FAIL — `Cannot find module './quiz.controller'`

- [ ] **Step 4: Implement QuizController**

First check the exact decorator import paths and `@CurrentUser` usage pattern in `apps/backend/src/settings/settings.controller.ts` (per spec, this is the reference template) and match them exactly — the shape below assumes `@CurrentUser()` returns the full user object with an `id` field; adjust if the actual convention differs.

```typescript
// apps/backend/src/quiz/quiz.controller.ts
import { Body, Controller, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { QuizService } from './quiz.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CreateQuizQuestionDto } from './dto/create-quiz-question.dto';
import { UpdateQuizQuestionDto } from './dto/update-quiz-question.dto';
import { AnswerQuizQuestionDto } from './dto/answer-quiz-question.dto';

@Controller('quiz')
export class QuizController {
  constructor(private readonly quiz: QuizService) {}

  @Get('today')
  getToday(@CurrentUser() user: { id: string }) {
    return this.quiz.getTodayQuestion(user.id);
  }

  @Post('today/answer')
  answerToday(
    @CurrentUser() user: { id: string },
    @Body('questionId') questionId: string,
    @Body() dto: AnswerQuizQuestionDto,
  ) {
    return this.quiz.submitAnswer(user.id, questionId, dto.selectedOption);
  }

  @Get('log')
  getLog(@Query('page', new ParseIntPipe({ optional: true })) page = 1, @Query('pageSize', new ParseIntPipe({ optional: true })) pageSize = 20) {
    return this.quiz.getLog(page, pageSize);
  }

  @Get('log/:id')
  getLogEntry(@Param('id') id: string) {
    return this.quiz.getLogEntry(id);
  }

  @Get('scorecard')
  getScorecard(@CurrentUser() user: { id: string }) {
    return this.quiz.getScorecard(user.id);
  }

  @Get('scorecard/leaderboard')
  getLeaderboard() {
    return this.quiz.getLeaderboard();
  }

  @Roles(UserRole.ADMIN)
  @Post('questions')
  createQuestion(@CurrentUser() user: { id: string }, @Body() dto: CreateQuizQuestionDto) {
    return this.quiz.createQuestion(user.id, dto);
  }

  @Roles(UserRole.ADMIN)
  @Put('questions/:id')
  updateQuestion(@Param('id') id: string, @Body() dto: UpdateQuizQuestionDto) {
    return this.quiz.updateQuestion(id, dto);
  }

  @Roles(UserRole.ADMIN)
  @Get('questions')
  listQuestions() {
    return this.quiz.listQuestions();
  }

  @Roles(UserRole.ADMIN)
  @Get('questions/:id/responses')
  getQuestionResponses(@Param('id') id: string) {
    return this.quiz.getQuestionResponses(id);
  }
}
```

Note: the controller test in Step 2 calls `controller.answerToday(user, 'q1', dto)` directly (bypassing HTTP body parsing), which matches calling the method with `(user, questionId, dto)` positionally — this works because Nest route handlers are plain methods when unit-tested directly.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/backend && npx jest src/quiz/quiz.controller.spec.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Create QuizModule and wire into AppModule**

```typescript
// apps/backend/src/quiz/quiz.module.ts
import { Module } from '@nestjs/common';
import { QuizController } from './quiz.controller';
import { QuizService } from './quiz.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [QuizController],
  providers: [QuizService],
})
export class QuizModule {}
```

Check exact module/file names for `PrismaModule` and `AuditModule` under `apps/backend/src/prisma/` and `apps/backend/src/audit/` before importing — adjust import paths if they differ.

In `apps/backend/src/app.module.ts`, add `ScheduleModule.forRoot()` and `QuizModule` to the root `imports` array (find the existing `@Module({ imports: [...] })` decorator and add both entries; import `ScheduleModule` from `@nestjs/schedule` and `QuizModule` from `./quiz/quiz.module`).

- [ ] **Step 7: Run full backend test suite to check for regressions**

Run: `cd apps/backend && npx jest`
Expected: PASS — all existing tests plus new quiz tests, no regressions

- [ ] **Step 8: Commit**

```bash
git add apps/backend/src/quiz/quiz.controller.ts apps/backend/src/quiz/quiz.controller.spec.ts apps/backend/src/quiz/quiz.module.ts apps/backend/src/app.module.ts apps/backend/package.json apps/backend/package-lock.json
git commit -m "feat(quiz): add QuizController and wire QuizModule into the app"
```

---

## Task 5: Sidebar nav item + RBAC route gating

**Files:**
- Modify: `apps/frontend/src/app/dashboard/layout.tsx`
- Modify: `apps/frontend/src/lib/rbac.ts`

**Interfaces:**
- Consumes: existing `navItems: NavItem[]` array and `ADMIN_ONLY_ROUTE_PREFIXES` array/`isRouteAllowed` function.
- Produces: `/dashboard/quiz` route visible to all roles in the sidebar; `/dashboard/quiz/manage` gated to ADMIN only.

- [ ] **Step 1: Read the current nav array and rbac file**

Run: `cd apps/frontend && grep -n "navItems" -A 10 src/app/dashboard/layout.tsx | head -20` and `cat src/lib/rbac.ts`

- [ ] **Step 2: Add the Quiz nav entry**

In `apps/frontend/src/app/dashboard/layout.tsx`, inside the `navItems: NavItem[]` array (near the existing `Users`/`Settings` entries), add:

```typescript
{ label: 'Quiz', href: '/dashboard/quiz', icon: HelpCircle, roles: ['ADMIN', 'AVP', 'TEAM_LEAD', 'TESTER'] },
```

Check the existing icon import source (likely `lucide-react`, matching other nav items) and import `HelpCircle` (or an equivalent quiz/question icon already used elsewhere in the codebase) from that same package at the top of the file.

- [ ] **Step 3: Add manage route to admin-only prefixes**

In `apps/frontend/src/lib/rbac.ts`, add `/dashboard/quiz/manage` to the `ADMIN_ONLY_ROUTE_PREFIXES` array, following the existing entries' exact format (e.g. matching how `/dashboard/settings` or `/dashboard/users` is listed there).

- [ ] **Step 4: Manual verification**

Run: `cd apps/frontend && npm run dev`, log in as a non-admin user, confirm "Quiz" appears in the sidebar and navigating to `/dashboard/quiz/manage` directly redirects to `/unauthorized`. Log in as ADMIN, confirm `/dashboard/quiz/manage` loads (it will 404/blank until Task 8 — that's expected at this point, just confirm no redirect).

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/app/dashboard/layout.tsx apps/frontend/src/lib/rbac.ts
git commit -m "feat(quiz): add Quiz sidebar entry and admin-gate the manage route"
```

---

## Task 6: Question of the Day page

**Files:**
- Create: `apps/frontend/src/app/dashboard/quiz/page.tsx`

**Interfaces:**
- Consumes: `GET /quiz/today`, `POST /quiz/today/answer` (Task 4), `useAuth()` from `apps/frontend/src/contexts/auth-context.tsx`, `useToast()` from `apps/frontend/src/components/toast-provider.tsx`, `api` axios client.

- [ ] **Step 1: Implement the page**

```tsx
// apps/frontend/src/app/dashboard/quiz/page.tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/contexts/auth-context';
import { useToast } from '@/components/toast-provider';
import { api } from '@/contexts/auth-context';

type ActiveQuestion = {
  id: string;
  question: string;
  options: string[];
  scheduledFor: string;
  status: 'ACTIVE';
  alreadyAnswered: boolean;
};

type RevealedQuestion = {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  revealedAt: string;
  participants: number;
  correctCount: number;
  incorrectCount: number;
};

type TodayResponse = ActiveQuestion | RevealedQuestion | null;

function isRevealed(q: TodayResponse): q is RevealedQuestion {
  return !!q && 'correctIndex' in q;
}

function useCountdown(scheduledFor: string) {
  const [remainingMs, setRemainingMs] = useState(0);
  useEffect(() => {
    const deadline = new Date(scheduledFor).getTime() + 24 * 60 * 60 * 1000;
    const tick = () => setRemainingMs(Math.max(0, deadline - Date.now()));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [scheduledFor]);
  const hours = Math.floor(remainingMs / 3_600_000);
  const minutes = Math.floor((remainingMs % 3_600_000) / 60_000);
  const seconds = Math.floor((remainingMs % 60_000) / 1000);
  return `${hours}h ${minutes}m ${seconds}s`;
}

export default function QuizPage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [data, setData] = useState<TodayResponse>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get('/quiz/today');
      setData(res.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const countdown = useCountdown(!isRevealed(data) && data ? data.scheduledFor : new Date().toISOString());

  const submit = async () => {
    if (selected === null || isRevealed(data) || !data) return;
    setSubmitting(true);
    try {
      await api.post('/quiz/today/answer', { questionId: data.id, selectedOption: selected });
      showToast('Answer submitted!', 'success');
      await load();
    } catch (err: any) {
      showToast(err?.response?.data?.message ?? 'Could not submit answer', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="p-6 text-gray-400">Loading today's question…</div>;

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-white">Question of the Day</h1>
        {user?.role === 'ADMIN' && (
          <Link href="/dashboard/quiz/manage" className="glass px-3 py-1.5 rounded-lg text-sm text-gray-200 hover:text-white">
            Manage Quiz
          </Link>
        )}
      </div>

      {!data && (
        <div className="glass-card p-6 rounded-xl text-gray-400">No active question right now. Check back soon.</div>
      )}

      <AnimatePresence mode="wait">
        {data && !isRevealed(data) && (
          <motion.div key="active" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="glass-card p-6 rounded-xl space-y-4">
            <p className="text-lg text-white">{data.question}</p>
            <div className="text-xs text-gray-400">Answer revealed in {countdown}</div>
            {data.alreadyAnswered ? (
              <p className="text-sm text-cyan-400">You've already answered — check back after the reveal.</p>
            ) : (
              <>
                <div className="grid gap-2">
                  {data.options.map((opt, i) => (
                    <button
                      key={i}
                      onClick={() => setSelected(i)}
                      className={`glass text-left px-4 py-2.5 rounded-lg text-gray-200 transition-colors ${selected === i ? 'border-cyan-400 text-white' : 'hover:text-white'}`}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
                <button
                  onClick={submit}
                  disabled={selected === null || submitting}
                  className="glass px-4 py-2 rounded-lg text-white disabled:opacity-40"
                >
                  {submitting ? 'Submitting…' : 'Submit Answer'}
                </button>
              </>
            )}
          </motion.div>
        )}

        {data && isRevealed(data) && (
          <motion.div key="revealed" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-6 rounded-xl space-y-3">
            <p className="text-lg text-white">{data.question}</p>
            <p className="text-cyan-400 font-medium">Correct answer: {data.options[data.correctIndex]}</p>
            <p className="text-gray-300 text-sm">{data.explanation}</p>
            <div className="flex gap-4 text-sm text-gray-400">
              <span>{data.participants} participants</span>
              <span>{data.correctCount} correct</span>
              <span>{data.incorrectCount} incorrect</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
```

Before finalizing, check the exact export shape of `useToast()` (`showToast(message, type)` vs a different signature) in `apps/frontend/src/components/toast-provider.tsx` and adjust the calls above to match.

- [ ] **Step 2: Manual verification**

Run: `cd apps/frontend && npm run dev`, navigate to `/dashboard/quiz` as a non-admin user. Confirm: empty state renders when no active question; once a question is created and scheduled (via direct API call or Task 8's admin UI) and its cron sweep activates it, the option grid renders, selecting an option and submitting shows a success toast and disables re-answering; after the 24h window (or manually flipping status in the DB for testing) the revealed view renders with correct answer, explanation, and stats.

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/app/dashboard/quiz/page.tsx
git commit -m "feat(quiz): add Question of the Day page"
```

---

## Task 7: Question Log page + Scorecard page

**Files:**
- Create: `apps/frontend/src/app/dashboard/quiz/log/page.tsx`
- Create: `apps/frontend/src/app/dashboard/quiz/scorecard/page.tsx`

**Interfaces:**
- Consumes: `GET /quiz/log`, `GET /quiz/log/:id`, `GET /quiz/scorecard`, `GET /quiz/scorecard/leaderboard` (Task 4).

- [ ] **Step 1: Implement the Question Log page**

```tsx
// apps/frontend/src/app/dashboard/quiz/log/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { api } from '@/contexts/auth-context';

type LogItem = { id: string; question: string; revealedAt: string };
type LogDetail = {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  revealedAt: string;
  participants: number;
  correctCount: number;
  incorrectCount: number;
};

export default function QuizLogPage() {
  const [items, setItems] = useState<LogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<LogDetail | null>(null);

  useEffect(() => {
    api.get('/quiz/log').then((res) => {
      setItems(res.data.items);
      setLoading(false);
    });
  }, []);

  const openDetail = async (id: string) => {
    const res = await api.get(`/quiz/log/${id}`);
    setDetail(res.data);
  };

  if (loading) return <div className="p-6 text-gray-400">Loading question log…</div>;

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-4">
      <h1 className="text-2xl font-semibold text-white">Question Log</h1>
      <div className="space-y-2">
        {items.map((item) => (
          <button
            key={item.id}
            onClick={() => openDetail(item.id)}
            className="glass-card w-full text-left p-4 rounded-lg text-gray-200 hover:text-white"
          >
            <div>{item.question}</div>
            <div className="text-xs text-gray-500">{new Date(item.revealedAt).toLocaleDateString()}</div>
          </button>
        ))}
        {items.length === 0 && <div className="text-gray-500">No revealed questions yet.</div>}
      </div>

      {detail && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50" onClick={() => setDetail(null)}>
          <div className="glass-card max-w-lg w-full p-6 rounded-xl space-y-3" onClick={(e) => e.stopPropagation()}>
            <p className="text-lg text-white">{detail.question}</p>
            <p className="text-cyan-400">Correct answer: {detail.options[detail.correctIndex]}</p>
            <p className="text-gray-300 text-sm">{detail.explanation}</p>
            <div className="flex gap-4 text-sm text-gray-400">
              <span>{detail.participants} participants</span>
              <span>{detail.correctCount} correct</span>
              <span>{detail.incorrectCount} incorrect</span>
            </div>
            <button onClick={() => setDetail(null)} className="glass px-3 py-1.5 rounded-lg text-sm text-gray-300">
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Implement the Scorecard page**

```tsx
// apps/frontend/src/app/dashboard/quiz/scorecard/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { api } from '@/contexts/auth-context';

type Scorecard = {
  totalAnswered: number;
  correct: number;
  incorrect: number;
  accuracy: number;
  totalPoints: number;
  currentStreak: number;
  bestStreak: number;
  badges: string[];
};

type LeaderboardEntry = { userId: string; name: string; totalPoints: number; currentStreak: number; bestStreak: number; badges: string[] };

export default function QuizScorecardPage() {
  const [card, setCard] = useState<Scorecard | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.get('/quiz/scorecard'), api.get('/quiz/scorecard/leaderboard')]).then(([c, l]) => {
      setCard(c.data);
      setLeaderboard(l.data);
      setLoading(false);
    });
  }, []);

  if (loading || !card) return <div className="p-6 text-gray-400">Loading scorecard…</div>;

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl font-semibold text-white">Scorecard</h1>

      <div className="glass-card p-6 rounded-xl grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
        <div><div className="text-2xl text-white">{card.totalPoints}</div><div className="text-xs text-gray-400">Points</div></div>
        <div><div className="text-2xl text-white">{card.accuracy}%</div><div className="text-xs text-gray-400">Accuracy</div></div>
        <div><div className="text-2xl text-white">{card.currentStreak}</div><div className="text-xs text-gray-400">Current Streak</div></div>
        <div><div className="text-2xl text-white">{card.bestStreak}</div><div className="text-xs text-gray-400">Best Streak</div></div>
      </div>

      <div className="glass-card p-4 rounded-xl">
        <div className="text-sm text-gray-400 mb-2">Badges</div>
        <div className="flex flex-wrap gap-2">
          {card.badges.length === 0 && <span className="text-gray-500 text-sm">No badges yet.</span>}
          {card.badges.map((b) => (
            <span key={b} className="glass px-3 py-1 rounded-full text-xs text-cyan-300">{b.replace(/_/g, ' ')}</span>
          ))}
        </div>
      </div>

      <div className="glass-card rounded-xl overflow-hidden">
        <div className="p-4 text-sm text-gray-400">Leaderboard</div>
        <table className="w-full text-sm">
          <tbody>
            {leaderboard.map((entry, i) => (
              <tr key={entry.userId} className="border-t border-gray-800">
                <td className="p-3 text-gray-500 w-10">{i + 1}</td>
                <td className="p-3 text-gray-200">{entry.name}</td>
                <td className="p-3 text-right text-cyan-400">{entry.totalPoints} pts</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Manual verification**

Run: `cd apps/frontend && npm run dev`, navigate to `/dashboard/quiz/log` and `/dashboard/quiz/scorecard`, confirm data renders correctly against a backend with at least one revealed question and one answered attempt.

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/app/dashboard/quiz/log/page.tsx apps/frontend/src/app/dashboard/quiz/scorecard/page.tsx
git commit -m "feat(quiz): add Question Log and Scorecard pages"
```

---

## Task 8: Admin Manage Quiz page

**Files:**
- Create: `apps/frontend/src/app/dashboard/quiz/manage/page.tsx`

**Interfaces:**
- Consumes: `GET /quiz/questions`, `POST /quiz/questions`, `PUT /quiz/questions/:id`, `GET /quiz/questions/:id/responses` (Task 4).

- [ ] **Step 1: Implement the admin management page**

```tsx
// apps/frontend/src/app/dashboard/quiz/manage/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { api } from '@/contexts/auth-context';
import { useToast } from '@/components/toast-provider';

type Question = {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  scheduledFor: string;
  status: 'SCHEDULED' | 'ACTIVE' | 'REVEALED';
};

const emptyForm = { question: '', options: ['', '', '', ''], correctIndex: 0, explanation: '', scheduledFor: '' };

export default function QuizManagePage() {
  const { showToast } = useToast();
  const [questions, setQuestions] = useState<Question[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = () => api.get('/quiz/questions').then((res) => setQuestions(res.data));

  useEffect(() => {
    load();
  }, []);

  const startEdit = (q: Question) => {
    setEditingId(q.id);
    setForm({
      question: q.question,
      options: q.options,
      correctIndex: q.correctIndex,
      explanation: q.explanation,
      scheduledFor: q.scheduledFor.slice(0, 16),
    });
  };

  const resetForm = () => {
    setEditingId(null);
    setForm(emptyForm);
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload = { ...form, scheduledFor: new Date(form.scheduledFor).toISOString() };
      if (editingId) {
        await api.put(`/quiz/questions/${editingId}`, payload);
        showToast('Question updated', 'success');
      } else {
        await api.post('/quiz/questions', payload);
        showToast('Question scheduled', 'success');
      }
      resetForm();
      await load();
    } catch (err: any) {
      showToast(err?.response?.data?.message ?? 'Could not save question', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl font-semibold text-white">Manage Quiz</h1>

      <div className="glass-card p-6 rounded-xl space-y-3">
        <div className="text-sm text-gray-400">{editingId ? 'Edit question' : 'New question'}</div>
        <input
          className="glass w-full px-3 py-2 rounded-lg text-white bg-transparent"
          placeholder="Question"
          value={form.question}
          onChange={(e) => setForm({ ...form, question: e.target.value })}
        />
        {form.options.map((opt, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              type="radio"
              checked={form.correctIndex === i}
              onChange={() => setForm({ ...form, correctIndex: i })}
            />
            <input
              className="glass flex-1 px-3 py-2 rounded-lg text-white bg-transparent"
              placeholder={`Option ${i + 1}`}
              value={opt}
              onChange={(e) => {
                const options = [...form.options];
                options[i] = e.target.value;
                setForm({ ...form, options });
              }}
            />
          </div>
        ))}
        <textarea
          className="glass w-full px-3 py-2 rounded-lg text-white bg-transparent"
          placeholder="Explanation"
          value={form.explanation}
          onChange={(e) => setForm({ ...form, explanation: e.target.value })}
        />
        <input
          type="datetime-local"
          className="glass px-3 py-2 rounded-lg text-white bg-transparent"
          value={form.scheduledFor}
          onChange={(e) => setForm({ ...form, scheduledFor: e.target.value })}
        />
        <div className="flex gap-2">
          <button onClick={save} disabled={saving} className="glass px-4 py-2 rounded-lg text-white disabled:opacity-40">
            {saving ? 'Saving…' : editingId ? 'Update' : 'Schedule'}
          </button>
          {editingId && (
            <button onClick={resetForm} className="glass px-4 py-2 rounded-lg text-gray-300">
              Cancel
            </button>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-sm text-gray-400">All questions</div>
        {questions.map((q) => (
          <div key={q.id} className="glass-card p-4 rounded-lg flex items-center justify-between">
            <div>
              <div className="text-gray-200">{q.question}</div>
              <div className="text-xs text-gray-500">
                {q.status} · {new Date(q.scheduledFor).toLocaleString()}
              </div>
            </div>
            {q.status === 'SCHEDULED' && (
              <button onClick={() => startEdit(q)} className="glass px-3 py-1.5 rounded-lg text-sm text-gray-300">
                Edit
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Manual verification**

Run: `cd apps/frontend && npm run dev`, log in as ADMIN, navigate to `/dashboard/quiz/manage`. Create a question scheduled a minute in the future, confirm it appears in the list as `SCHEDULED`, wait for the cron sweep (or check the backend logs) and confirm status flips to `ACTIVE`, confirm the question then appears correctly on `/dashboard/quiz` for a non-admin user. Confirm editing a `SCHEDULED` question works and editing an `ACTIVE`/`REVEALED` one is not offered (no Edit button rendered).

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/app/dashboard/quiz/manage/page.tsx
git commit -m "feat(quiz): add admin Manage Quiz page"
```

---

## Task 9: End-to-end verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run full backend test suite**

Run: `cd apps/backend && npx jest`
Expected: PASS, no regressions.

- [ ] **Step 2: Run frontend build**

Run: `cd apps/frontend && npm run build`
Expected: build succeeds with no TypeScript errors in the new `quiz/` files.

- [ ] **Step 3: Manual full-flow walkthrough**

Using the `webapp-testing` skill or a browser: as ADMIN, schedule a question a minute out; confirm it activates; as a non-admin user, answer it; confirm double-submission is blocked; wait for/simulate the 24h reveal (adjust `scheduledFor` directly in the DB to speed this up for testing) and confirm the dashboard card shows reveal + stats, the entry appears in Question Log, and the Scorecard/leaderboard reflect the new points/streak/badge.

- [ ] **Step 4: Push the branch**

```bash
git push -u origin features/themes-quiz
```
