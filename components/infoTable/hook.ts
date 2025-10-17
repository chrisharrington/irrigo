import { MediaStreamType, PersonKind } from '@jellyfin/sdk/lib/generated-client/models';
import { useMemo } from 'react';
import { InfoTableProps } from '.';

export function useInfoTable({ item }: InfoTableProps) {
    return {
        genres: useMemo(() => item.Genres?.join(', '), [item.Genres]),
        director: useMemo(
            () => item.People?.find(person => person.Type === PersonKind.Director)?.Name || '-',
            [item.People]
        ),
        writers: useMemo(
            () =>
                item.People?.filter(person => person.Type === PersonKind.Writer)
                    .slice(0, 15)
                    .map(person => person.Name)
                    ?.join(', ') || '-',
            [item.People]
        ),
        video: useMemo(
            () => item.MediaStreams?.find(stream => stream.Type === MediaStreamType.Video)?.DisplayTitle || '-',
            [item.MediaStreams]
        ),
        audio: useMemo(() => {
            const displayTitle = item.MediaStreams?.find(stream => stream.Type === MediaStreamType.Audio)?.DisplayTitle;
            if (!displayTitle || displayTitle === '-') return '-';
            const parts = displayTitle.split(' - ');
            return parts.length > 1 ? parts.slice(1).join(' - ') : displayTitle;
        }, [item.MediaStreams]),
    };
}
