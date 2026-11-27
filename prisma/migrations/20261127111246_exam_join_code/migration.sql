-- AlterTable
ALTER TABLE "Exam" ADD COLUMN     "joinCode" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Exam_joinCode_key" ON "Exam"("joinCode");
