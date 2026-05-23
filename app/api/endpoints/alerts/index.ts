import { apiFetch } from '@/api/client';
import type { AckResult, AlertDto } from '@/api/types/alerts';

export async function getAlerts(): Promise<AlertDto[]> {
    const body = await apiFetch<{ alerts: AlertDto[] }>('/alerts');
    return body.alerts;
}

export async function ackAlert(alertId: string): Promise<AckResult> {
    const body = await apiFetch<{ status: AckResult }>(`/alerts/${encodeURIComponent(alertId)}/ack`, {
        method: 'POST',
    });
    return body.status;
}
