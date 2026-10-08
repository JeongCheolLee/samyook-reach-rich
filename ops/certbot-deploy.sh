#!/usr/bin/env bash
set -euo pipefail
# This hook only handles our lineage; other applications keep their own renewal hooks.
if [[ "${RENEWED_LINEAGE:-}" != /etc/letsencrypt/live/36-reach-rich.jeongcheol.cloud ]]; then
  exit 0
fi
/usr/sbin/nginx -t
/usr/bin/systemctl reload nginx
