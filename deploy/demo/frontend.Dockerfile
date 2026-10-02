FROM node:22-alpine AS build
WORKDIR /ui
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.ts tsconfig*.json ./
COPY src ./src
COPY public ./public
RUN npm run build

FROM nginx:alpine
COPY deploy/demo/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /ui/dist /usr/share/nginx/html
COPY deploy/demo/runtime-config.js /usr/share/nginx/html/runtime-config.js
