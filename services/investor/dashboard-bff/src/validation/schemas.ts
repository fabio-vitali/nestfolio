import { z } from 'zod';

// --- Query argument schemas ---

export const PaginationLimitSchema = z.number().int().positive().max(100).default(20);
