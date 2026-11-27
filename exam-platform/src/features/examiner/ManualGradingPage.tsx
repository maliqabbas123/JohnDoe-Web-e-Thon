"use client";

import { useParams } from "next/navigation";
import { Suspense } from "react";
import { isLive } from "@/lib/api";
import { LiveSubmissionReview } from "./LiveGrading";

import { Grade, Missing, useExam } from "./shared";

export function ManualGradingPage() {
  if (isLive)
    return (
      <Suspense fallback={<p role="status">Loading submission…</p>}>
        <LiveSubmissionReview />
      </Suspense>
    );
  return <DemoManualGradingPage />;
}

function DemoManualGradingPage() {
  const { attemptId } = useParams<{ attemptId: string }>(),
    { exam, attempts } = useExam(),
    a = attempts.find((a) => a.id === attemptId && a.submitted && !a.pending);
  return exam && a ? <Grade key={a.id} exam={exam} attempt={a} /> : <Missing />;
}
