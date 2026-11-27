"use client";

import { Heading } from "@/components/shared";
import { LiveCandidateExams } from "@/features/candidate/LiveCandidateExams";
import { CandidatePortalPage } from "@/features/candidate/CandidatePortalPage";
import { WorkspacePreferences } from "@/features/candidate/WorkspacePreferences";
import { isLive } from "@/lib/api";

export default function CandidatePage() {
  if (!isLive) return <CandidatePortalPage />;
  return (
    <>
      <Heading title="My workspace" />
      <LiveCandidateExams />
      <WorkspacePreferences />
    </>
  );
}
