# Install the Luuna command line tools on Windows

The three component packages are private and are not published to npm. Install them from their sibling checkouts
with the pinned Bun runtime:

```powershell
.\scripts\install-cli.ps1
```

The script installs locked dependencies with package lifecycle scripts disabled, then creates launchers under
`%LOCALAPPDATA%\Luuna\bin` and adds that directory to the current user's `PATH`. Open a new terminal after the
script finishes.

| Command | Runs |
| --- | --- |
| `luuna` or `lu` | Luuna terminal workbench |
| `luuna atlas ...` or `lat ...` | Atlas expertise and project memory CLI |
| `luuna beacon ...` or `lbc ...` | Beacon prompt and instruction CLI |
| `luuna missions ...` or `lms ...` | Missions tickets and work plans CLI |
| `luuna-atlas`, `luuna-beacon`, `luuna-missions` | Standalone component CLIs |

The component commands work from the current project directory and do not start the Luuna runtime. `luuna` still
opens the workbench for its other commands. A project that uses Luuna's integrated workflows must also have its
component workspace enabled; the installed standalone commands do not bypass runtime approval or scope policy.

The installer expects `luuna`, `luuna-atlas`, `luuna-beacon`, and `luuna-missions` checkouts under the same parent
directory and Bun 1.4.3. It does not publish packages, change Git configuration, or install global npm packages.
