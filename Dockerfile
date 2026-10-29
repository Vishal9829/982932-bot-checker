FROM node:20-alpine

WORKDIR /app

# Install Lightpanda browser engine
RUN apk add --no-cache curl python3
RUN curl -fsSL https://pkg.lightpanda.io/install.sh | bash
ENV PATH="/root/.local/bin:$PATH"

COPY package*.json ./
RUN npm install --production

COPY . .

EXPOSE 3000

CMD lightpanda serve & node server.js
