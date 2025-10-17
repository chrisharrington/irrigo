import { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models';
import { useRouter } from 'expo-router';

export function useTvSection() {
    const { push } = useRouter();

    return {
        navigateToTvShowDetails: (tvShow: BaseItemDto) => push(`/tv/${tvShow.Name}/${tvShow.Id}`),
    };
}
