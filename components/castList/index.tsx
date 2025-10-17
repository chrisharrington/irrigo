import { BaseItemDto, BaseItemPerson } from '@jellyfin/sdk/lib/generated-client/models';
import { PosterList } from '../posterList';
import { useCastList } from './hook';

export type CastListProps = {
    /** Required. The item for which to display cast information. */
    item: BaseItemDto;
};

export function CastList(props: CastListProps) {
    const { actors } = useCastList(props);

    return (
        <PosterList<BaseItemPerson>
            items={actors}
            itemSubtext={actor => actor.Name!}
            itemPosterUrl={actor => actor.Id!}
            keyExtractor={actor => actor.Id!}
        />
    );
}
