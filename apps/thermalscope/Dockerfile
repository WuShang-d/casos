# syntax=docker/dockerfile:1
FROM --platform=$BUILDPLATFORM node:20-alpine AS web
WORKDIR /src
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile
COPY index.html vite.config.js tailwind.config.js postcss.config.js ./
COPY src/ ./src/
COPY public/ ./public/
RUN yarn build

FROM --platform=$BUILDPLATFORM golang:1.24-alpine AS backend
RUN apk add --no-cache python3
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY server/ ./server/
COPY scripts/build-runner.py ./scripts/build-runner.py
COPY scripts/runner/ ./scripts/runner/
RUN python3 scripts/build-runner.py
ARG TARGETOS=linux
ARG TARGETARCH=amd64
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -ldflags="-s -w" -o /thermalscope ./server

FROM scratch
COPY --from=backend /thermalscope /thermalscope
COPY --from=web /src/build/ /app/build/
COPY LICENSE NOTICE /licenses/
COPY third_party/licenses/ /licenses/dependencies/
COPY --chown=65532:65532 packaging/data/ /data/
VOLUME ["/data"]
LABEL org.opencontainers.image.title="ThermalScope visualization" org.opencontainers.image.version="0.1.0" org.opencontainers.image.licenses="Apache-2.0"
ENV THERMALSCOPE_ADDR=:8080 THERMALSCOPE_DATA_DIR=/data/jobs THERMALSCOPE_ENABLE_JOBS=true
USER 65532:65532
EXPOSE 8080
ENTRYPOINT ["/thermalscope"]
