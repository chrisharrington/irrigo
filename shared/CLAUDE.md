## General Code Guidelines

-   Strict typing; prefer unknown over any; readonly/immutable state.
-   React: function components/hooks.
-   Dates as ISO-8601 UTC; align DTOs with server contracts.
-   Use spaces over tabs.
-   Use four spaces for a tab.
-   Make liberal use of useMemo and useCallback where appropriate for memoization.
-   Favour a higher number of small components instead of a single large component.
-   If a component is too large, split it up into separate components. Those separate components should exist within a sub folder following the file structure detailed above.
-   A component over 200 lines is too large and should be split up.
-   Boolean state variables should be defined as such: `[isBusy, setBusy] = useState<boolean>(false)`.
-   When defining state variables via `useState`, ensure they are typed correctly.
-   When creating code with consecutive variables, always use a single `const` with comma separated variable declarations like this:

    const first = 1,
      second = 2,
      third = 3;

-   When creating a component's hook inside hook.ts, ensure the hook name follows the pattern `use<ComponentName>`. The hook should take one parameter: the `props` provided to the component inside index.tsx.

## Testing

-   Tests are _behavior driven acceptance tests_.
-   Never mock first-party components unless specifically asked to do so.
-   Never add test IDs or retrieve elements by test IDs.
-   Always retrieve elements by text, display text, placeholder text, etc. to approximate how a user would find items.
-   Use `@testing-library/react`, `@testing-library/react-native`, `@testing-library/jest-native`, `jest-expo`, and `expo-router/testing-library`.
-   Build tests which emulate a user's behavior, like clicking or tapping on a button or entering text into an input field.
-   Always verify expectations by examining changes in the user interface.
-   Never by examining the internal state of a component.
-   Always run tests after making changes as the final step.
-   Always name test files `test.tsx` or `test.ts`.
-   Always lace test files alongside the component they test (e.g., `ComponentName/test.tsx`)

## Comments

-   Use proper punctuation, including periods at the end.
-   When asked to write inline comments for a props type, ensure that:
    -   Comments are prefixed with "Required." or "Optional." based on whether the prop in question is required or optional.
    -   A prop is only "Optional" if it has the `?` modifier (e.g., `optionalProp?: string`) or has a default value. Props with union types including `undefined` (e.g., `prop: string | undefined`) are still "Required" - the caller must explicitly pass a value, even if that value is `undefined`.
    -   Use /\*\* \*/ comment style.
    -   Each prop and its comment should be grouped together. Each group should be separated by a newline.
-   For inline comments within functions:
    -   Group logical code pieces together and provide one inline comment per group.
    -   Separate groups by newlines.
    -   Use // comment style.
    -   Keep comments concise and to the point.
    -   Use proper punctuation, including periods at the end.
-   For function header comments:
    -   Use /\*\* \*/.
    -   Give a general summary.
    -   Provide documentation for parameters and return values.
    -   **IMPORTANT**: Do not include TypeScript type annotations in JSDoc comments (e.g., `{string}`, `{boolean}`) when the function already has TypeScript type signatures. This prevents TypeScript warning ts(80004) and avoids redundant type information.
    -   Use `@param paramName - Description` instead of `@param {Type} paramName - Description`.
    -   Use `@returns Description` instead of `@returns {Type} Description`.
    -   Never provide example usage.
-   When updating code, ensure that all related comments and documentation are also updated.

## File Structure

Components should be organized into separate files for maintainability and clarity. Always follow this structure when creating or updating a component.

### Required Files:

-   **index.tsx**: Contains the main component TSX and JSDoc documentation.
-   **hook.ts**: Contains any logic including additional hooks, variable declarations, etc. The name of the hook should be derived from the folder in which hook.ts resides and follow the pattern `use<ComponentName>`.
-   **test.tsx**: Contains all test pertaining the component rendered within the adjacent `index.tsx`.

Here's an example of an `index.tsx` and accompanying `hook.ts`:

#### index.tsx Pattern:

```typescript
import { PropsWithChildren } from 'react';
import { useBalloonPopper } from './hook';

/**
 * Props interface for the BalloonPopper component.
 */
export type BalloonPopperProps = {
    /** Required. Description of required prop. */
    requiredProp: string;

    /** Optional. Description of optional prop. */
    optionalProp?: boolean;
} & PropsWithChildren;

/**
 * Component description and features.
 */
export function BalloonPopper(props: BalloonPopperProps) {
    const { isBusy } = useBalloonPopper(props);

    return <div>Component JSX</div>;
}
```

#### hook.ts Pattern:

```typescript
import { BalloonPopperProps } from './models';

/**
 * Custom hook for the BalloonPopper component.
 */
export function useBalloonPopper(props: BalloonPopperProps) {
    const [isBusy, setBusy] = useState<boolean>(false);

    return { isBusy };
}
```

## Style

-   Always use either Tailwind for components targeting web. Always use Nativewind for components targeting native. If you're unsure which to use, ask.
-   Always reference `tailwind.config.js` for custom colours.
-   When creating styles for components, always use custom brand colours from `tailwind.config.js` over default Tailwind colours.
-   Always use the `tailwind-variants` library for variable styles.

### Organizing Tailwind Classes

When working with files that contain long strings of Tailwind CSS classes (whether in `tailwind-variants` or regular className strings), organize them into logical groups for better readability and maintainability:

-   **Split long class strings into arrays** with comments describing each group's purpose.
-   **Group related CSS properties together** using this logical order:
    1. **Layout & Structure** - `flex`, `grid`, `block`, `inline`, `absolute`, `relative`, `gap`, `space-*`, etc.
    2. **Positioning** - `top`, `left`, `right`, `bottom`, `z-*`, etc.
    3. **Sizing** - `w-*`, `h-*`, `min-*`, `max-*`, `flex-shrink`, `flex-grow`, etc.
    4. **Spacing** - `p-*`, `m-*`, `px-*`, `py-*`, etc.
    5. **Typography** - `text-*`, `font-*`, `leading-*`, `tracking-*`, etc.
    6. **Appearance** - `bg-*`, `border-*`, `rounded-*`, `shadow-*`, etc.
    7. **Behavior & Animation** - `transition`, `transform`, `hover:*`, `focus:*`, `cursor-*`, etc.
    8. **Custom Properties** - CSS custom properties using `[--property:value]` syntax
-   **Add descriptive comments** for each group to explain the styling purpose.
-   **Apply this consistently** whether using `tailwind-variants`, or regular `className` attributes.

Example of well-organized Tailwind classes:

```typescript
// Bad - long, unorganized string
base: 'flex gap-3 group font-sans text-sm tracking-[0.5px] transition fit-content max-w-fit normal-case font-normal';

// Good - organized into logical groups
base: [
    // Layout & Structure
    'flex gap-3 group',

    // Typography
    'font-sans text-sm tracking-[0.5px] normal-case font-normal',

    // Behavior & Animation
    'transition',

    // Sizing
    'fit-content max-w-fit',
];
```
