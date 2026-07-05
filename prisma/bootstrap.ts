import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config(); // fallback to .env

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");

const pool = new pg.Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const passwordHash = await bcrypt.hash("admin", 12);
  const user = await prisma.user.upsert({
    where: { username: "admin" },
    update: { passwordHash, mustChangePassword: true, active: true },
    create: {
      username: "admin",
      passwordHash,
      displayName: "Administrator",
      role: "superuser",
      mustChangePassword: true,
    },
  });
  console.log(`\nBootstrap complete. Superuser created: ${user.username}`);
  console.log(`Login with admin / admin — password change required on first login.\n`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
