import { render, screen } from '@testing-library/react-native';

import { ThemedText } from './themed-text';

describe('ThemedText', () => {
    it('renders the text passed as children.', () => {
        render(<ThemedText>Hello, Irrigo.</ThemedText>);

        expect(screen.getByText('Hello, Irrigo.')).toBeOnTheScreen();
    });
});
