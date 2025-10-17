import { useEffect } from 'react';

export function useAsyncEffect(
    callback: () => void | Promise<void> | Promise<(() => void) | undefined> | (() => void) | (() => Promise<void>),
    dependencies: any[]
) {
    useEffect(() => {
        let cleanup: (() => void) | (() => Promise<void>) | undefined;

        (async () => {
            try {
                const result = await callback();
                if (typeof result === 'function') cleanup = result;
            } catch (error) {
                // Let the error bubble up naturally - don't suppress it
                console.error('useAsyncEffect callback error:', error);
            }
        })();

        return () => {
            if (cleanup) {
                try {
                    if (cleanup.constructor.name === 'AsyncFunction') {
                        (cleanup as () => Promise<void>)();
                    } else {
                        (cleanup as () => void)();
                    }
                } catch (error) {
                    console.error('useAsyncEffect cleanup error:', error);
                }
            }
        };
    }, dependencies);
}
