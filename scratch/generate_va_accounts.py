import bcrypt

users = [
    {
        "id": "a1111111-1111-1111-1111-111111111111",
        "email": "va1@tutorialstudio.com",
        "name": "Virtual Assistant 1",
        "role": "TUTORIAL_VA",
        "passwordPlain": "TutorialVA1_2026!",
    },
    {
        "id": "a2222222-2222-2222-2222-222222222222",
        "email": "va2@tutorialstudio.com",
        "name": "Virtual Assistant 2",
        "role": "TUTORIAL_VA",
        "passwordPlain": "TutorialVA2_2026!",
    },
    {
        "id": "a0000000-0000-0000-0000-000000000000",
        "email": "admin@tutorialstudio.com",
        "name": "Admin",
        "role": "ADMIN",
        "passwordPlain": "AdminStudio2026!",
    }
]

sql_statements = [
    "-- Migration 0067_seed_va_accounts.sql",
    "-- Pre-configured login accounts for 2 Virtual Assistants + Admin",
    ""
]

for u in users:
    # Hash password using bcrypt 10 rounds (compatible with $2a$ and $2b$)
    hashed = bcrypt.hashpw(u["passwordPlain"].encode("utf-8"), bcrypt.gensalt(10)).decode("utf-8")
    u["hash"] = hashed
    sql_statements.append(
        f"INSERT INTO users (id, email, name, role, password_hash, is_active, created_at, updated_at) "
        f"VALUES ('{u['id']}', '{u['email']}', '{u['name']}', '{u['role']}', '{hashed}', true, now(), now()) "
        f"ON CONFLICT (email) DO UPDATE SET password_hash = '{hashed}', role = '{u['role']}', is_active = true;"
    )

output_sql = "\n".join(sql_statements)

with open(r"c:\Users\konra\OneDrive\Projekte\20260816 TutorialProductionLine\packages\db\src\migrations\0067_seed_va_accounts.sql", "w", encoding="utf-8") as f:
    f.write(output_sql)

with open(r"c:\Users\konra\OneDrive\Projekte\20260816 TutorialProductionLine\scratch\seed-va-users.sql", "w", encoding="utf-8") as f:
    f.write(output_sql)

print("Generated VA Accounts SQL successfully.")
for u in users:
    print(f"Role: {u['role']:12s} | Email: {u['email']:25s} | Password: {u['passwordPlain']}")
