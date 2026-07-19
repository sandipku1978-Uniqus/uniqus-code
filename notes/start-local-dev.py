#!/usr/bin/env python3
"""Start the Gate 15 web app on Windows and its Firecracker backend in WSL.

The WSL side uses the already-provisioned systemd services. The Windows side
starts only the web workspace, avoiding a second orchestrator process on the
host. Logs from Next.js and the WSL orchestrator are streamed into this terminal
with labels so they can be read together.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import threading
import time
from typing import IO, Sequence
from urllib.error import URLError
from urllib.request import Request, urlopen
import webbrowser


REPO_ROOT = Path(__file__).resolve().parent.parent
WEB_PORT = 4242
API_PORT = 8787
NETWORK_SERVICE = "uniqus-firecracker-net.service"
ORCHESTRATOR_SERVICE = "uniqus-orchestrator.service"
PRINT_LOCK = threading.Lock()


class LauncherError(RuntimeError):
    """A startup error that should be shown without a Python traceback."""


def emit(label: str, message: str) -> None:
    """Print one atomic, labelled line even while both log readers are active."""
    message = message.rstrip("\r\n")
    with PRINT_LOCK:
        print(f"[{label}] {message}", flush=True)


def command_text(command: Sequence[str]) -> str:
    return subprocess.list2cmdline(list(command))


def wsl_command(distro: str, command: Sequence[str], *, root: bool = False) -> list[str]:
    args = ["wsl.exe", "--distribution", distro]
    if root:
        args.extend(["--user", "root"])
    args.append("--exec")
    args.extend(command)
    return args


def run_checked(command: Sequence[str], *, description: str) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        list(command),
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip()
        suffix = f"\n{detail}" if detail else ""
        raise LauncherError(f"{description} failed ({command_text(command)}).{suffix}")
    return result


def port_is_open(port: int) -> bool:
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.5):
            return True
    except OSError:
        return False


def api_is_healthy(port: int) -> bool:
    request = Request(f"http://127.0.0.1:{port}/health", headers={"User-Agent": "gate15-local-launcher"})
    try:
        with urlopen(request, timeout=1.5) as response:
            if response.status != 200:
                return False
            payload = json.loads(response.read().decode("utf-8"))
            return payload.get("ok") is True
    except (OSError, URLError, ValueError, json.JSONDecodeError):
        return False


def wait_until(predicate, *, timeout: float, process: subprocess.Popen[str] | None = None) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        if process is not None and process.poll() is not None:
            return False
        time.sleep(0.25)
    return predicate()


def stream_lines(stream: IO[str], label: str) -> None:
    try:
        for line in iter(stream.readline, ""):
            emit(label, line)
    except (OSError, ValueError):
        pass
    finally:
        try:
            stream.close()
        except OSError:
            pass


def start_log_reader(process: subprocess.Popen[str], label: str) -> threading.Thread:
    if process.stdout is None:
        raise LauncherError(f"Cannot read {label} logs: child stdout was not captured.")
    thread = threading.Thread(target=stream_lines, args=(process.stdout, label), daemon=True)
    thread.start()
    return thread


def child_creation_flags() -> int:
    return getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)


def start_orchestrator_logs(distro: str) -> subprocess.Popen[str]:
    command = wsl_command(
        distro,
        [
            "journalctl",
            "--unit",
            ORCHESTRATOR_SERVICE,
            "--follow",
            "--lines",
            "40",
            "--output",
            "cat",
            "--no-pager",
        ],
        root=True,
    )
    return subprocess.Popen(
        command,
        cwd=REPO_ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
        creationflags=child_creation_flags(),
    )


def start_web(npm: str) -> subprocess.Popen[str]:
    env = os.environ.copy()
    env.setdefault("FORCE_COLOR", "1")
    return subprocess.Popen(
        [npm, "--workspace=@gate15/web", "run", "dev"],
        cwd=REPO_ROOT,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
        creationflags=child_creation_flags(),
    )


def listener_pids(port: int) -> set[int]:
    result = subprocess.run(
        ["netstat", "-ano", "-p", "tcp"],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    pids: set[int] = set()
    for line in result.stdout.splitlines():
        columns = line.split()
        if len(columns) < 5 or columns[0].upper() != "TCP" or columns[3].upper() != "LISTENING":
            continue
        local = columns[1].strip("[]")
        if local.rsplit(":", 1)[-1] == str(port) and columns[-1].isdigit():
            pids.add(int(columns[-1]))
    return pids


def stop_listener(port: int) -> None:
    pids = listener_pids(port)
    if not pids:
        return
    for pid in sorted(pids):
        emit("launcher", f"Stopping existing process tree {pid} on port {port}.")
        subprocess.run(
            ["taskkill", "/PID", str(pid), "/T", "/F"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
    if not wait_until(lambda: not port_is_open(port), timeout=8):
        raise LauncherError(f"Port {port} is still occupied after stopping its listener.")


def stop_process(process: subprocess.Popen[str] | None, *, tree: bool = False) -> None:
    if process is None or process.poll() is not None:
        return
    if tree and os.name == "nt":
        subprocess.run(
            ["taskkill", "/PID", str(process.pid), "/T", "/F"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
    else:
        process.terminate()
    try:
        process.wait(timeout=8)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=3)


def validate_prerequisites() -> tuple[str, str]:
    if os.name != "nt":
        raise LauncherError("This launcher is for Windows + WSL. Run it from Windows Python.")
    wsl = shutil.which("wsl.exe")
    npm = shutil.which("npm.cmd") or shutil.which("npm")
    if not wsl:
        raise LauncherError("wsl.exe was not found. Install/enable WSL first.")
    if not npm:
        raise LauncherError("npm was not found on the Windows PATH.")
    if not (REPO_ROOT / "apps" / "web" / "package.json").is_file():
        raise LauncherError(f"Could not find the Gate 15 repo above {Path(__file__).resolve()}.")
    if not (REPO_ROOT / "node_modules" / "next").exists():
        raise LauncherError(f"Dependencies are missing. Run `npm install` once in {REPO_ROOT}.")
    return wsl, npm


def boot_wsl_and_services(distro: str, *, restart_orchestrator: bool) -> None:
    emit("launcher", f"Starting WSL distro {distro}…")
    run_checked(
        wsl_command(distro, ["/bin/true"]),
        description=f"Starting WSL distro {distro}",
    )
    run_checked(
        wsl_command(distro, ["systemctl", "start", NETWORK_SERVICE], root=True),
        description="Starting the Firecracker network service",
    )
    action = "restart" if restart_orchestrator else "start"
    run_checked(
        wsl_command(distro, ["systemctl", action, ORCHESTRATOR_SERVICE], root=True),
        description=f"{action.title()}ing the orchestrator service",
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Start Gate 15 locally: Windows web app + WSL Firecracker/orchestrator.",
    )
    parser.add_argument(
        "--distro",
        default=os.environ.get("GATE15_WSL_DISTRO", "Ubuntu"),
        help="WSL distro name (default: Ubuntu, or GATE15_WSL_DISTRO).",
    )
    parser.add_argument("--no-browser", action="store_true", help="Do not open localhost:4242.")
    parser.add_argument(
        "--restart-orchestrator",
        action="store_true",
        help="Restart the WSL orchestrator even if it is already running.",
    )
    parser.add_argument(
        "--restart-web",
        action="store_true",
        help="Stop the current listener on port 4242, then launch it here so its logs are visible.",
    )
    parser.add_argument(
        "--terminate-wsl-on-exit",
        action="store_true",
        help="Terminate the selected WSL distro when this launcher exits.",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Start/check the WSL backend, report readiness, and exit without starting the web app.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    _, npm = validate_prerequisites()
    journal_process: subprocess.Popen[str] | None = None
    web_process: subprocess.Popen[str] | None = None

    try:
        boot_wsl_and_services(args.distro, restart_orchestrator=args.restart_orchestrator)

        if args.check:
            healthy = wait_until(lambda: api_is_healthy(API_PORT), timeout=30)
            emit("launcher", f"Orchestrator: {'ready' if healthy else 'not ready'} on http://localhost:{API_PORT}.")
            emit(
                "launcher",
                f"Web: {'already running' if port_is_open(WEB_PORT) else 'ready to launch'} on http://localhost:{WEB_PORT}.",
            )
            return 0 if healthy else 1

        journal_process = start_orchestrator_logs(args.distro)
        start_log_reader(journal_process, "orchestrator")
        if not wait_until(lambda: api_is_healthy(API_PORT), timeout=45, process=journal_process):
            raise LauncherError(
                f"The orchestrator did not become healthy at http://localhost:{API_PORT}/health within 45 seconds."
            )
        emit("launcher", f"Orchestrator ready at http://localhost:{API_PORT}.")

        if args.restart_web and port_is_open(WEB_PORT):
            stop_listener(WEB_PORT)

        if port_is_open(WEB_PORT):
            emit("launcher", f"Web server already running at http://localhost:{WEB_PORT}.")
            emit(
                "launcher",
                "Its existing stdout cannot be attached; rerun with --restart-web to see both log streams here.",
            )
        else:
            emit("launcher", "Starting the Windows web server…")
            web_process = start_web(npm)
            start_log_reader(web_process, "web")
            if not wait_until(lambda: port_is_open(WEB_PORT), timeout=60, process=web_process):
                code = web_process.poll()
                detail = f" (exit code {code})" if code is not None else ""
                raise LauncherError(f"The web server did not open port {WEB_PORT} within 60 seconds{detail}.")
            emit("launcher", f"Web ready at http://localhost:{WEB_PORT}.")

        if not args.no_browser:
            webbrowser.open(f"http://localhost:{WEB_PORT}")

        emit("launcher", "Combined logs are live. Press Ctrl+C to stop the launcher.")
        if not args.terminate_wsl_on_exit:
            emit("launcher", "WSL will remain running; add --terminate-wsl-on-exit if you want Ctrl+C to stop it too.")

        while True:
            if web_process is not None and web_process.poll() is not None:
                raise LauncherError(f"The web server exited with code {web_process.returncode}.")
            if journal_process.poll() is not None:
                raise LauncherError(f"The orchestrator log follower exited with code {journal_process.returncode}.")
            time.sleep(0.5)
    except KeyboardInterrupt:
        emit("launcher", "Stopping…")
        return 0
    finally:
        stop_process(web_process, tree=True)
        stop_process(journal_process)
        if args.terminate_wsl_on_exit:
            emit("launcher", f"Terminating WSL distro {args.distro}…")
            subprocess.run(
                ["wsl.exe", "--terminate", args.distro],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
            )


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except LauncherError as error:
        emit("error", str(error))
        raise SystemExit(1)
