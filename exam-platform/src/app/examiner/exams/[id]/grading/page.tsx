import { LiveGradingQueue } from "@/features/examiner/LiveGrading";
import { isLive } from "@/lib/api";
import { notFound } from "next/navigation";

export default function GradingPage() {
  if (!isLive) notFound();
  return <LiveGradingQueue />;
}
