FROM node:20-slim

RUN apt-get update && apt-get install -y python3 make g++ tzdata && rm -rf /var/lib/apt/lists/*

ENV TZ=America/Detroit

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY . .

RUN mkdir -p /app/data

EXPOSE 3000

CMD ["node", "server.js"]
