# Retained source provider pools — deployment draft, not activated

**Superseded as the preferred deployment path:** read-only inspection found
existing authenticated HTTPS routes for both pools. Prefer the verified mappings
in `PROVIDER-TRANSFER-PLAN.md`; do not create this additional SSH authorization
boundary unless a later network requirement actually needs it. The draft remains
an unactivated fallback, not a required migration step.

Keep Claude (source loopback8092) and Gemini (source loopback8090) where their
existing account/session configuration already lives. VPS2 gets a dedicated SSH
client container, not copies of source pool sessions. No Ollama, Edge or multimodal
forwarding is included; 8094 needs a confirmed consumer and a separate narrow update.

Artifacts: `deploy/recovery/pool-tunnel/{Dockerfile,.dockerignore,entrypoint.sh}`,
opt-in `deploy/recovery/docker-compose.pool-tunnel.yml`, and pure
`scripts/migration/pool-tunnel-plan.ts`. The plan helper accepts public material
only; it does not execute commands, write authorization files, generate keys or
start a tunnel. Provider API keys remain in the separate protected runtime transfer.

## Trust boundary and OpenSSH semantics

The source authorized key combines restrict, port-forwarding, an exact
from=167.233.145.218 restriction, command=/bin/false, explicit no-agent/no-PTY/no-X11/
no-user-rc, and exact permitopen entries for 127.0.0.1:8092 and :8090. Re-enabling
port forwarding after restrict does not itself disable reverse forwarding;
permitopen restricts local-forward destinations. Forced commands govern session
execution, not a sessionless -N connection. [OpenSSH authorized-key documentation](https://man.openbsd.org/sshd.8#AUTHORIZED_KEYS_FILE_FORMAT).

Therefore the dedicated non-root source account `tutorial-pools` also needs the
generated Match User policy: AllowTcpForwarding local, PermitListen none,
AllowStreamLocalForwarding no, MaxSessions0, ForceCommand /bin/false and disabled
password/interactive/agent/PTY/X11/tunnel access. MaxSessions0 blocks shell and
subsystem sessions while retaining forwarding. Its only authorized-key file is
root-managed `/etc/ssh/authorized_keys/tutorial-pools`.
[OpenSSH server configuration](https://man.openbsd.org/sshd_config.5).

The client uses -N -T, strict pinned host verification, IdentitiesOnly, no agent,
no interactive authentication, ExitOnForwardFailure and 30-second keepalives with
three missed replies. No inherited client config or executable local commands are
used. Forward establishment is not proof that the final pool is healthy; keepalive
only checks the SSH connection. [OpenSSH client configuration](https://man.openbsd.org/ssh_config.5).

## Explicit review and installation sequence

1. Root reviews the dedicated account and effective source sshd policy. Do not
   reuse the deployment/root identity. Preserve other accounts and authorization
   entries. Ensure the new account is usable for public-key authentication under
   source account/PAM policy; password authentication remains disabled. Validate
   the complete candidate configuration with sshd -t and inspect sshd -T -C for
   this user and the real incoming VPS2 IPv4 before any controlled reload.
   Existing Match/include precedence can change effective settings; the generated
   snippet alone is not proof. Keep an existing administrative session and rollback.
2. Generate a new application-only ed25519 key on VPS2, exclusively in
   `/opt/tutorial-recovery-private/pool-tunnel`. The helper returns a proposed
   ssh-keygen argument vector only. The unattended key has an empty passphrase;
   compensate with root-only0700 parent, owner1000 private key0400/0600, exact
   source restrictions and no copies to a repository, OneDrive, logs or browser.
   Do not overwrite a pre-existing key or reuse a personal/deployment key.
3. Obtain the source host key from the already verified local SSH known_hosts,
   selecting the actual SSH HostName/port entry with ssh-keygen -F. Hashed entries
   are supported. Compare its SHA256 fingerprint with the already verified entry;
   never establish trust from ssh-keyscan alone or accept-new. Pass that selected
   line and fingerprint to the dry-plan helper. It validates ed25519 structure and
   equality, then aliases the same key to tutorial-source-pinned. The operator is
   responsible for the provenance assertion: a boolean is not independent trust.
4. Install only the generated public application key into the dedicated
   root-owned source authorization file. Transfer only the pinned host-key candidate
   to VPS2 known_hosts, owner1000 mode0400/0600. The container entrypoint checks
   file ownership, mode and single-link regular files. Source private host keys
   and personal private keys must never be copied. Source connections must really
   originate from 167.233.145.218; verify NAT/IPv4 routing, not an assumption.
5. Build the minimal Docker context with an explicitly reviewed Alpine image
   digest and openssh-client package version; record/pin the resulting tunnel
   image digest. No auth material enters the build. Package installation is a
   later build step, not performed by this draft.
6. Review and opt into the compose overlay plus provider-pools profile. It adds
   only web and tunnel to a dedicated internal pool_clients network. DB/Redis
   stay on their existing internal network. Future workers must explicitly join
   pool_clients; no workers are created here. Only the tunnel joins pool_egress.
   There are no published host ports, host networking or Docker socket mounts.
7. The SSH listener binds container0.0.0.0 so application peers can reach it. It
   also exists on the tunnel's egress interface; the egress bridge must contain
   no other application services. Docker bridges are not a firewall: review host
   access/direct routing, prohibit unsolicited inbound to these container ports,
   and restrict tunnel egress to the verified source IPv4:22. Do not claim the
   compose file enforces destination-only egress—it does not. Do not expose 8090/
   8092 publicly, and do not grant application containers broad provider egress
   by attaching them to pool_egress.
8. Use the protected runtime helper's explicit mappings:
   CLAUDE_POOL_URL=http://provider-pool-tunnel:8092 and
   GEMINI_POOL_URL=http://provider-pool-tunnel:8090. Preserve existing pool API
   keys. These names resolve only for selected pool_clients members. Keep
   publication/recovery/retention guards disabled during verification.

## Verification and rollback

25 synthetic plan/static assertions and offline Alpine shell syntax validation
pass. Compose syntax is checked with synthetic variables only; no auth files are
mounted and no services are started. Full running-sshd negative tests remain
required before production activation: approved local destinations work, a third
port fails, reverse forwarding fails, Unix-socket forwarding fails, shell/SFTP/
PTY/agent attempts fail, wrong originating IPv4 fails, wrong host key fails.
Use an inert source test listener for transport checks, not a provider generation
request. Pool authenticated behavior is a separate bounded application test.

Confirm connectivity loss/restart is visible without declaring pool readiness from
container status alone. The client exits on lost SSH connection and Docker restarts
it; 48MiB/0.15CPU/16PIDs and rotated error-only logs bound resource use. Application
jobs must retain their existing retry semantics during outages.

Rollback: stop this dedicated tunnel, remove only its source authorized-key entry
and account-specific configuration after verifying ownership, restore the prior
runtime candidate endpoint mapping, and retain the existing source pools unchanged.
No source pool account/session deletion is part of either deployment or rollback.
