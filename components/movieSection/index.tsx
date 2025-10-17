import { SectionProps } from '@/screens/home/section';
import { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models';
import { ItemSection } from '../itemSection';
import { useMovieSection } from './hook';

type MovieSectionProps = Omit<SectionProps, 'children'> & {
    /** Required. The list of movies to display. */
    movies: BaseItemDto[];

    /** Optional. A flag indicating that each item poster should display a progress indicator. Defaults to false. */
    withProgressIndicator?: boolean;

    /** Optional. A flag indicating that skeleton loaders should be shown instead of poster content. Defaults to false. */
    isBusy?: boolean;
};

export function MovieSection(props: MovieSectionProps) {
    const { navigateToMovieDetails } = useMovieSection();

    return <ItemSection {...props} items={props.movies} onItemSelected={navigateToMovieDetails} />;
}
