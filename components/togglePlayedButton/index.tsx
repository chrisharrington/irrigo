import { SecondaryButton } from '@/components/button';
import Spinner from '@/components/spinner';
import { AntDesign } from '@expo/vector-icons';
import { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models';
import { useTogglePlayedButton } from './hook';

export type TogglePlayedButtonProps = {
    /** Required. The movie or media item to toggle played status for. */
    item: BaseItemDto;

    /** Optional. Callback function called when the played status is successfully toggled. */
    onToggleComplete?: () => void;
};

export function TogglePlayedButton({ item, onToggleComplete }: TogglePlayedButtonProps) {
    const { isToggling, isPlayed, handleTogglePlayed } = useTogglePlayedButton({ item, onToggleComplete });

    return (
        <SecondaryButton onPress={handleTogglePlayed} isDisabled={isToggling}>
            {isToggling ? (
                <Spinner size='sm' />
            ) : (
                <AntDesign name={isPlayed ? 'checkcircleo' : 'checkcircle'} size={18} color='white' />
            )}
        </SecondaryButton>
    );
}
