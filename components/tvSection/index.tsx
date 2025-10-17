import { SectionProps } from '@/screens/home/section';
import { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models';
import { ItemSection } from '../itemSection';
import { useTvSection } from './hook';

type TvSectionProps = Omit<SectionProps, 'children'> & {
    /** Required. The list of TV episodes to display. */
    episodes: BaseItemDto[];

    /** Optional. A flag indicating that each item poster should display a progress indicator. Defaults to false. */
    withProgressIndicator?: boolean;

    /** Optional. A flag indicating that skeleton loaders should be shown instead of poster content. Defaults to false. */
    isBusy?: boolean;
};

export function TvSection(props: TvSectionProps) {
    const { navigateToTvShowDetails } = useTvSection();

    return <ItemSection {...props} items={props.episodes} onItemSelected={navigateToTvShowDetails} />;
}
