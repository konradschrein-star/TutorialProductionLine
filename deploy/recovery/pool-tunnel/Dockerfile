# Build only after selecting a reviewed Alpine image digest and package version.
# No keys, known_hosts or runtime environment are part of this build context.
ARG SSH_BASE_IMAGE
FROM ${SSH_BASE_IMAGE}
ARG OPENSSH_CLIENT_VERSION
RUN test -n "$OPENSSH_CLIENT_VERSION" \
 && apk add --no-cache "openssh-client=$OPENSSH_CLIENT_VERSION" \
 && addgroup -g 1000 tunnel \
 && adduser -D -H -u 1000 -G tunnel tunnel \
 && mkdir /run/pool-ssh \
 && chmod 0555 /run/pool-ssh
COPY --chmod=0555 entrypoint.sh /usr/local/bin/pool-tunnel
USER 1000:1000
ENTRYPOINT ["/usr/local/bin/pool-tunnel"]
