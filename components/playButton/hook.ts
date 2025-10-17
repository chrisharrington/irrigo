import { useCast } from '@/contexts/cast';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { useRemoteMediaClient } from 'react-native-google-cast';
import { PlayButtonProps } from '.';
import { useToast } from '../toast';

export function usePlayButton(props: PlayButtonProps) {
    const { push } = useRouter(),
        { cast } = useCast(),
        client = useRemoteMediaClient(),
        toast = useToast();

    /**
     * Handles the press event for the play button.
     * If connected to a cast device, navigates to the remote control screen and casts the media.
     * Otherwise, navigates directly to the video player screen.
     * @throws {Error} When the media item or source is not found.
     */
    const onPress = async () => {
        try {
            if (!props.item || !props.item.MediaSources?.[0]) throw new Error('Item or media source not found.');

            // Construct the navigation URL based on whether a cast device is connected.
            let url = `/${props.item.Id}/${props.item.MediaSources?.[0].Id}`;

            // If a client is available, cast the video.
            if (client) cast(props.item);

            // Navigate to the appropriate screen.
            push(`${client ? '/remote' : '/video'}${url}`);
        } catch (e) {
            toast.error('Unable to play media. Please try again later.');
        }
    };

    return {
        isResumable: useMemo(() => (props.item?.UserData?.PlaybackPositionTicks || 0) > 0, [props.item]),
        onPress,
    };
}
