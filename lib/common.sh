# Shared installer helpers. Source this file; do not execute it.

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  echo "Source this file from an installer." >&2
  exit 1
fi

PPA_KEYRING=/usr/share/keyrings/amneziawg-quick-ppa.gpg
PPA_FINGERPRINT_FALLBACK=75C9DD72C799870E310542E24166F2C257290828

log() { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m ! \033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31m x \033[0m %s\n' "$*" >&2; exit 1; }

require_linux_root() {
  [[ "$(uname -s)" == "Linux" ]] || die "This installer runs on Linux."
  [[ "${EUID}" -eq 0 ]] || die "Run as root: sudo bash $0"
  if [[ -r /etc/os-release ]]; then
    # shellcheck disable=SC1091
    source /etc/os-release
  fi
  ID="${ID:-unknown}"
  ID_LIKE="${ID_LIKE:-}"
  VERSION_CODENAME="${VERSION_CODENAME:-}"
  case "$ID" in
    ubuntu|debian|linuxmint|pop|elementary|zorin) PKG=apt ;;
    fedora|rhel|centos|rocky|almalinux|ol) PKG=dnf ;;
    *)
      case "$ID_LIKE" in
        *debian*|*ubuntu*) PKG=apt ;;
        *fedora*|*rhel*) PKG=dnf ;;
        *) die "Unsupported distribution: ${PRETTY_NAME:-$ID}. Use Debian, Ubuntu, or Fedora." ;;
      esac
      ;;
  esac
  log "Detected ${PRETTY_NAME:-$ID}"
}

apt_install() {
  DEBIAN_FRONTEND=noninteractive apt-get install -y \
    -o Dpkg::Options::=--force-confdef \
    -o Dpkg::Options::=--force-confold \
    "$@"
}

ensure_curl() {
  command -v curl >/dev/null 2>&1 && return 0
  log "Installing curl"
  if [[ "$PKG" == apt ]]; then
    apt-get update
    apt_install ca-certificates curl
  else
    dnf install -y ca-certificates curl
  fi
}

install_host_packages() {
  log "Installing base packages"
  export DEBIAN_FRONTEND=noninteractive
  export NEEDRESTART_MODE=a
  ensure_curl
  if [[ "$PKG" == apt ]]; then
    apt-get update
    apt_install ca-certificates curl gnupg python3 iptables iproute2 qrencode dkms build-essential pkg-config
    if ! apt_install "linux-headers-$(uname -r)"; then
      warn "Kernel headers for $(uname -r) were not installed. The AmneziaWG module may fail to build."
    fi
  else
    dnf install -y ca-certificates curl gnupg2 python3 iptables iproute qrencode dkms gcc make elfutils-libelf-devel
    dnf install -y "kernel-devel-$(uname -r)" || dnf install -y kernel-devel || warn "Kernel headers were not installed."
  fi
}

ppa_suite_exists() {
  curl -fsI --retry 2 --retry-delay 1 \
    "https://ppa.launchpadcontent.net/amnezia/ppa/ubuntu/dists/$1/Release" >/dev/null 2>&1
}

choose_suite() {
  local native candidate
  native="$(printf '%s' "${VERSION_CODENAME:-}" | tr '[:upper:]' '[:lower:]')"
  for candidate in "$native" noble jammy focal; do
    [[ -n "$candidate" ]] || continue
    if ppa_suite_exists "$candidate"; then
      printf '%s\n' "$candidate"
      return
    fi
  done
  printf '%s\n' noble
}

import_ppa_key() {
  local fingerprint api_json tmp
  api_json="$(curl -fsSL "https://api.launchpad.net/1.0/~amnezia/+archive/ubuntu/ppa" || true)"
  fingerprint="$(printf '%s' "$api_json" | sed -n 's/.*"signing_key_fingerprint": "\([0-9A-Fa-f]*\)".*/\1/p' | head -1)"
  if [[ -z "$fingerprint" ]]; then
    fingerprint="$PPA_FINGERPRINT_FALLBACK"
    warn "Could not read the PPA key from Launchpad. Using the known fingerprint."
  fi
  tmp="$(mktemp -d)"
  if ! gpg --batch --homedir "$tmp" --keyserver hkps://keyserver.ubuntu.com --recv-keys "$fingerprint"; then
    curl -fsSL "https://keyserver.ubuntu.com/pks/lookup?op=get&search=0x${fingerprint}" \
      | gpg --batch --homedir "$tmp" --import
  fi
  gpg --batch --homedir "$tmp" --export "$fingerprint" > "$PPA_KEYRING"
  rm -rf "$tmp"
  [[ -s "$PPA_KEYRING" ]] || die "Could not download the Amnezia PPA signing key."
  chmod 644 "$PPA_KEYRING"
}

