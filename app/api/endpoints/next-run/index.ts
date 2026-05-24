import { apiFetch } from '@/api/client';
import type { NextRunDto } from '@/api/types/next-run';

// URL stays '/tonight' until the backend widens to /next-run — see follow-up API ticket.
export function getNextRun(): Promise<NextRunDto> {
    return apiFetch<NextRunDto>('/tonight');
}
