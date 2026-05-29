import { fireEvent, render, screen } from '@testing-library/react-native';

const mockRouterPush = jest.fn();

jest.mock('expo-router', () => ({
    useRouter: () => ({ push: mockRouterPush }),
}));

import { EmptyState } from '.';

describe('EmptyState', () => {
    beforeEach(() => {
        mockRouterPush.mockReset();
    });

    it('renders the healthy-planner heading and sub copy.', () => {
        render(<EmptyState />);

        expect(screen.getByText('No active alerts')).toBeOnTheScreen();
        expect(
            screen.getByText('Planner is healthy. The last 30 days of activity is in the log.'),
        ).toBeOnTheScreen();
    });

    it('routes to the activity log when "Open activity log" is pressed.', () => {
        render(<EmptyState />);

        fireEvent.press(screen.getByLabelText('Open activity log'));

        expect(mockRouterPush).toHaveBeenCalledWith('/activity');
    });
});
