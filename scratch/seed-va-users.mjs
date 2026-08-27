import bcrypt from "bcryptjs";
import { writeFileSync } from "fs";

const SALT_ROUNDS = 10;

async function main() {
  const users = [
    {
      id: "a1111111-1111-1111-1111-111111111111",
      email: "va1@tutorialstudio.com",
      name: "Virtual Assistant 1",
      role: "TUTORIAL_VA",
      passwordPlain: "TutorialVA1_2026!",
    },
    {
      id: "a2222222-2222-2222-2222-222222222222",
      email: "va2@tutorialstudio.com",
      name: "Virtual Assistant 2",
      role: "TUTORIAL_VA",
      passwordPlain: "TutorialVA2_2026!",
    },
    // Also include a master admin account in case login is needed
    {
      id: "a0000000-0000-0000-0000-000000000000",
      email: "admin@tutorialstudio.com",
      name: "Admin",
      role: "ADMIN",
      passwordPlain: "AdminStudio2026!",
    }
  ];

  const sqlStatements = [];
  sqlStatements.push("-- Migration / Seed: VA & Admin Accounts");
  sqlStatements.push("");

  for (const u of users) {
    const hash = await bcrypt.hash(u.passwordPlain, SALT_ROUNDS);
    u.hash = hash;
    sqlStatements.push(
      `INSERT INTO users (id, email, name, role, password_hash, is_active, created_at, updated_at) ` +
      `VALUES ('${u.id}', '${u.email}', '${u.name}', '${u.role}', '${hash}', true, now(), now()) ` +
      `ON CONFLICT (email) DO UPDATE SET password_hash = '${hash}', role = '${u.role}', is_active = true;`
    );
  }

  const sqlOut = sqlStatements.join("\n");
  writeFileSync("scratch/seed-va-users.sql", sqlOut, "utf8");
  writeFileSync("packages/db/src/migrations/0067_seed_va_accounts.sql", sqlOut, "utf8");

  console.log("Generated VA Accounts SQL:");
  console.log(JSON.stringify(users.map(u => ({ email: u.email, password: u.passwordPlain, role: u.role })), null, 2));
}

main().catch(console.error);
