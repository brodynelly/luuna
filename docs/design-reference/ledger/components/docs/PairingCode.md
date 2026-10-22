PairingCode shows the device sign-in code, its expiry and the approval status.

Consumer provides `code`, `expiresIn` (seconds), `status` (`pending`, `approved`, `declined`; `expired` is automatic), `url`, and `onOpen`, `onCancel`, `onRestart`.

- Code in `mono` 36px, split in half with a dash so it can be read aloud.
- The countdown runs live; at zero the code is struck through and the primary action becomes "Start again".
- Copy matches the desktop app's messages exactly.
