# 1단계: 의존성 설치 + client 빌드 (server는 tsx로 TS를 그대로 실행하므로 빌드 불필요)
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY client/package.json ./client/package.json
COPY server/package.json ./server/package.json
RUN npm ci
COPY client ./client
COPY server ./server
# 빌드 시점에 client 번들에 박아넣을 값 — 비워두면 client/src/colyseus.ts가 같은 origin으로
# 접속한다(권장, nip.io 주소가 EC2 재시작마다 바뀌어도 재빌드가 필요 없다).
ARG VITE_COLYSEUS_URL=
ENV VITE_COLYSEUS_URL=$VITE_COLYSEUS_URL
RUN npm run build --workspace client

# 2단계: 런타임 — server 소스 + node_modules + client 빌드 결과만 남긴다
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server ./server
COPY --from=build /app/client/dist ./server/public
EXPOSE 2567
CMD ["npm", "run", "start", "--workspace", "server"]
