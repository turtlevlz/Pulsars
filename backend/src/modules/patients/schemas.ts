import { z } from 'zod';

// `%` and `_` are LIKE wildcards; a name search has no use for them, and letting them through
// would let a two-character query list every patient.
const searchText = z
    .string()
    .transform((s) => s.replace(/[%_\\]/g, '').trim())
    .pipe(z.string().min(2, 'Type at least 2 characters').max(100));

export const searchQuery = z.object({ q: searchText });

export type SearchQuery = z.infer<typeof searchQuery>;
