#!/usr/bin/env bash
# Install AmneziaWG Quick on Ubuntu and the other supported hosts.
#
# From a checkout:
#   sudo bash console/install.sh
#
# From a published copy of this repository:
#   curl -fsSL "$AWQ_BASE_URL/console/install.sh" | sudo AWQ_BASE_URL="$AWQ_BASE_URL" bash
# AWQ_BASE_URL is the repository root, without a trailing slash.

if [ -z "${BASH_VERSION:-}" ]; then
  echo "Run this script with bash: sudo bash console/install.sh" >&2
  exit 1
fi

set -euo pipefail

BIN_PATH=/usr/local/bin/awq
DATA_DIR=/var/lib/amnezia-wg-quick
ROOT=""

if [[ -n "${BASH_SOURCE[0]:-}" && -f "${BASH_SOURCE[0]}" ]]; then
  ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fi

usage() {
  cat <<'EOF'
Usage: sudo bash console/install.sh

Installs AmneziaWG and the awq console menu. Re-running updates awq
and leaves existing clients in place.

It asks for the AmneziaWG UDP port. Press Enter to keep 51820.
If that port is taken, it asks again. --listen-port skips the question
when the port is free.

Published one-line install, with AWQ_BASE_URL set to the repository root:

  curl -fsSL "$AWQ_BASE_URL/console/install.sh" | sudo AWQ_BASE_URL="$AWQ_BASE_URL" bash
EOF
}

fetch_project() {
  if [[ -n "$ROOT" && -f "$ROOT/console/awq" && -f "$ROOT/lib/common.sh" ]]; then
    return
  fi
  local base="${AWQ_BASE_URL:-}"
  base="${base%/}"
  if [[ -z "$base" ]]; then
    echo "Project files were not found next to this script." >&2
    echo "Run it from a checkout, or set AWQ_BASE_URL to the repository root." >&2
    exit 1
  fi
  ROOT="$(mktemp -d)"
  mkdir -p "$ROOT/lib" "$ROOT/console"
  echo "==> Downloading AmneziaWG Quick"
  curl -fsSL "$base/lib/common.sh" -o "$ROOT/lib/common.sh"
  curl -fsSL "$base/console/awq" -o "$ROOT/console/awq"
  curl -fsSL "$base/console/install.sh" -o "$ROOT/console/install.sh" || true
}

server_field() {
  python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["server"][sys.argv[2]])' \
    "$DATA_DIR/state.json" "$1"
}

check_interface() {
  if awg show awg0 >/dev/null 2>&1; then
    return 0
  fi
  if command -v journalctl >/dev/null 2>&1; then
    journalctl -u awg-quick@awg0 -n 30 --no-pager >&2 || true
  fi
  die "The awg0 interface is not running, so clients cannot connect. Check the log above."
}

main() {
  if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
    usage
    exit 0
  fi
  fetch_project
  # shellcheck disable=SC1091
  source "$ROOT/lib/common.sh"
  local listen_arg="" listen=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --listen-port)
        [[ $# -ge 2 ]] || die "--listen-port needs a value."
        listen_arg="$2"
        shift 2
        ;;
      --listen-port=*)
        listen_arg="${1#*=}"
        shift
        ;;
      *)
        die "Unknown option: $1"
        ;;
    esac
  done
  require_linux_root
  if [[ -n "$listen_arg" ]]; then
    listen="$(ask_port "AmneziaWG UDP port" 51820 udp "$listen_arg")"
  else
    listen="$(ask_port "AmneziaWG UDP port" 51820 udp)"
  fi
  install_host_packages
  install_amneziawg
  enable_ip_forward
  log "Installing ${BIN_PATH}"
  install -m 755 "$ROOT/console/awq" "$BIN_PATH"
  rm -f /usr/local/bin/awg-admin
  mkdir -p "$DATA_DIR"
  chmod 700 "$DATA_DIR"
  listen="$(ask_port "AmneziaWG UDP port" 51820 udp "$listen")"
  log "Preparing the server"
  AWQ_LISTEN_PORT="$listen" "$BIN_PATH" --init
  listen="$(server_field listen_port)"
  open_firewall "$listen" udp "AmneziaWG"
  check_interface
  cat <<EOF

AmneziaWG Quick is installed.

  Command   awq
  Endpoint  $(server_field endpoint):${listen}/udp

Run awq to open the client menu.
Allow UDP ${listen} in your cloud provider's firewall or security group.
If the endpoint is wrong, run: sudo AWQ_ENDPOINT=<public IP> awq --init

EOF
}

main "$@"
