import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

import { Tooltip } from '.';

jest.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, bottom: 34, left: 0, right: 0 }),
}));

describe('Tooltip', () => {
    it('renders the label beside an accessible help trigger, with the sheet closed.', () => {
        render(
            <Tooltip
                label='Root depth override'
                title='Root depth override'
                body='The depth of the wetted root zone the planner refills.'
            />,
        );

        expect(screen.getByText('Root depth override')).toBeOnTheScreen();
        expect(screen.getByLabelText('What is Root depth override?')).toBeOnTheScreen();
        // The sheet body is hidden until the trigger is tapped.
        expect(screen.queryByText('The depth of the wetted root zone the planner refills.')).toBeNull();
    });

    it('opens the sheet with the title and body when the trigger is tapped.', () => {
        render(
            <Tooltip
                label='Depletion fraction'
                title='Allowable depletion'
                body='How dry the soil is allowed to get before the next watering.'
            />,
        );

        fireEvent.press(screen.getByLabelText('What is Depletion fraction?'));

        expect(screen.getByText('Allowable depletion')).toBeOnTheScreen();
        expect(
            screen.getByText('How dry the soil is allowed to get before the next watering.'),
        ).toBeOnTheScreen();
    });

    it('renders each paragraph when the body is an array of strings.', () => {
        render(
            <Tooltip
                label='Root depth override'
                title='Root depth override'
                body={['First paragraph about roots.', 'Second paragraph about depth.']}
            />,
        );

        fireEvent.press(screen.getByLabelText('What is Root depth override?'));

        expect(screen.getByText('First paragraph about roots.')).toBeOnTheScreen();
        expect(screen.getByText('Second paragraph about depth.')).toBeOnTheScreen();
    });

    it('renders a custom node body as supplied.', () => {
        render(
            <Tooltip
                label='Root depth override'
                title='Root depth override'
                body={<Text>Custom node body.</Text>}
            />,
        );

        fireEvent.press(screen.getByLabelText('What is Root depth override?'));

        expect(screen.getByText('Custom node body.')).toBeOnTheScreen();
    });

    it('closes the sheet when the backdrop is tapped.', async () => {
        const { root } = render(
            <Tooltip
                label='Depletion fraction'
                title='Allowable depletion'
                body='How dry the soil is allowed to get.'
            />,
        );

        fireEvent.press(screen.getByLabelText('What is Depletion fraction?'));
        expect(screen.getByText('Allowable depletion')).toBeOnTheScreen();

        // The backdrop Pressable is hidden from a11y queries by the sheet's
        // `accessibilityViewIsModal`, so reach it via host-tree lookup.
        const backdrop = root.find(
            node =>
                typeof node.type === 'string' &&
                node.props.accessibilityLabel === 'Dismiss modal',
        );
        fireEvent.press(backdrop);

        // The sheet plays a slide-down + fade before it unmounts; allow ample
        // time so the assertion isn't flaky when the suite runs under load.
        await waitFor(() => expect(screen.queryByText('Allowable depletion')).toBeNull(), { timeout: 5000 });
    });
});
