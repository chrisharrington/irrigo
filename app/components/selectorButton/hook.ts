import { LabelValue } from '@/models';
import { useState } from 'react';

export function useSelectorButton() {
    const [showModal, setShowModal] = useState(false);

    return {
        getSelectedLabel,
        showModal,
        setShowModal,
    };

    /**
     * Retrieves the label corresponding to a selected value from an array of options.
     *
     * @param options - An array of objects containing label-value pairs
     * @param selectedValue - The currently selected value to find a matching label for
     * @param defaultLabel - The default label to return if no matching option is found
     * @returns The label of the matching option or the default label if no match is found
     */
    function getSelectedLabel(options: Array<LabelValue>, selectedValue: string | number | null, defaultLabel: string) {
        return options.find(option => option.value === selectedValue)?.label || defaultLabel;
    }
}
