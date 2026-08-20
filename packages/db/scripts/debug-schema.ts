import postgres from 'postgres';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Read .env manually to ensure we are connecting exactly where the app connects
const envFile = readFileSync(resolve('../../.env'), 'utf-8');
const dbUrlMatch = envFile.match(/DATABASE_URL=(.+)/);
if (!dbUrlMatch) {
    console.error("No DATABASE_URL found in .env");
    process.exit(1);
}
const dbUrl = dbUrlMatch[1].trim();
const sql = postgres(dbUrl);

async function main() {
    try {
        const result = await sql`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'users';
        `;
        console.log("COLUMNS:", result.map(r => r.column_name).join(', '));
    } catch (e) {
        console.error("Error questioning db:", e);
    } finally {
        await sql.end();
    }
}
main();
