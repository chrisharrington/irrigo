import Config from '@/config';

export type ReplanCliDeps = {
    triggerReplan: () => Promise<void>;
    log: (message: string) => void;
    error: (message: string) => void;
};

export async function replanCli(deps: ReplanCliDeps): Promise<0 | 1> {
    try {
        await deps.triggerReplan();
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        deps.error(`replan: ${message}`);
        return 1;
    }
    deps.log('replan: re-plan triggered.');
    return 0;
}

async function postReplan(): Promise<void> {
    const baseUrl = process.env.IRRIGO_BASE_URL ?? `http://127.0.0.1:${Config.port}`;
    const response = await fetch(`${baseUrl}/replan`, { method: 'POST' });
    if (!response.ok) {
        const body = await response.text().catch(() => '<no body>');
        throw new Error(`POST ${baseUrl}/replan failed: ${response.status} ${response.statusText} — ${body}`);
    }
}

if (import.meta.main) {
    const deps: ReplanCliDeps = {
        triggerReplan: postReplan,
        log: m => console.log(m),
        error: m => console.error(m),
    };
    replanCli(deps).then(code => process.exit(code));
}
