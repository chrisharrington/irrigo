import { fireEvent, render, screen } from '@testing-library/react-native';

import { ErrorView } from '.';

const BASE_PROPS = {
    eyebrow: 'Connection lost',
    title: 'Controller unreachable',
    sub: 'No response from Home Assistant since 14:02. Planner paused, no zone can fire.',
    onRetry: () => {},
    state: 'idle' as const,
};

describe('ErrorView', () => {
    it('renders the eyebrow, title, and sub-line strings supplied via props.', () => {
        render(<ErrorView {...BASE_PROPS} />);

        expect(screen.getByText('Connection lost')).toBeOnTheScreen();
        expect(screen.getByText('Controller unreachable')).toBeOnTheScreen();
        expect(
            screen.getByText('No response from Home Assistant since 14:02. Planner paused, no zone can fire.'),
        ).toBeOnTheScreen();
    });

    it('renders the Irrigo wordmark in the brand row.', () => {
        render(<ErrorView {...BASE_PROPS} />);

        expect(screen.getByText('Irrigo')).toBeOnTheScreen();
    });

    it('renders every stack-trace line when an array is supplied.', () => {
        const stack = [
            'Error: connect ECONNREFUSED 192.168.1.42:8123',
            '    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1611:16)',
            '    at HAClient.connect (planner/ha.js:142:23)',
        ];

        render(<ErrorView {...BASE_PROPS} stack={stack} />);

        for (const line of stack) {
            expect(screen.getByText(line)).toBeOnTheScreen();
        }
    });

    it('omits the stack-trace block when no stack is supplied.', () => {
        render(<ErrorView {...BASE_PROPS} />);

        expect(screen.queryByText(/ECONNREFUSED/)).toBeNull();
    });

    it('omits the stack-trace block when an empty array is supplied.', () => {
        render(<ErrorView {...BASE_PROPS} stack={[]} />);

        expect(screen.queryByText(/ECONNREFUSED/)).toBeNull();
    });

    it('shows the "Retry connection" button label when idle.', () => {
        render(<ErrorView {...BASE_PROPS} state='idle' />);

        expect(screen.getByText('Retry connection')).toBeOnTheScreen();
        expect(screen.queryByText('Cancel attempt')).toBeNull();
    });

    it('shows the "Cancel attempt" button label when retrying.', () => {
        render(<ErrorView {...BASE_PROPS} state='retrying' />);

        expect(screen.getByText('Cancel attempt')).toBeOnTheScreen();
        expect(screen.queryByText('Retry connection')).toBeNull();
    });

    it('renders the "Contacting…" status line only when retrying.', () => {
        const idle = render(<ErrorView {...BASE_PROPS} state='idle' />);
        expect(screen.queryByText('Contacting…')).toBeNull();
        idle.unmount();

        render(<ErrorView {...BASE_PROPS} state='retrying' />);
        expect(screen.getByText('Contacting…')).toBeOnTheScreen();
    });

    it('calls onRetry once when the primary button is pressed while idle.', () => {
        const onRetry = jest.fn();

        render(<ErrorView {...BASE_PROPS} state='idle' onRetry={onRetry} />);
        fireEvent.press(screen.getByText('Retry connection'));

        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('calls onRetry once when the primary button is pressed while retrying (acts as cancel).', () => {
        const onRetry = jest.fn();

        render(<ErrorView {...BASE_PROPS} state='retrying' onRetry={onRetry} />);
        fireEvent.press(screen.getByText('Cancel attempt'));

        expect(onRetry).toHaveBeenCalledTimes(1);
    });
});
