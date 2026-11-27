"use client";

import { Heading } from "@/components/shared";
import { CandidatePortalPage } from "@/features/candidate/CandidatePortalPage";
import { WorkspacePreferences } from "@/features/candidate/WorkspacePreferences";
import { isLive } from "@/lib/api";

export default function CandidatePage() {
  if (!isLive) return <CandidatePortalPage />;
  return (
    <>
      <Heading title="My workspace" />
      <WorkspacePreferences />
    </>
  );
}
