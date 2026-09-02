FROM node:20-alpine AS base
WORKDIR /app

# Alpine ships no OpenSSL package by default - Prisma's query engine needs it
# both to detect which OpenSSL ABI is present (see schema.prisma binaryTargets)
# and to actually load at runtime.
RUN apk add --no-cache openssl

COPY package*.json ./
RUN npm ci --omit=dev

COPY prisma ./prisma
RUN npx prisma generate

COPY src ./src

EXPOSE 4000
CMD ["node", "src/server.js"]
