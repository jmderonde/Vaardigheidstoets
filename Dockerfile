FROM node:22-slim

WORKDIR /app
ENV NODE_ENV=production

# Eerst alleen de afhankelijkheden, zodat Docker deze laag kan cachen.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY src ./src
COPY public ./public

# Render stelt PORT zelf in; lokaal is 3000 de standaard.
EXPOSE 3000
RUN mkdir -p data && chown -R node:node /app/data
USER node
CMD ["node", "server.js"]
