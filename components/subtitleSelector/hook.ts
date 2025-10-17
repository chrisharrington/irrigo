import { LabelValue } from '@/models';
import { useMemo } from 'react';
import { SubtitleSelectorProps } from '.';

/**
 * Custom hook for managing subtitle selector state and interactions.
 * Provides subtitle options and handles selection logic.
 *
 * @param {SubtitleSelectorProps} props - Hook configuration props
 * @param {boolean} props.isVisible - Whether the selector is visible
 * @param {string | null} props.selectedValue - Currently selected subtitle option
 * @param {(value: string | null) => void} props.onSelectValue - Callback when a value is selected
 * @param {() => void} props.onClose - Callback when selector should close
 *
 * @returns {Object} Object containing:
 * - subtitleOptions: Available subtitle options (All, Translate)
 * - handleSelectValue: Handler for subtitle option selection
 */
export function useSubtitleSelector({ onSelectValue, onClose }: SubtitleSelectorProps) {
    // Define the available subtitle options.
    const subtitleOptions: LabelValue[] = useMemo(
        () => [
            { value: null, label: 'None' },
            { value: 'all', label: 'All' },
            { value: 'translate', label: 'Translate' },
        ],
        []
    );

    return {
        subtitleOptions,
        handleSelectValue,
    };

    /**
     * Handles subtitle option selection.
     * Updates the selected value and closes the selector.
     */
    function handleSelectValue(value: string | null) {
        onSelectValue(value);
        onClose();
    }
}
