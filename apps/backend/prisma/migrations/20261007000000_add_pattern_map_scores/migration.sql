-- CreateTable
CREATE TABLE "pattern_map_scores" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "rounds_cleared" INTEGER NOT NULL,
    "accuracy" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pattern_map_scores_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pattern_map_scores_user_id_idx" ON "pattern_map_scores"("user_id");

-- CreateIndex
CREATE INDEX "pattern_map_scores_score_idx" ON "pattern_map_scores"("score");

-- AddForeignKey
ALTER TABLE "pattern_map_scores" ADD CONSTRAINT "pattern_map_scores_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
