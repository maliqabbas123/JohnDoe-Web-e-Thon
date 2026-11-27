// Creates the fictional test accounts listed in the README, one per role.
// Safe to run repeatedly: existing accounts are reset to these values.
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import type { Role } from "../src/generated/prisma/enums";
import { hashPassword } from "../src/server/auth/password";

const TEST_ACCOUNTS: { email: string; name: string; role: Role; password: string }[] = [
  { email: "admin@exam.test", name: "Ada Admin", role: "ADMIN", password: "Admin-Demo-2026" },
  { email: "examiner@exam.test", name: "Evan Examiner", role: "EXAMINER", password: "Examiner-Demo-2026" },
  { email: "candidate@exam.test", name: "Cara Candidate", role: "CANDIDATE", password: "Candidate-Demo-2026" },
  { email: "candidate2@exam.test", name: "Carl Candidate", role: "CANDIDATE", password: "Candidate-Demo-2026" },
];

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");

  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    for (const account of TEST_ACCOUNTS) {
      const passwordHash = await hashPassword(account.password);
      const data = { name: account.name, role: account.role, passwordHash, isActive: true };
      await db.user.upsert({
        where: { email: account.email },
        create: { email: account.email, ...data },
        update: data,
      });
      console.log(`Seeded ${account.role.padEnd(9)} ${account.email}`);
    }
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
