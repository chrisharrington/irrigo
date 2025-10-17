import { Selector } from '@/components/selector';
import React from 'react';
import { useSubtitleSelector } from './hook';

export type SubtitleSelectorProps = {
    /** Required. Controls the visibility of the subtitle selector modal. */
    isVisible: boolean;

    /** Required. Callback function invoked when the selector should be closed. */
    onClose: () => void;

    /** Required. The currently selected subtitle value, or null if no selection. */
    selectedValue: string | null;

    /** Required. Callback function invoked when a new subtitle value is selected. */
    onSelectValue: (value: string | null) => void;
};

export function SubtitleSelector(props: SubtitleSelectorProps) {
    const { subtitleOptions, handleSelectValue } = useSubtitleSelector(props);

    return (
        <Selector
            visible={props.isVisible}
            onClose={props.onClose}
            title='Subtitle Options'
            icon='subtitles'
            options={subtitleOptions}
            selectedValue={props.selectedValue}
            onSelectValue={handleSelectValue}
        />
    );
}
