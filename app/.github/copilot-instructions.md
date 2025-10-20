# Copilot Instructions for Client Side Code

Included below are guidelines and instructions for Copilot agents.

## Testing

-   Tests are _behavior driven acceptance tests_.
-   Never mock first-party libraries unless specifically asked to do so.
-   Never examine internal state to during the verification stage of a test.
-   Use `@testing-library/react`.
-   Build tests which emulate a user's behavior, like clicking on a button or entering text into an input field.
-   In a similar vein, tests should verify expectations by examining changes in the user interface and _never_ by examining the internal state of a component.
-   Always run tests using the built-in test execution. Never ask me to run bunx, npx, or other command line tools for test runs. You don't need to ask me permission to run tests.
-   Always use `jest.mock` to mock dependencies.
-   Always use one `describe` block per file. The text for the describe block should be the name of the component or hook being tested.
-   Always use one `it` block per behavior.
-   Always use `beforeEach` to reset mocks and clear state.

Here's an example of a well written test file:

```
import { HubChannel } from '@business/CommonSets/HubChannel';
import * as Common from '@shared/Common';
import { APP_VERSION_STORAGE_KEY } from '@shared/Constants';
import Hub from '@shared/Hubs/Hub';
import { renderWithUser } from '@shared/Mocks/RenderWithUser';
import * as Storage from '@shared/Storage';
import { getById } from '@shared/Test/Helpers/react-testing-library-helpers';
import { waitFor } from '@testing-library/react';
import { AppUpdatePrompt } from '.';

jest.mock('react-router-dom-v5-compat', async () => ({
    ...jest.requireActual('react-router-dom-v5-compat'),
    useBeforeUnload: jest.fn(),
}));

const promptId = 'app-update-prompt';

describe('AppUpdatePrompt', () => {
    const connectionMock = jest.spyOn(Hub, 'on'),
        getLocalDataMock = jest.spyOn(Storage, 'getLocalData'),
        saveLocalDataMock = jest.spyOn(Storage, 'saveLocalData'),
        refreshMock = jest.spyOn(Common, 'refresh').mockImplementation(() => {});

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('does not prompt app update on fresh page load', async () => {
        // Render component with an app setting from the mocked web socket connection.
        const appVersion = '12345';
        await setup(appVersion);

        // Expect local storage to be updated with the app version.
        expect(saveLocalDataMock).toHaveBeenCalledWith(APP_VERSION_STORAGE_KEY, appVersion);

        // Expect the prompt to be hidden.
        const promptElement = getById<HTMLDivElement>(promptId);
        expect(promptElement.className.includes('opacity-0')).toBe(true);
    });

    it('prompts app update if locally stored version is out of date', async () => {
        // Render component with an app setting from the mocked web socket connection.
        const appVersion = '12345';
        const localStoredVersion = '54321';
        const { user, getByText } = await setup(appVersion, localStoredVersion);

        // Expect the prompt to be visible.
        const promptElement = getById<HTMLDivElement>(promptId);
        expect(promptElement.className.includes('opacity-100')).toBe(true);

        // Verify the prompt message.
        getByText('Site Update Available');
        getByText('A new version of the web site is available.');
        getByText('(The page will be reloaded)');

        // Click the update button.
        await user.click(getByText('Update Now'));

        await waitFor(() => {
            // Expect local storage to be cleared.
            expect(saveLocalDataMock).toHaveBeenCalledWith(APP_VERSION_STORAGE_KEY, null);

            // Expect the page to refresh.
            expect(refreshMock).toHaveBeenCalled();
        });
    });

    async function setup(appVersion: string = '', localStoredVersion: string | null = null) {
        connectionMock.mockImplementation(async (_: HubChannel, callback: (appVersion: string) => void) => {
            callback(appVersion);
        });

        getLocalDataMock.mockReturnValue(localStoredVersion);

        const result = renderWithUser(<AppUpdatePrompt />);

        await waitFor(() => {
            expect(getLocalDataMock).toHaveBeenCalled();
            expect(connectionMock).toHaveBeenCalled();
        });

        return result;
    }
});
```

## Comments

-   Use proper punctuation, including periods at the end.
-   When asked to write inline comments for a props type (that is, a type ending with "Props"), ensure the following. Regular variables within a hook should not use these comment rules.
    -   Comments are prefixed with "Required." or "Optional." based on whether the prop in question is required or optional.
    -   Use /\*\* \*/ comment style on a single line.
    -   Each prop and its comment should be grouped together. Each group should be separated by a newline.
-   For inline comments:
    -   Group logical code pieces together and provide one inline comment per group.
    -   Separate groups by newlines.
    -   Use // comment style with proper punctuation. Always end with a period.
-   For function header comments:
    -   Use /\*\* \*/.
    -   Give a general summary.
    -   Provide documentation for parameters and return values.
-   When updating code, ensure that all related comments and documentation are also updated.

Here's an example of a well written hook comment:

