import { useCallback, useState, type ComponentProps } from 'react';
import { RefreshControl, ScrollView } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';

import config from '@/tailwind.config';

const colors = config.theme.extend.colors;

/**
 * Props for {@link RefreshableScrollView}. Inherits every `ScrollView` prop
 * except `refreshControl`, which the wrapper owns.
 */
export type RefreshableScrollViewProps = Omit<ComponentProps<typeof ScrollView>, 'refreshControl'>;

/**
 * Pull-to-refresh scroll container. Drop-in replacement for RN's
 * `ScrollView` on any data-driven screen.
 *
 * Owns a local `refreshing` state and a `RefreshControl` whose `onRefresh`
 * fires `queryClient.invalidateQueries()` with no key — that flags every
 * cached query stale and refetches each active subscriber on the mounted
 * screen. The hook returns a promise that settles once the refetches
 * complete, so the spinner stays visible until the data has actually
 * updated. APP-40.
 *
 * Trade-off: invalidating all queries on every pull is mildly noisier than
 * targeted per-screen invalidation, but the home-LAN API is cheap and
 * keeps each screen blissfully ignorant of which queries it depends on.
 */
export function RefreshableScrollView({ children, ...rest }: RefreshableScrollViewProps) {
    const queryClient = useQueryClient();
    const [refreshing, setRefreshing] = useState<boolean>(false);

    const onRefresh = useCallback(async () => {
        setRefreshing(true);
        try {
            await queryClient.invalidateQueries();
        } finally {
            setRefreshing(false);
        }
    }, [queryClient]);

    return (
        <ScrollView
            {...rest}
            refreshControl={(
                <RefreshControl
                    refreshing={refreshing}
                    onRefresh={onRefresh}
                    tintColor={colors.accent}
                    colors={[colors.accent]}
                    progressBackgroundColor={colors.elevated}
                />
            )}
        >
            {children}
        </ScrollView>
    );
}
