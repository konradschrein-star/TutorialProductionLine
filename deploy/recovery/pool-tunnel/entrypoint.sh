#!/bin/sh
set -eu
# No arbitrary SSH arguments, config, agent, shell command, or provider secrets.
test "$#" -eq 0 || exit 64
printf '%s' "${POOL_SOURCE_IPV4:-}" | awk -F. '
  NF != 4 { exit 1 }
  { for (i=1; i<=4; i++) if ($i !~ /^[0-9]+$/ || $i > 255 || length($i) > 3 || (length($i)>1 && substr($i,1,1)=="0")) exit 1 }
  $1==0 || $1==10 || $1==127 || $1>=224 || ($1==169 && $2==254) || ($1==172 && $2>=16 && $2<=31) || ($1==192 && $2==168) { exit 1 }
  END { if (NR != 1) exit 1 }
' || exit 64
for file in /run/pool-ssh/id_ed25519 /run/pool-ssh/known_hosts; do
  test -f "$file" && test ! -L "$file" || exit 65
  test "$(stat -c '%u' "$file")" = 1000 || exit 65
  test "$(stat -c '%h' "$file")" = 1 || exit 65
  case "$(stat -c '%a' "$file")" in 400|600) ;; *) exit 65 ;; esac
done
exec ssh -F /dev/null -N -T -n -4 \
  -i /run/pool-ssh/id_ed25519 \
  -o "Hostname=$POOL_SOURCE_IPV4" -o Port=22 -o User=tutorial-pools \
  -o HostKeyAlias=tutorial-source-pinned \
  -o UserKnownHostsFile=/run/pool-ssh/known_hosts -o GlobalKnownHostsFile=/dev/null \
  -o StrictHostKeyChecking=yes -o UpdateHostKeys=no -o HostKeyAlgorithms=ssh-ed25519 \
  -o BatchMode=yes -o IdentitiesOnly=yes -o IdentityAgent=none \
  -o PasswordAuthentication=no -o KbdInteractiveAuthentication=no \
  -o ForwardAgent=no -o ForwardX11=no -o RequestTTY=no -o PermitLocalCommand=no \
  -o ExitOnForwardFailure=yes -o ConnectTimeout=10 -o ConnectionAttempts=1 \
  -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -o TCPKeepAlive=no \
  -o LogLevel=ERROR \
  -L 0.0.0.0:8092:127.0.0.1:8092 \
  -L 0.0.0.0:8090:127.0.0.1:8090 \
  tutorial-source-pinned
