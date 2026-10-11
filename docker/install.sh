#!/usr/bin/env bash
# Install Docker and start the AmneziaWG Quick web panel.
# Usage: sudo bash docker/install.sh [--port 51821]

if [ -z "${BASH_VERSION:-}" ]; then
  echo "Run this script with bash: sudo bash docker/install.sh" >&2
  exit 1
fi

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT/lib/common.sh"

COMPOSE_FILE="$ROOT/docker/docker-compose.yml"
HOST_TOOLS_DIR=/var/lib/amnezia-wg-quick/host-tools
PORT=51821

usage() {
  cat <<'EOF'
Usage: sudo bash docker/install.sh [--port 51821]

Installs Docker when it is missing, builds the panel image, and starts
it. The admin account is stored in a Docker volume and kept on re-run.

With no --port, the installer asks for a TCP port. Press Enter to keep
51821. If that port is taken, it asks again.
EOF
}

PORT_EXPLICIT=0

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --port)
        [[ $# -ge 2 ]] || die "--port needs a value."
        PORT="$2"
        PORT_EXPLICIT=1
        shift 2
        ;;
      --port=*)
        PORT="${1#*=}"
        PORT_EXPLICIT=1
        shift
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        die "Unknown option: $1"
        ;;
    esac
  done
  [[ "$PORT" =~ ^[0-9]+$ ]] || die "Port must be a number."
  if (( PORT < 1 || PORT > 65535 )); then
    die "Port must be from 1 to 65535."
  fi
}

install_docker() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    log "Docker Compose is already installed"
    return
  fi
  ensure_curl
  if ! command -v docker >/dev/null 2>&1; then
    log "Installing Docker"
    curl -fsSL https://get.docker.com | sh
  fi
  if ! docker compose version >/dev/null 2>&1; then
    log "Installing the Docker Compose plugin"
    if [[ "$PKG" == apt ]]; then
      apt-get update
      apt_install docker-compose-plugin
    else
      dnf install -y docker-compose-plugin
    fi
  fi
  docker compose version >/dev/null 2>&1 || die "Docker Compose is still unavailable."
  if command -v systemctl >/dev/null 2>&1; then
    systemctl enable --now docker
  fi
}

prepare_host_tools() {
  mkdir -p "$HOST_TOOLS_DIR"
  local name src dest
  for name in awg awg-quick; do
    dest="$HOST_TOOLS_DIR/$name"
    if [[ -d "$dest" ]]; then
      rm -rf "$dest"
    fi
    [[ -f "$dest" ]] || : > "$dest"
    src="$(command -v "$name" 2>/dev/null || true)"
    if [[ -n "$src" && -x "$src" ]]; then
      if [[ "$src" != "$dest" ]]; then
        cat "$src" > "$dest"
      fi
      chmod 755 "$dest"
      log "Sharing ${name} with the panel"
    else
      : > "$dest"
      chmod 644 "$dest"
      warn "${name} is not installed on the host. The panel will show it as missing."
    fi
  done
}

start_panel() {
  [[ -f "$COMPOSE_FILE" ]] || die "docker/docker-compose.yml is missing."
  [[ -f "$ROOT/docker/Dockerfile" ]] || die "docker/Dockerfile is missing."
  log "Building and starting the panel"
  AWG_UI_PORT="$PORT" docker compose -f "$COMPOSE_FILE" up -d --build --remove-orphans
  local _
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 30; do
    if curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null; then
      log "Panel is responding on port ${PORT}"
      return
    fi
    sleep 1
  done
  warn "The panel did not answer yet. Recent logs:"
  docker compose -f "$COMPOSE_FILE" logs --tail 40 || true
  die "The panel container failed to start."
}

summary() {
  local ip
  ip="$(primary_ip || true)"
  cat <<EOF

AmneziaWG Quick panel is running in Docker.

  Panel    http://${ip:-127.0.0.1}:${PORT}
  Local    http://127.0.0.1:${PORT}

Open the panel and create the admin account.
Allow TCP ${PORT} on the cloud firewall if you connect from another network.
Use an SSH tunnel or HTTPS before exposing the panel on the internet.

EOF
}

main() {
  parse_args "$@"
  require_linux_root
  if [[ "$PORT_EXPLICIT" -eq 1 ]]; then
    PORT="$(ask_port "Panel TCP port" 51821 tcp "$PORT")"
  else
    PORT="$(ask_port "Panel TCP port" 51821 tcp)"
  fi
  install_docker
  prepare_host_tools
  start_panel
  open_firewall "$PORT"
  summary
}

main "$@"
