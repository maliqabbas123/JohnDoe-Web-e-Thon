// Creates the fictional test accounts listed in the README, one per role.
// Safe to run repeatedly: existing accounts are reset to these values.
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { hashPassword } from "../src/server/auth/password";
import { TEST_ACCOUNTS } from "./test-accounts";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");

  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    for (const account of Object.values(TEST_ACCOUNTS)) {
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
