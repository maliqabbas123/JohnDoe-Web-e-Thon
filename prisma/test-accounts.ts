import type { Role } from "../src/generated/prisma/enums";

// Fictional accounts for demonstrations and automated tests, one per role.
// Listed in the README. Never use these values for a real person.
export const TEST_ACCOUNTS = {
  admin: { email: "admin@exam.test", name: "Ada Admin", role: "ADMIN", password: "Admin-Demo-2026" },
  examiner: { email: "examiner@exam.test", name: "Evan Examiner", role: "EXAMINER", password: "Examiner-Demo-2026" },
  candidate: { email: "candidate@exam.test", name: "Cara Candidate", role: "CANDIDATE", password: "Candidate-Demo-2026" },
  candidate2: { email: "candidate2@exam.test", name: "Carl Candidate", role: "CANDIDATE", password: "Candidate-Demo-2026" },
} as const satisfies Record<string, { email: string; name: string; role: Role; password: string }>;

export type TestAccountName = keyof typeof TEST_ACCOUNTS;
