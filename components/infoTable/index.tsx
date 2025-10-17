import { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models';
import { Text, View } from 'react-native';
import { useInfoTable } from './hook';
import styles from './style';

export type InfoTableProps = {
    /** Required. Jellyfin item containing media metadata. */
    item: BaseItemDto;

    /** Required. Whether forced subtitles are available for this media. */
    isForcedSubtitlesAvailable: boolean;

    /** Required. Whether regular subtitles are available for this media. */
    isSubtitlesAvailable: boolean;
};

export function InfoTable(props: InfoTableProps) {
    const { isSubtitlesAvailable, isForcedSubtitlesAvailable } = props,
        { genres, director, writers, video, audio } = useInfoTable(props);

    return (
        <View style={styles.container}>
            <InfoEntry
                label='📝  Subtitles'
                value={
                    isSubtitlesAvailable && isForcedSubtitlesAvailable
                        ? 'Closed Captions, Forced'
                        : isSubtitlesAvailable
                        ? 'Closed Captions'
                        : isForcedSubtitlesAvailable
                        ? 'Forced'
                        : 'None'
                }
            />
            <InfoEntry label='📺  Video' value={video} />
            <InfoEntry label='🔊  Audio' value={audio} />
            <InfoEntry label='🎭  Genres' value={genres} />
            <InfoEntry label='🎬  Director' value={director} />
            <InfoEntry label='✍️  Writers' value={writers} />
        </View>
    );
}

function InfoEntry({ label, value }: { label: string; value: string | null | undefined }) {
    return (
        value && (
            <View style={styles.entry}>
                <Text style={styles.entryLabel}>{label}</Text>
                <Text style={styles.entryValue}>{value}</Text>
            </View>
        )
    );
}
