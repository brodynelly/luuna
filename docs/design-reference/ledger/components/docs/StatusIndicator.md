StatusIndicator shows the live state of a connection or job with a dot and a label.

Consumer provides `status` (`connected`, `connecting`, `offline`, `error`, `idle`), `label`, optional `detail`.

- Always a label next to the dot; colour is never the only signal.
- Use for NAS connection, pairing and background jobs. `connecting` swaps the dot for a Spinner.
