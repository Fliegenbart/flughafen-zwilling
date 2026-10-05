FROM node:22-alpine AS build
ARG TWIN_UI_BASE_PATH=/
ENV TWIN_UI_BASE_PATH=$TWIN_UI_BASE_PATH
WORKDIR /ui
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.ts tsconfig*.json ./
COPY src ./src
COPY public ./public
RUN npm run build

FROM nginx:alpine
ARG TWIN_RUNTIME_CONFIG=deploy/demo/runtime-config.js
ARG TWIN_NGINX_CONFIG=deploy/demo/nginx.conf
COPY ${TWIN_NGINX_CONFIG} /etc/nginx/conf.d/default.conf
COPY --from=build /ui/dist /usr/share/nginx/html
COPY ${TWIN_RUNTIME_CONFIG} /usr/share/nginx/html/runtime-config.js
