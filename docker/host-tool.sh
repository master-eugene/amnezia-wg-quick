#!/bin/sh
# Run the host's awg or awg-quick, selected by this script's filename.
tool=$(basename "$0")
exec nsenter -t 1 -m -- /bin/sh -c 'export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
tool=$1
shift
exec "$tool" "$@"' sh "$tool" "$@"
