FROM docker.io/nginxinc/nginx-unprivileged:1.27-alpine

LABEL org.opencontainers.image.title="CHROMA RUSH" \
      org.opencontainers.image.description="Neon arena survival - zero dependencies, canvas + WebAudio only" \
      org.opencontainers.image.source="https://github.com/gamosoft/chroma-rush"

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html style.css game.js /usr/share/nginx/html/

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1
