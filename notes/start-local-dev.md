# One-command local development

[`start-local-dev.py`](./start-local-dev.py) starts the local Gate 15 stack from
Windows:

- boots the `Ubuntu` WSL distro;
- starts WSL's `uniqus-firecracker-net.service` and
  `uniqus-orchestrator.service` systemd units;
- waits for the orchestrator health check on `http://localhost:8787`;
- starts only the `@gate15/web` workspace on Windows at
  `http://localhost:4242` (so a duplicate Windows orchestrator is not started);
- opens the web app and combines both servers' live logs in one terminal as
  `[web]` and `[orchestrator]` lines.

## Run it

From PowerShell in the repository:

```powershell
python notes\start-local-dev.py
```

Press `Ctrl+C` to stop the web server and log follower. WSL is left running by
default so other WSL work is not interrupted.

Useful options:

```powershell
# Check/start the WSL backend and report readiness without starting Next.js
python notes\start-local-dev.py --check

# Do not open a browser
python notes\start-local-dev.py --no-browser

# Restart the WSL orchestrator before attaching its logs
python notes\start-local-dev.py --restart-orchestrator

# Replace an existing :4242 process so this launcher owns it and can show its logs
python notes\start-local-dev.py --restart-web

# Stop the Ubuntu WSL instance as part of Ctrl+C cleanup
python notes\start-local-dev.py --terminate-wsl-on-exit

# Use a differently named distro
python notes\start-local-dev.py --distro Ubuntu-24.04
```

If port `4242` was already in use, the launcher leaves that process alone and
cannot recover its existing stdout. It still shows orchestrator logs. Use
`--restart-web` when you explicitly want the launcher to stop that listener,
start a fresh Next.js process, and show both streams together.

## Requirements

- Windows Python 3.10 or newer (`python --version`)
- WSL with the chosen distro and systemd enabled
- the two existing WSL systemd services provisioned
- Windows Node/npm and a completed root `npm install`

The script uses only Python's standard library and resolves the repository root
relative to itself, so it can be invoked from any working directory.

The WSL orchestrator runs from the `WorkingDirectory` configured in the existing
`uniqus-orchestrator.service` unit. This launcher deliberately does not copy or
sync the Windows checkout into that directory.
