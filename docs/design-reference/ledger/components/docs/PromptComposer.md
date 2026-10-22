PromptComposer is the Ask AI input: text, dictation, a live counter and Ask.

Consumer provides `onSubmit(text)`, optional `placeholder`, `rows`, `maxLength` (6,000), `onDictate` (shows the mic), `dictating`, `dictationDisabled`, `busy` + `onStop`, `submitLabel`, `tools` (extra IconButtons).

- Enter-to-send is the consumer's choice; the visible button is always there.
- Past the limit the border and counter turn danger and Ask disables; nothing is trimmed.
- Hide the mic where `osDictation` is false and the browser has no microphone action.