install_amneziawg_apt() {
  local suite
  suite="$(choose_suite)"
  log "Adding the Amnezia PPA (suite: ${suite})"
  import_ppa_key
  printf 'deb [signed-by=%s] https://ppa.launchpadcontent.net/amnezia/ppa/ubuntu %s main\n' \
    "$PPA_KEYRING" "$suite" > /etc/apt/sources.list.d/amneziawg-quick.list
  apt-get update
  apt_install amneziawg
  if ! command -v awg >/dev/null 2>&1; then
    apt_install amneziawg-tools || warn "awg was not installed."
  fi
}

install_amneziawg_dnf() {
  log "Installing AmneziaWG from COPR"
  dnf install -y 'dnf-command(copr)' || dnf install -y dnf-plugins-core
  dnf copr enable -y amneziavpn/amneziawg
  dnf install -y amneziawg-dkms amneziawg-tools
}

install_amneziawg() {
  if command -v systemd-detect-virt >/dev/null 2>&1 && systemd-detect-virt -q --container; then
    warn "This looks like a container. The kernel module may not build."
  fi
  if [[ "$PKG" == apt ]]; then
    install_amneziawg_apt
  else
    install_amneziawg_dnf
  fi
  if command -v awg >/dev/null 2>&1; then
    log "awg is available: $(command -v awg)"
  else
    warn "awg is not on PATH yet."
  fi
}

enable_ip_forward() {
  log "Enabling IP forwarding"
  cat > /etc/sysctl.d/99-amnezia-wg-quick.conf <<'EOF'
net.ipv4.ip_forward=1
net.ipv6.conf.all.forwarding=1
EOF
  sysctl --system >/dev/null || sysctl -p /etc/sysctl.d/99-amnezia-wg-quick.conf
}

open_firewall() {
  local port="$1"
  local proto="${2:-tcp}"
  local comment="${3:-AmneziaWG Quick}"
  if command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state >/dev/null 2>&1; then
    firewall-cmd --permanent --add-port="${port}/${proto}"
    firewall-cmd --reload
    log "Opened ${proto} ${port} in firewalld"
  fi
  if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
    ufw allow "${port}/${proto}" comment "$comment"
    log "Opened ${proto} ${port} in ufw"
  fi
}

primary_ip() {
  ip -4 route get 1.1.1.1 2>/dev/null | awk '{
    for (i = 1; i <= NF; i++) if ($i == "src") { print $(i + 1); exit }
  }'
}

port_number_ok() {
  local port="$1"
  [[ "$port" =~ ^[0-9]{1,5}$ ]] || return 1
  (( 10#$port >= 1 && 10#$port <= 65535 ))
}

port_owned_by_install() {
  local proto="$1"
  local port="$2"
  local shown=""
  case "$proto" in
    udp)
      command -v awg >/dev/null 2>&1 || return 1
      shown="$(awg show awg0 2>/dev/null || true)"
      [[ "$shown" =~ listening\ port:[[:space:]]*${port}([^0-9]|$) ]]
      ;;
    tcp)
      command -v docker >/dev/null 2>&1 || return 1
      local tmp pid i
      tmp="$(mktemp)"
      docker ps --filter "label=com.docker.compose.project=amnezia-wg-quick" --format '{{.Ports}}' >"$tmp" 2>/dev/null &
      pid=$!
      i=0
      while (( i < 50 )) && kill -0 "$pid" 2>/dev/null; do
        sleep 0.1
        i=$((i + 1))
      done
      if kill -0 "$pid" 2>/dev/null; then
        kill "$pid" 2>/dev/null || true
      fi
      wait "$pid" 2>/dev/null || true
      shown="$(cat "$tmp" 2>/dev/null || true)"
      rm -f "$tmp"
      [[ "$shown" =~ (^|:)${port}-'>' ]]
      ;;
    *)
      return 1
      ;;
  esac
}

port_has_listener() {
  local proto="$1"
  local port="$2"
  local flags=() found=""
  case "$proto" in
    tcp) flags=(-H -lnt) ;;
    udp) flags=(-H -lnu) ;;
    *) return 1 ;;
  esac
  if command -v ss >/dev/null 2>&1; then
    if found="$(ss "${flags[@]}" "sport = :${port}" 2>/dev/null)"; then
      [[ -n "$found" ]]
      return
    fi
  fi
  if command -v python3 >/dev/null 2>&1; then
    python3 -c '
