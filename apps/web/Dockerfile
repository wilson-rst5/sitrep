FROM node:24-alpine AS builder
WORKDIR /app
COPY apps/web/package*.json ./
RUN npm ci
COPY apps/web .
ARG SITREP_VERSION=development
ARG SITREP_BUILD_SHA=local
ENV VITE_SITREP_VERSION=$SITREP_VERSION VITE_SITREP_BUILD=$SITREP_BUILD_SHA
ARG MAP_STYLE_URL
ARG MAP_LIGHT_STYLE_URL
ARG MAP_DARK_STYLE_URL
ARG MAP_FALLBACK_STYLE_URL
ENV VITE_MAP_STYLE_URL=$MAP_STYLE_URL VITE_MAP_LIGHT_STYLE_URL=$MAP_LIGHT_STYLE_URL     VITE_MAP_DARK_STYLE_URL=$MAP_DARK_STYLE_URL VITE_MAP_FALLBACK_STYLE_URL=$MAP_FALLBACK_STYLE_URL
RUN npm run build
ADD --checksum=sha256:6866c877d39cba9c357620878839b336d569f8c662d3cfab4cb1dbe2d39c977f https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_110m_admin_0_countries.geojson /tmp/countries.geojson
RUN node --input-type=module -e 'import fs from "node:fs"; const data = JSON.parse(fs.readFileSync("/tmp/countries.geojson", "utf8")); fs.writeFileSync("dist/countries.geojson", JSON.stringify({ type: "FeatureCollection", features: data.features.map(({type, geometry}) => ({type, geometry, properties: {}})) }));'

FROM nginxinc/nginx-unprivileged:alpine
COPY infrastructure/proxy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
