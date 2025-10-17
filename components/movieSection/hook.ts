import { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models';
import { useRouter } from 'expo-router';

export function useMovieSection() {
    const { push } = useRouter();

    return {
        navigateToMovieDetails: (movie: BaseItemDto) => push(`/movie/${movie.Name}/${movie.Id}`),
    };
}
