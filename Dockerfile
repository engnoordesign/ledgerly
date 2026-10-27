# Ledgerly server (app + encrypted sync). Build:  docker build -t ledgerly .
# Run:  docker run -p 8787:8787 -v ledgerly-data:/data -e LEDGERLY_SIGNUP=invite -e LEDGERLY_INVITE=choose-a-secret ledgerly
# Put it behind HTTPS (a hosting platform or reverse proxy): browsers only enable encryption on HTTPS pages.
FROM node:22-alpine
WORKDIR /app
COPY index.html ./
COPY css ./css
COPY js ./js
COPY assets ./assets
COPY server ./server
RUN mkdir /data && chown node:node /data
ENV LEDGERLY_DATA=/data LEDGERLY_HOST=0.0.0.0 PORT=8787 LEDGERLY_TRUST_PROXY=1
VOLUME /data
EXPOSE 8787
USER node
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8787/api/health || exit 1
CMD ["node", "server/server.js"]
