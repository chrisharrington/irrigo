import { db } from '@/db';
import { zones } from '@/db/schema';

const DEPLETION_MM = 5;

const result = await db
    .update(zones)
    .set({ currentDepletionMm: DEPLETION_MM });

console.log(`reset-depletion: set currentDepletionMm=${DEPLETION_MM} on all zones.`);
process.exit(0);
