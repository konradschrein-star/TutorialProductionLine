import '@testing-library/jest-dom';
import { config } from 'dotenv';
import path from 'path';

// Load .env.local for test environment
// This ensures DATABASE_URL and other env vars are available in tests
config({ path: path.resolve(__dirname, '.env.local') });
