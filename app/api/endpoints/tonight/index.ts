import { apiFetch } from '@/api/client';
import type { TonightDto } from '@/api/types/tonight';

export function getTonight(): Promise<TonightDto> {
    return apiFetch<TonightDto>('/tonight');
}
