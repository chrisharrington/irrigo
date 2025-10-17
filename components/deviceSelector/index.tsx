import { Selector } from '@/components/selector';
import { useCast } from '@/contexts/cast';

export type DeviceSelector = {
    /** Required. Controls the visibility of the device selector. */
    isVisible: boolean;

    /** Required. The ID of the currently selected device. */
    selectedDeviceId: string;

    /** Required. Callback function triggered when the selector is closed. */
    onClose: () => void;

    /** Required. Callback function triggered when a device is selected. Passes the device ID or null if deselected. */
    onDeviceSelect: (deviceId: string | null) => void;
};

export function DeviceSelector({ isVisible, selectedDeviceId, onClose, onDeviceSelect }: DeviceSelector) {
    const { devices } = useCast();

    return (
        <Selector
            visible={isVisible}
            onClose={onClose}
            options={devices}
            selectedValue={selectedDeviceId}
            onSelectValue={onDeviceSelect}
            title='Device'
            icon='cast'
        />
    );
}
