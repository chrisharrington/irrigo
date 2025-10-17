import { SubHeader } from '@/subHeader';
import { PropsWithChildren } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import Poster from '../poster';
import { usePosterList } from './hook';
import style from './style';

export type PosterListProps<TListItem> = PropsWithChildren & {
    /** Optional. The title to display above the list. */
    title?: string;

    /** Required. The array of items to display in the list. */
    items: TListItem[];

    /** Required. Function to extract the subtext to display below each poster. */
    itemSubtext: (item: TListItem) => string;

    /** Required. Function to extract the poster image URL for each item. */
    itemPosterUrl: (item: TListItem) => string;

    /** Required. Function to extract a unique key for each item in the list. */
    keyExtractor: (item: TListItem) => string;

    /** Optional. Callback function triggered when a poster item is pressed. */
    onPressItem?: (item: TListItem) => void;
};

export function PosterList<TListItem>(props: PosterListProps<TListItem>) {
    const { getImageForId } = usePosterList();

    return (
        <View>
            {props.title && (
                <View style={{ marginBottom: 8 }}>
                    <SubHeader>{props.title}</SubHeader>
                </View>
            )}

            <FlatList
                data={props.items}
                keyExtractor={props.keyExtractor}
                horizontal
                showsHorizontalScrollIndicator={false}
                renderItem={({ item, index }) => (
                    <Pressable
                        style={[style.poster, { marginRight: index === props.items.length - 1 ? 0 : 18 }]}
                        onPress={() => props.onPressItem?.(item)}
                    >
                        <Poster url={getImageForId(props.itemPosterUrl(item))} />
                        <Text style={style.label}>{props.itemSubtext(item)}</Text>
                    </Pressable>
                )}
            />
        </View>
    );
}
