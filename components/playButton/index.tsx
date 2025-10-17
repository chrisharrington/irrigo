import { AntDesign, FontAwesome } from '@expo/vector-icons';
import { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models';
import { View } from 'react-native';
import { ButtonProps, PrimaryButton } from '../button';
import { usePlayButton } from './hook';
import style from './style';

export type PlayButtonProps = Omit<ButtonProps, 'onPress'> & {
    /** Required. The item to play or resume on press. */
    item: BaseItemDto;
};

export function PlayButton(props: PlayButtonProps) {
    const { isResumable, onPress } = usePlayButton(props);
    return (
        <PrimaryButton {...props} onPress={onPress}>
            <View style={style.container}>
                <FontAwesome name='play' size={22} color='white' />
                {isResumable && <AntDesign name='clockcircle' size={12} color='black' style={style.clock} />}
            </View>
        </PrimaryButton>
    );
}
