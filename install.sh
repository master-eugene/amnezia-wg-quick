#!/usr/bin/env bash
# Install the AmneziaWG Quick console and the Docker web panel.
#
#   bash <(curl -fsSL https://raw.githubusercontent.com/master-eugene/amnezia-wg-quick/master/install.sh)

if [ -z "${BASH_VERSION:-}" ]; then
  echo "Run this script with bash." >&2
  exit 1
fi

set -euo pipefail

REPO_URL=https://github.com/master-eugene/amnezia-wg-quick.git
RAW_URL=https://raw.githubusercontent.com/master-eugene/amnezia-wg-quick/master/install.sh
BRANCH=master
INSTALL_DIR=/opt/amnezia-wg-quick

log() { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m x \033[0m %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<EOF
Usage: bash <(curl -fsSL ${RAW_URL})

Installs AmneziaWG and the awq menu.
It asks whether to install the web panel. Enter or n installs the console only.
y then asks for the AmneziaWG UDP port and the panel TCP port.
Press Enter to keep 51820 and 51821. If a port is taken, it asks again.
Running it again keeps existing clients and the panel account.

From a checkout:

  sudo bash install.sh
  sudo bash install.sh --port 51821
  sudo bash install.sh console
  sudo bash install.sh docker --port 51821
EOF
}

is_fd() {
  case "$1" in
    /dev/fd/*|/proc/*/fd/*) return 0 ;;
    *) return 1 ;;
  esac
}

script_dir() {
  local src="${BASH_SOURCE[0]:-}"
  [[ -n "$src" && -f "$src" ]] || return 1
  is_fd "$src" && return 1
  (cd "$(dirname "$src")" && pwd)
}

in_checkout() {
  local root="$1"
  [[ -n "$root" \
    && -f "$root/console/install.sh" \
    && -f "$root/docker/install.sh" \
    && -f "$root/lib/common.sh" \
    && -f "$root/docker/Dockerfile" ]]
}

become_root() {
  [[ "${EUID}" -eq 0 ]] && return 0
  command -v sudo >/dev/null 2>&1 || die "Run this installer as root."
  local src="${BASH_SOURCE[0]:-}"
  if [[ -n "$src" && -f "$src" ]] && ! is_fd "$src"; then
    log "Re-running as root."
    exec sudo --preserve-env=TRUST_PROXY bash "$src" "$@"
  fi
  command -v curl >/dev/null 2>&1 || die "Run this installer as root."
  log "Re-running as root."
  exec sudo --preserve-env=TRUST_PROXY bash -c "$(curl -fsSL "$RAW_URL")" bash "$@"
}

ensure_git() {
  command -v git >/dev/null 2>&1 && return 0
  log "Installing git"
  if command -v apt-get >/dev/null 2>&1; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update
    apt-get install -y ca-certificates git
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y ca-certificates git
  else
    die "Install git, then run this installer again."
  fi
}

sync_checkout() {
  export GIT_TERMINAL_PROMPT=0
  ensure_git
  if [[ -d "$INSTALL_DIR/.git" ]]; then
    log "Updating ${INSTALL_DIR}"
    git -C "$INSTALL_DIR" remote set-url origin "$REPO_URL"
    git -C "$INSTALL_DIR" fetch --depth 1 origin "$BRANCH"
    git -C "$INSTALL_DIR" reset --hard FETCH_HEAD
  elif [[ -e "$INSTALL_DIR" ]] && [[ -n "$(ls -A "$INSTALL_DIR" 2>/dev/null || true)" ]]; then
    die "${INSTALL_DIR} already exists and is not a checkout of this project."
  else
    log "Downloading AmneziaWG Quick"
    mkdir -p "$(dirname "$INSTALL_DIR")"
    git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
  fi
}

requested_panel_port() {
  local port="" prev="" arg found=0
  for arg in "$@"; do
    if [[ "$prev" == "--port" ]]; then
      port="$arg"
      found=1
    elif [[ "$arg" == --port=* ]]; then
      port="${arg#*=}"
      found=1
    fi
    prev="$arg"
  done
  [[ "$found" -eq 1 ]] || return 1
  printf '%s\n' "$port"
}

install_from() {
  local root="$1"
  shift
  local edition="both"
  case "${1:-}" in
    console|docker)
      edition="$1"
      shift
      ;;
  esac
  case "$edition" in
    console)
      bash "$root/console/install.sh" "$@"
      ;;
    docker)
      bash "$root/docker/install.sh" "$@"
      ;;
    both)
      # shellcheck disable=SC1091
      source "$root/lib/common.sh"
      require_linux_root
      local vpn panel panel_preset="" install_panel
      if panel_preset="$(requested_panel_port "$@")"; then
        install_panel=yes
      else
        install_panel="$(ask_yes_no "Install the web panel?" n)"
      fi
      if [[ "$install_panel" != yes ]]; then
        bash "$root/console/install.sh" --listen-port 51820
        cat <<EOF

AmneziaWG Quick is installed.

  Menu     sudo awq

EOF
        return 0
      fi
      vpn="$(ask_port "AmneziaWG UDP port" 51820 udp)"
      if [[ -n "$panel_preset" ]]; then
        panel="$(ask_port "Panel TCP port" 51821 tcp "$panel_preset")"
      else
        panel="$(ask_port "Panel TCP port" 51821 tcp)"
      fi
      bash "$root/console/install.sh" --listen-port "$vpn"
      bash "$root/docker/install.sh" --port "$panel"
      local ip published=""
      ip="$(primary_ip || true)"
      published="$(docker compose -f "$root/docker/docker-compose.yml" port panel 51821 2>/dev/null || true)"
      published="${published##*:}"
      if [[ "$published" =~ ^[0-9]+$ ]]; then
        panel="$published"
      fi
      cat <<EOF

AmneziaWG Quick is installed.

  Menu     sudo awq
  Panel    http://${ip:-127.0.0.1}:${panel}

EOF
      ;;
  esac
}

main() {
  case "${1:-}" in
    -h|--help|help)
      usage
      exit 0
      ;;
  esac
  become_root "$@"
  local root=""
  if ! root="$(script_dir)"; then
    root=""
  fi
  if in_checkout "$root"; then
    install_from "$root" "$@"
    return 0
  fi
  if [[ "$root" == "$INSTALL_DIR" ]]; then
    die "The checkout at ${INSTALL_DIR} is incomplete."
  fi
  sync_checkout
  exec bash "$INSTALL_DIR/install.sh" "$@"
}

main "$@"
