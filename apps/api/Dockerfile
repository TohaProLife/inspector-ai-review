FROM node:22-alpine@sha256:b64da1de5a51067ab8e75f0bc8dbd0905d8894baa22261f439a4572f41291e50
RUN apk add --no-cache poppler-utils=25.12.0-r1 font-liberation=2.1.5-r2 \
    && test "$(pdftotext -v 2>&1 | head -n 1)" = "pdftotext version 25.12.0" \
    && test "$(pdfinfo -v 2>&1 | head -n 1)" = "pdfinfo version 25.12.0" \
    && test -n "$(fc-match -f '%{file}' TimesNewRomanPSMT)"
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN npm ci
COPY tsconfig.base.json ./
COPY migrations migrations
COPY packages/contracts packages/contracts
COPY apps/api apps/api
EXPOSE 4100
CMD ["npm", "run", "start", "-w", "@inspector-ai/api"]
