import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

let mockTopInset = 0;
jest.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: mockTopInset, bottom: 0, left: 0, right: 0 }),
}));

import { StatusBarBackdrop } from './status-bar-backdrop';

describe('StatusBarBackdrop', () => {
    afterEach(() => {
        mockTopInset = 0;
    });

    it('renders nothing when the top inset is zero (web / desktop).', () => {
        mockTopInset = 0;

        render(<StatusBarBackdrop />);

        expect(screen.queryByLabelText('Status bar backdrop')).toBeNull();
    });

    it('renders an opaque painter with the canvas color and the inset height when the top inset is positive.', () => {
        mockTopInset = 42;

        render(<StatusBarBackdrop />);

        const painter = screen.getByLabelText('Status bar backdrop');
        const style = StyleSheet.flatten(painter.props.style) as {
            backgroundColor?: string;
            height?: number;
            position?: string;
        };
        expect(style.backgroundColor).toBe('#06090A');
        expect(style.height).toBe(42);
        expect(style.position).toBe('absolute');
    });

    it('honors a custom backdrop color.', () => {
        mockTopInset = 32;

        render(<StatusBarBackdrop color='#123456' />);

        const painter = screen.getByLabelText('Status bar backdrop');
        const style = StyleSheet.flatten(painter.props.style) as { backgroundColor?: string };
        expect(style.backgroundColor).toBe('#123456');
    });
});
