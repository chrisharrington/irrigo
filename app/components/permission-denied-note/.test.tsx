import { fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';

import { PermissionDeniedNote } from '.';

describe('PermissionDeniedNote', () => {
    let openSettingsSpy: ReturnType<typeof jest.spyOn>;
    let warnSpy: ReturnType<typeof jest.spyOn>;

    beforeEach(() => {
        openSettingsSpy = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
        warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        openSettingsSpy.mockRestore();
        warnSpy.mockRestore();
    });

    it('renders nothing when not visible.', () => {
        render(<PermissionDeniedNote visible={false} />);

        expect(screen.queryByText(/Enable notifications/)).toBeNull();
    });

    it('renders the body and the action button when visible.', () => {
        render(<PermissionDeniedNote visible />);

        expect(
            screen.getByText(`Enable notifications to get alerts when you're not in the app.`),
        ).toBeOnTheScreen();
        expect(screen.getByText('Enable notifications')).toBeOnTheScreen();
    });

    it('opens the OS settings when the action button is pressed.', () => {
        render(<PermissionDeniedNote visible />);

        fireEvent.press(screen.getByText('Enable notifications'));

        expect(openSettingsSpy).toHaveBeenCalledTimes(1);
    });

    it('logs a warning if `openSettings` rejects but does not throw.', async () => {
        openSettingsSpy.mockRejectedValueOnce(new Error('cannot open'));
        render(<PermissionDeniedNote visible />);

        fireEvent.press(screen.getByText('Enable notifications'));

        // Wait a microtask for the rejected promise to settle.
        await Promise.resolve();
        await Promise.resolve();

        expect(warnSpy).toHaveBeenCalled();
    });

    it('exposes the container via its accessibility label.', () => {
        render(<PermissionDeniedNote visible />);

        expect(screen.getByLabelText('Notifications disabled')).toBeOnTheScreen();
    });
});
