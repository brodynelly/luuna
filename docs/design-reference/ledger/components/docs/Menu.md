Menu lists the actions for an object or context, opened from a button.

Consumer provides `label` (trigger text), `items` (`[{label, icon, shortcut, tone, disabled, onSelect}]`, `{divider: true}`, `{heading}`), optional `triggerIcon`, `triggerVariant`, `open` (initial), `trigger={false}` (docs).

- Order: frequent first, destructive last after a divider, in `danger`.
- Shortcuts right-aligned as Kbd.
