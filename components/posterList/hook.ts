import { useJellyfin } from '@/contexts/jellyfin';

export function usePosterList() {
    const { getImageForId } = useJellyfin();

    return {
        getImageForId,
    };
}
