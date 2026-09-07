FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps/web/package.json apps/web/package.json
COPY apps/server/package.json apps/server/package.json
RUN npm install
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm install --omit=dev
COPY --from=build /app/apps/server ./apps/server
COPY --from=build /app/apps/web/dist ./apps/web/dist
EXPOSE 3000
CMD ["npm", "start"]
