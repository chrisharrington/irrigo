import { Colours } from '@/constants/colours';
import { Section } from '@/screens/home/section';
import { AntDesign } from '@expo/vector-icons';
import { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models';
import { FlatList, Text, TouchableOpacity, View } from 'react-native';
import Poster from '../poster';
import style from './style';

export type ItemSectionProps = {
    /** Required. The label for the item list. */
    label: string;

    /** Required. The list of items to display. */
    items: BaseItemDto[];

    /** Required. The action to perform when an item is selected. */
    onItemSelected: (item: BaseItemDto) => Promise<void> | void;

    /** Optional. A flag indicating that each item poster should display a progress indicator. Defaults to false. */
    withProgressIndicator?: boolean;

    /** Optional. Function to retrieve the poster URL for an item. If not provided, the primary image for the given item is used. */
    getPosterUrl?: (item: BaseItemDto) => string;

    /** Optional. Function to retrieve the caption text for an item poster. If not provided, the item's name is used. */
    getPosterCaption?: (item: BaseItemDto) => string;

    /** Optional. Function to retrieve the sub-caption text for an item poster. If not provided, the item's production year is shown. */
    getPosterSubCaption?: (item: BaseItemDto) => string;
};

export function ItemSection(props: ItemSectionProps) {
    return (
        <Section {...props}>
            <FlatList
                data={props.items}
                keyExtractor={item => item.Id as string}
                horizontal
                showsHorizontalScrollIndicator={false}
                renderItem={({ item, index }) => (
                    <TouchableOpacity
                        activeOpacity={0.7}
                        style={[style.item, { marginRight: index === props.items.length - 1 ? 0 : 18 }]}
                        onPress={() => props.onItemSelected(item)}
                    >
                        <View style={style.posterContainer}>
                            <Poster
                                url={
                                    props.getPosterUrl
                                        ? props.getPosterUrl(item)
                                        : `${process.env.EXPO_PUBLIC_JELLYFIN_URL}/Items/${item.Id}/Images/Primary?api_key=${process.env.EXPO_PUBLIC_JELLYFIN_API_KEY}`
                                }
                            />

                            {props.withProgressIndicator && (
                                <View style={style.itemProgressContainer}>
                                    <View
                                        style={[
                                            style.itemProgress,
                                            { width: `${item.UserData?.PlayedPercentage || 0}%` },
                                        ]}
                                    />
                                </View>
                            )}

                            {item.UserData?.Played && (
                                <AntDesign
                                    style={style.playedIndicator}
                                    name='checkcircle'
                                    size={18}
                                    color={Colours.primary}
                                />
                            )}
                        </View>

                        <Text numberOfLines={1} style={style.title}>
                            {props.getPosterCaption ? props.getPosterCaption(item) : item.Name}
                        </Text>

                        <Text style={style.year}>
                            {props.getPosterSubCaption ? props.getPosterSubCaption(item) : item.ProductionYear}
                        </Text>
                    </TouchableOpacity>
                )}
            />
        </Section>
    );
}
