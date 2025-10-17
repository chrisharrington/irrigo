import { useToast } from '@/components/toast';
import { useJellyfin } from '@/contexts/jellyfin';
import { useState } from 'react';
import { TogglePlayedButtonProps } from '.';

export function useTogglePlayedButton(props: TogglePlayedButtonProps) {
    const [isToggling, setToggling] = useState<boolean>(false),
        [isPlayed, setPlayed] = useState<boolean>(props.item?.UserData?.Played || false),
        { toggleItemWatched } = useJellyfin(),
        toast = useToast();

    return {
        isToggling,
        isPlayed: isPlayed,
        handleTogglePlayed,
    };

    /**
     * Toggles the played status of the provided item and displays a success toast.
     * If the item has any playback progress, it will be marked as played.
     * @throws {Error} If the toggle operation fails
     * @returns {Promise<void>}
     */
    async function handleTogglePlayed() {
        if (!props.item || isToggling) return;

        try {
            setToggling(true);

            // Check if item has playback progress
            const hasProgress = (props.item.UserData?.PlaybackPositionTicks || 0) > 0;

            // For items with progress, mark as watched (true)
            // For items without progress, toggle current state (false for unplayed items)
            const targetWatchedState = hasProgress ? true : false;

            // Use the Jellyfin toggleItemWatched method
            const newWatchedState = await toggleItemWatched(props.item, targetWatchedState);

            // Indicate to the user that the Jellyfin call completed successfully.
            toast.success(`${props.item.Name} has been marked as ${newWatchedState ? 'played' : 'unplayed'}.`);

            // Update the played state based on the returned value.
            setPlayed(newWatchedState);

            // Call the optional callback if provided.
            if (props.onToggleComplete) props.onToggleComplete();
        } catch (error) {
            toast.error('Failed to update played status. Please try again.', error);
        } finally {
            setToggling(false);
        }
    }
}
