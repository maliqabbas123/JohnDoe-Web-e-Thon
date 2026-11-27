import { ExamLobbyPage } from "@/features/candidate/ExamLobbyPage";
import { LiveCandidateLobby } from "@/features/candidate/LiveCandidateExams";
import { isLive } from "@/lib/api";

export default function LobbyPage() {
  return isLive ? <LiveCandidateLobby /> : <ExamLobbyPage />;
}
