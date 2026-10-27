FROM node:22.23.4-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d AS qpdf-package
ARG QPDF_VERSION=12.4.2
ARG QPDF_SHA256=db367d897829f22c4198ce1094143c9d467bd6ee7dfabc44ba6f02056b24f8b1
# Render uses linux/amd64. Use the official release bundle, including its pinned
# runtime libraries, and verify its published SHA256 before extracting it.
RUN test "$(uname -m)" = x86_64 \
    && apt-get update && apt-get install -y --no-install-recommends ca-certificates curl unzip \
    && curl -fsSL "https://github.com/qpdf/qpdf/releases/download/v${QPDF_VERSION}/qpdf-${QPDF_VERSION}-bin-linux-x86_64.zip" -o /tmp/qpdf.zip \
    && echo "${QPDF_SHA256}  /tmp/qpdf.zip" | sha256sum -c - \
    && mkdir -p /opt/qpdf && unzip -q /tmp/qpdf.zip -d /opt/qpdf \
    && chmod 755 /opt/qpdf/bin/*

FROM node:22.23.4-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d
ENV NODE_ENV=production QPDF_PATH=/usr/local/bin/qpdf
COPY --from=qpdf-package /etc/ssl/certs /etc/ssl/certs
COPY --from=qpdf-package /opt/qpdf /opt/qpdf
RUN printf '#!/bin/sh\nexport LD_LIBRARY_PATH=/opt/qpdf/lib\nexec /opt/qpdf/bin/qpdf "$@"\n' > /usr/local/bin/qpdf \
    && chmod 755 /usr/local/bin/qpdf && qpdf --version
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && qpdf --version
COPY --chown=node:node . .
USER node
EXPOSE 5000
CMD ["node", "server.js"]
