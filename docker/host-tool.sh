#!/bin/sh
# Run the host copy of awg or awg-quick, chosen by this script's name.
tool=$(basename "$0")
if [ ! -x /host/bin/sh ]; then
  echo "Host tools are not visible from the panel." >&2
  exit 127
fi
exec chroot /host /bin/sh -c 'export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
tool=$1
shift
exec "$tool" "$@"' sh "$tool" "$@"
