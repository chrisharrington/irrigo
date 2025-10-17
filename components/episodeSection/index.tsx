import { ItemSection, ItemSectionProps } from '../itemSection';

export function EpisodeSection(props: ItemSectionProps) {
    return (
        <ItemSection
            {...props}
            getPosterUrl={episode =>
                `${process.env.EXPO_PUBLIC_JELLYFIN_URL}/Items/${episode.SeriesId}/Images/Primary?api_key=${process.env.EXPO_PUBLIC_JELLYFIN_API_KEY}`
            }
        />
    );
}
