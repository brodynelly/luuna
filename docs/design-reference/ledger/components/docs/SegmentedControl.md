SegmentedControl switches between 2–5 mutually exclusive modes or values.

Consumer provides `items` (`[{value, label, icon}]`), `defaultValue` or `value` + `onChange`, and `label` for screen readers.

- Use for view modes (list / grid), theme (System / Light / Dark) and stepped values such as zoom (75% … 150%).
- Selected segment lifts onto `surface-overlay`; the track is `fill`.