import socket, sys
proto, port = sys.argv[1], int(sys.argv[2])
kind = socket.SOCK_STREAM if proto == "tcp" else socket.SOCK_DGRAM
sock = socket.socket(socket.AF_INET, kind)
try:
    sock.bind(("0.0.0.0", port))
except OSError:
    raise SystemExit(0)
raise SystemExit(1)
' "$proto" "$port"
    return
  fi
  if [[ "$proto" == tcp ]]; then
    if timeout 1 bash -c "echo >/dev/tcp/127.0.0.1/${port}" 2>/dev/null; then
      return 0
    fi
  fi
  return 1
}

port_is_busy() {
  local proto="$1"
  local port="$2"
  if port_owned_by_install "$proto" "$port"; then
    return 1
  fi
  port_has_listener "$proto" "$port"
}

# ask_yes_no LABEL DEFAULT
# DEFAULT is y or n. Prints yes or no. Enter accepts DEFAULT.
ask_yes_no() {
  local label="$1"
  local default="$2"
  local hint="[y/N]" answer="" note=""
  [[ "$default" == y || "$default" == Y ]] && hint="[Y/n]"
  default="$(printf '%s' "$default" | tr '[:upper:]' '[:lower:]')"
  [[ "$default" == y ]] || default=n

  if ! { : </dev/tty; } 2>/dev/null || ! { : >/dev/tty; } 2>/dev/null; then
    if [[ "$default" == y ]]; then
      printf 'yes\n'
    else
      printf 'no\n'
    fi
    return 0
  fi

  while true; do
    [[ -z "$note" ]] || printf '%s\n' "$note" >/dev/tty
    printf '%s %s: ' "$label" "$hint" >/dev/tty
    if ! IFS= read -r answer </dev/tty; then
      printf '\n' >/dev/tty
      die "No answer on the terminal."
    fi
    answer="${answer#"${answer%%[![:space:]]*}"}"
    answer="${answer%"${answer##*[![:space:]]}"}"
    answer="$(printf '%s' "$answer" | tr '[:upper:]' '[:lower:]')"
    case "$answer" in
      "") answer="$default" ;;
      y|yes) answer=y ;;
      n|no) answer=n ;;
      *)
        note="Enter y or n."
        continue
        ;;
    esac
    if [[ "$answer" == y ]]; then
      printf 'yes\n'
    else
      printf 'no\n'
    fi
    return 0
  done
}

# ask_port LABEL DEFAULT PROTO [PRESET]
# Prints the chosen port. Enter accepts DEFAULT. A taken port asks again.
ask_port() {
  local label="$1"
  local default="$2"
  local proto="$3"
  local preset="${4:-}"
  local note="" answer="" port=""

  if [[ -n "$preset" ]]; then
    port_number_ok "$preset" || die "Port must be a number from 1 to 65535."
    if ! port_is_busy "$proto" "$preset"; then
      printf '%s\n' "$preset"
      return 0
    fi
    note="Port ${preset} is already in use."
  fi

  if ! { : </dev/tty; } 2>/dev/null || ! { : >/dev/tty; } 2>/dev/null; then
    if [[ -n "$note" ]]; then
      die "$note"
    fi
    if port_is_busy "$proto" "$default"; then
      die "Port ${default} is already in use."
    fi
    printf '%s\n' "$default"
    return 0
  fi

  while true; do
    [[ -z "$note" ]] || printf '%s\n' "$note" >/dev/tty
    printf '%s [%s]: ' "$label" "$default" >/dev/tty
    if ! IFS= read -r answer </dev/tty; then
      printf '\n' >/dev/tty
      die "No answer on the terminal."
    fi
    answer="${answer#"${answer%%[![:space:]]*}"}"
    answer="${answer%"${answer##*[![:space:]]}"}"
    if [[ -z "$answer" ]]; then
      port="$default"
    else
      port="$answer"
    fi
    if ! port_number_ok "$port"; then
      note="Enter a port from 1 to 65535, or press Enter for ${default}."
      continue
    fi
    if port_is_busy "$proto" "$port"; then
      note="Port ${port} is already in use."
      continue
    fi
    printf '%s\n' "$port"
    return 0
  done
}
