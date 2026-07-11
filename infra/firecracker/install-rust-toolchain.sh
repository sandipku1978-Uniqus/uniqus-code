#!/usr/bin/env bash
# Install the pinned host-side Rust toolchain used to compile the in-VM agent.
#
# Cargo/Rust never ship inside the Firecracker guest. They live on the build
# host and produce one static x86_64-musl binary for build-rootfs.sh.
set -euo pipefail

RUST_TOOLCHAIN_VERSION="${RUST_TOOLCHAIN_VERSION:-1.97.0}"
RUST_TARGET="${RUST_TARGET:-x86_64-unknown-linux-musl}"
RUSTUP_HOME="${RUSTUP_HOME:-/root/.rustup}"
CARGO_HOME="${CARGO_HOME:-/root/.cargo}"
RUSTUP_INIT_URL="${RUSTUP_INIT_URL:-https://sh.rustup.rs}"
export RUSTUP_HOME CARGO_HOME

if [[ "$(id -u)" != "0" ]]; then
  echo "must run as root" >&2
  exit 1
fi

if [[ "${SKIP_APT_UPDATE:-0}" != "1" ]]; then
  apt-get update -y
fi
# Rust procedural macros and crate build scripts link for the host even when
# the final agent targets musl. build-essential supplies the glibc startup
# objects and linker inputs; musl-tools supplies musl-gcc for the final binary.
apt-get install -y --no-install-recommends \
  curl ca-certificates build-essential musl-tools

rustup_bin="${CARGO_HOME}/bin/rustup"
if [[ ! -x "${rustup_bin}" ]]; then
  tmp="$(mktemp)"
  trap 'rm -f "${tmp}"' EXIT
  curl -fSL "${RUSTUP_INIT_URL}" -o "${tmp}"
  sh "${tmp}" -y \
    --no-modify-path \
    --profile minimal \
    --default-toolchain "${RUST_TOOLCHAIN_VERSION}"
else
  "${rustup_bin}" toolchain install "${RUST_TOOLCHAIN_VERSION}" --profile minimal
fi

"${rustup_bin}" default "${RUST_TOOLCHAIN_VERSION}"
"${rustup_bin}" target add \
  --toolchain "${RUST_TOOLCHAIN_VERSION}" \
  "${RUST_TARGET}"

# Non-login SSH deploy shells do not source /root/.cargo/env. Put the rustup
# shims on the system PATH so build-rootfs.sh sees the same pinned toolchain in
# interactive and automated runs.
for binary in cargo rustc rustup; do
  ln -sfn "${CARGO_HOME}/bin/${binary}" "/usr/local/bin/${binary}"
done

echo "Rust host toolchain ready:"
cargo --version
rustc --version
rustup show active-toolchain
rustup target list --installed | grep -Fx "${RUST_TARGET}"
musl-gcc --version | head -1
