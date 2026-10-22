AIResponse renders a streamed answer with Insert, Copy and Regenerate.

Consumer provides the text as `children`, optional `title`, `meta`, `streaming`, `error` (+ `onRetry`), `sourceApp`, `canInsert`, `onInsert`, `onCopy`, `onRegenerate`, `onStop`.

- A 2px `ai` hairline and sparkle mark AI content; the body itself stays neutral.
- While streaming: caret and Stop; actions appear when it ends.
- Insert is primary only when a selection can be replaced; otherwise it's disabled with a tooltip and Copy is the way out.
