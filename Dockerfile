# Production container for evaluation deployments.
#
#   docker build -t lop-nur-twin .
#   docker run --rm -p 8080:8080 lop-nur-twin
#   curl -f http://localhost:8080/healthz
#
# Two stages: a Node builder that runs the same validate → manifest → build →
# typecheck pipeline as CI, and a static runtime that contains only `dist/`.
# The runtime image has no Node, no npm, no source and no development
# dependencies — nothing to execute beyond nginx serving files.
#
# The base images are pinned to a minor version. Pin them to digests
# (`nginxinc/nginx-unprivileged@sha256:…`) before using this image anywhere
# that requires a reproducible supply chain.

# ---------------------------------------------------------------- build stage
FROM node:26.5-alpine AS build

WORKDIR /app

# Install from the committed lockfile only. `npm ci` fails rather than
# silently resolving a different tree, which is the property that makes the
# build reproducible. Scripts are disabled so no dependency's postinstall runs
# during the image build; Puppeteer's browser download is skipped for the same
# reason — the browser is only needed by the test tools, never by the build.
COPY package.json package-lock.json ./
ENV PUPPETEER_SKIP_DOWNLOAD=1
RUN npm ci --ignore-scripts

COPY . .

# Data validation and manifest generation run inside `npm run build`, so a
# container image can never be produced from data that does not validate.
# SOURCE_DATE_EPOCH, if supplied, pins the manifest timestamp and makes the
# whole artifact byte-reproducible:
#   docker build --build-arg SOURCE_DATE_EPOCH=1700000000 .
ARG SOURCE_DATE_EPOCH
ENV SOURCE_DATE_EPOCH=${SOURCE_DATE_EPOCH}
RUN npm run build

# -------------------------------------------------------------- runtime stage
# nginx-unprivileged runs as uid 101 and listens on 8080 without root.
FROM nginxinc/nginx-unprivileged:1.31-alpine AS runtime

# Its own config lives here; replace the default site with ours.
COPY --chown=101:101 deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build --chown=101:101 /app/dist /usr/share/nginx/html

USER 101

EXPOSE 8080

# The health path is also documented in deploy/nginx.conf and docs/DEPLOYMENT.md
# for orchestrators that configure probes outside the image.
# busybox wget, because the Alpine runtime deliberately has no curl.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:8080/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