```
/**
 * Custom hook for managing policy cancellation dialog state and interactions.
 * Handles form state, cancellation reasons, calculation types, and submission logic.
 *
 * @param {Object} props - Hook configuration props
 * @param {Date} props.defaultCancelDate - Default date to use for cancellation
 * @param {Date} props.policyEffectiveDate - Effective date of the policy
 * @param {boolean} props.isVisible - Whether the cancel dialog is visible
 * @param {() => void} props.onHide - Callback function when dialog is hidden
 * @param {(effectiveDate: Date, reasonId: string, calculation: EndorsementCalculationStrategy, comment: string) => void} props.onCancelPolicy - Callback function when policy is cancelled
 *
 * @returns {Object} Object containing:
 * - form: Form state and validation
 * - isBusy: Loading state indicator
 * - cancellationReasons: Available cancellation reasons
 * - calculationTypes: Available calculation strategies
 * - onEffectiveDateChanged: Handler for effective date changes
 * - onCalculationChanged: Handler for calculation type changes
 * - onReasonChanged: Handler for reason changes
 * - onCommentChanged: Handler for comment changes
 * - submit: Form submission handler
 * - abort: Dialog cancellation handler
 */
```

Here's an example of a function header comment:

```
/**
* Fetches available endorsement calculation types for the current policy.
* Returns an array of strategies that can be used for premium calculations.
*/
```

## File Structure and Code Generation

-   Use spaces over tabs.
-   Use four spaces for a tab.
-   Make liberal use of useMemo where appropriate for memoization.
-   Structure:
    -   index.tsx: Contains the main component TSX.
    -   hook.ts: Contains any logic including additional hooks, variable declarations, etc. The name of the hook should be derived from the folder in which hook.ts resides. Always use regular functions and never use `useCallback` in main function declarations. Returned values should come before all function declarations. Here's an example of a well defined hook:

```
/**
 * Custom hook for managing CustomSlider state and behavior.
 * Handles slider value changes, thumb position calculation, and event forwarding.
 *
 * @param props - The CustomSlider props containing slider configuration and event handlers
 * @returns Object containing thumb position and event handlers
 */
export function useCustomSlider(props: CustomSliderProps) {
    const { minimumValue = 0, maximumValue = 100, value = 0, onValueChange, onSlidingStart, onSlidingComplete } = props,
        [thumbPosition, setThumbPosition] = useState<number>(0);

    // Calculate current thumb position based on value.
    const currentThumbPosition = useMemo(() => {
        return calculateThumbPosition(value);
    }, [value, minimumValue, maximumValue]);

    // Update internal thumb position state when value changes.
    useEffect(() => {
        setThumbPosition(currentThumbPosition);
    }, [currentThumbPosition]);

    return {
        thumbPosition: currentThumbPosition,
        handleValueChange,
        handleSlidingStart,
        handleSlidingComplete,
    };

    /**
     * Calculate thumb position as percentage (0-100).
     * Normalizes the slider value to a percentage based on min/max range.
     */
    function calculateThumbPosition(sliderValue: number) {
        // Calculate the total range of the slider.
        const range = maximumValue - minimumValue;
        if (range === 0) return 0;

        // Normalize the value relative to the minimum.
        const normalizedValue = sliderValue - minimumValue;
        return (normalizedValue / range) * 100;
    }
}
```

    -   test.tsx: Contains tests for the component defined in index.tsx.

-   Favour a higher number of small components instead of a single large component.
-   If a component is too large, split it up into separate components. Those separate components should exist within a sub folder following the file structure detailed above.
-   A component over 200 lines is too large and should be split up.
-   Boolean state variables should be defined as such: `[isBusy, setBusy] = useState<boolean>(false)`.
-   When defining state variables via `useState`, ensure they are typed correctly.
-   Always use a single `const` with comma separated variable declarations. This looks like the following:

```
    const firstVar = value,
        secondVar = value,
        thirdVar = value;
```

-   Never do this:

```
    const firstVar = value;
    const secondVar = value;
    const thirdVar = value;
```

-   When creating a component inside an index.tsx file, declare and export a props file named similarly to the component: "BalloonPopper" should have "BalloonPopperProps".
-   When creating a component's hook inside hook.ts, ensure the hook name follows the pattern `use<ComponentName>`. The hook should take one parameter: the `props` provided to the component inside index.tsx. Do not generate an additional type for the props.
-   `console.log` and `console.error` outputs are ok while debugging a particularly problematic issue, but final code should contain no debugging statements.
-   If statements containing just one line of code should omit the curly braces and keep everything on one line.
-   Always use `type` instead of `interface`.

Here's an example of an appropriate folder structure for an example component:

```
- BalloonPopper
  - index.tsx (containing BalloonPopper TSX)
  - hook.ts (containing useBalloonPopper hook with all logic)
  - test.tsx (containing tests for BalloonPopper)
  - style.ts (containing style for the component defined in index.tsx)
```

Here's an example of a well defined hook:

```
export function useBalloonPopper(props: BalloonPopperProps) {
    const [isBusy, setBusy] = useState<boolean>(false),
        [isVisible, setVisible] = useState<boolean>(false),
        [name, setName] = useState<string | null>(null);

    return { isBusy, isVisible, name }
}
```

## Style

-   Styles should be created using StyleSheet.create and exported as the default export.
-   Within index.tsx, the stylesheet should be imported as `import style from './style';`.
-   Brand colours are defined within `constants/colours.ts`. Use those colours over default colours.
-   Utilize non-absolutely positioned layouts whenever possible.

Finally, when asked to clean up an existing file, apply the necessary changes to remove any unused code, comments, or imports, and ensure the file is well-organized and adheres to the project's coding standards as outlined above. Any uncommented functions should be commented.
