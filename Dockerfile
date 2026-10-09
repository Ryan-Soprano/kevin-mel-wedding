# Combined React/Spring image; staging requires explicit runtime settings.
FROM node:24.21.0-bookworm-slim AS frontend-build
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
ARG VITE_AUDIO_ENABLED=false
ENV VITE_AUDIO_ENABLED=$VITE_AUDIO_ENABLED
RUN npm run build

FROM eclipse-temurin:25.0.4.1_1-jdk-noble AS backend-build
WORKDIR /build
COPY backend/ ./backend/
# Also tolerate older Windows checkouts whose wrapper still has CRLF.
RUN sed -i 's/\r$//' backend/mvnw \
    && chmod +x backend/mvnw \
    && ./backend/mvnw -f backend/pom.xml --batch-mode clean
COPY --from=frontend-build /build/frontend/dist/ ./backend/target/classes/static/
# The recorder spike is served only by the staging-profile controller.
COPY frontend/spikes/audio/*.html frontend/spikes/audio/*.js frontend/spikes/audio/*.css ./backend/target/classes/staging-audio/
RUN ./backend/mvnw -f backend/pom.xml --batch-mode -DskipTests package

FROM eclipse-temurin:25.0.4.1_1-jre-noble AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV SPRING_PROFILES_ACTIVE=staging
# Render SSH/dashboard shells require a named user, usable shell and private SSH home.
RUN groupadd --gid 10001 archive \
    && useradd --uid 10001 --gid archive --create-home \
        --home-dir /home/archive --shell /bin/bash archive \
    && install -d -o archive -g archive -m 0700 /home/archive/.ssh
COPY --from=backend-build --chown=10001:10001 \
    /build/backend/target/memory-archive-0.0.1-SNAPSHOT.jar /app/app.jar
USER 10001:10001
EXPOSE 10000
ENTRYPOINT ["java", "-Djava.awt.headless=true", "-jar", "/app/app.jar"]
