import { PersonKind } from '@jellyfin/sdk/lib/generated-client/models';
import { useMemo } from 'react';
import { CastListProps } from '.';

export function useCastList(props: CastListProps) {
    return {
        actors: useMemo(
            () =>
                props.item?.People?.filter(person => person.Type === PersonKind.Actor && person.PrimaryImageTag) || [],
            [props.item]
        ),
    };
}
