import { apiFetch } from '@/api/client';
import type { ReplanResponse } from '@/api/types/replan';

export function replan(): Promise<ReplanResponse> {
    return apiFetch<ReplanResponse>('/replan', { method: 'POST' });
}
