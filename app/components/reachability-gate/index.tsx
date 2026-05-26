import { useEffect, useRef, type PropsWithChildren } from 'react';
import * as SplashScreen from 'expo-splash-screen';

import { ApiError, getApiBaseUrl } from '@/api/client';
import { ErrorView, type ErrorViewProps } from '@/components/error-view';
import { useHealth } from '@/hooks/health';

type FailureCopy = Pick<ErrorViewProps, 'eyebrow' | 'title' | 'sub'>;

/**
 * App-load reachability gate. Probes `GET /health` once on mount via
 * {@link useHealth}; until the probe settles the gate renders `null` so
 * the native splash (held by `preventAutoHideAsync()` in `_layout.tsx`)
 * stays up and the home screen never flashes. On 2xx the gate renders its
 * children; on failure it renders the full-screen `ErrorView` with copy
 * that distinguishes transport failure (`ApiError.status === 0`) from
 * server-side errors. APP-59.
 *
 * The gate hides the native splash on first transition out of `isPending`
 * — on the failure path this is the only thing that drops the splash
 * (HomeView never mounts), and on the success path it's a harmless
 * duplicate of HomeView's own `hideAsync` call.
 */
export function ReachabilityGate({ children }: PropsWithChildren) {
    const { isPending, isError, isFetching, error, refetch } = useHealth();
    const splashHidden = useRef<boolean>(false);

    useEffect(() => {
        if (splashHidden.current || isPending) return;
        splashHidden.current = true;
        console.log('reachability: probe settled; dropping splash.', { isError });
        SplashScreen.hideAsync().catch(err => {
            console.warn('reachability: SplashScreen.hideAsync failed; swallowing.', err);
        });
    }, [isPending, isError]);

    if (isPending) return null;

    if (isError) {
        const copy = failureCopy(error);
        const handleRetry = () => {
            // Refetch is idempotent while one is in flight — React Query
            // coalesces overlapping calls — but gating on isFetching keeps
            // the intent explicit.
            if (isFetching) return;
            refetch().catch(err => {
                console.warn('reachability: refetch threw; swallowing (the error already lives on the query state).', err);
            });
        };
        return (
            <ErrorView
                eyebrow={copy.eyebrow}
                title={copy.title}
                sub={copy.sub}
                state={isFetching ? 'retrying' : 'idle'}
                onRetry={handleRetry}
            />
        );
    }

    return <>{children}</>;
}

/**
 * Maps an `ApiError` (or unknown rejection) into the eyebrow / title /
 * sub-line copy passed to `ErrorView`. Transport failures get the "Can't
 * reach" framing; everything else (5xx, the unlikely 4xx, or a non-Error
 * rejection) gets the "Service is unhealthy" framing. Both surface the
 * resolved base URL so the operator can confirm what was targeted.
 */
function failureCopy(error: ApiError | null): FailureCopy {
    const baseUrl = safeGetBaseUrl();

    if (error instanceof ApiError && error.status === 0) {
        return {
            eyebrow: 'Connection lost',
            title: `Can't reach the Irrigo service`,
            sub: `Tried ${baseUrl}.`,
        };
    }

    const status = error instanceof ApiError ? error.status : 0;
    return {
        eyebrow: 'Service unhealthy',
        title: 'Service is unhealthy',
        sub: `${baseUrl} returned ${status}.`,
    };
}

/**
 * `getApiBaseUrl()` throws when the env var is unset. The gate would
 * never normally reach the error branch with a missing base URL (apiFetch
 * would have thrown during the probe and surfaced as the same error), but
 * we still defend the render path here so the failure copy never crashes
 * the screen — preferring a placeholder over a redbox.
 */
function safeGetBaseUrl(): string {
    try {
        return getApiBaseUrl();
    } catch {
        return '(EXPO_PUBLIC_API_BASE_URL unset)';
    }
}
