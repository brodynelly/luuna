Skeleton holds the shape of content while it loads.

Consumer provides `lines`, `width`, `height`, or `circle` + `size`.

- Mirror the real layout (avatar + two lines for a list row). Show only after ~300 ms to avoid flashes.
- Respects reduced motion (the pulse stops).
