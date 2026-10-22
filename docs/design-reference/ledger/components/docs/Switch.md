Switch turns a setting on or off immediately.

Consumer provides `label`, optional `description`, `checked` / `defaultChecked`, `disabled`, `onChange`. Without a visible label pass `ariaLabel`.

- The change takes effect at once; show the result (or an Alert on failure) without a Save button.
- Off track is `border-strong` so it reads at 3:1; on is `accent`. The knob stays white in both themes.
- Disable (not hide) a switch the platform can't support, and say why in the description.
