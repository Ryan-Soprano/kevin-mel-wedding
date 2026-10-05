# Combined React/Spring image; staging requires explicit runtime settings.
FROM node:24.21.0-bookworm-slim AS frontend-build
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM eclipse-temurin:25.0.4.1_1-jdk-noble AS backend-build
WORKDIR /build
COPY backend/ ./backend/
# Also tolerate older Windows checkouts whose wrapper still has CRLF.
RUN sed -i 's/\r$//' backend/mvnw \
    && chmod +x backend/mvnw \
    && ./backend/mvnw -f backend/pom.xml --batch-mode clean
COPY --from=frontend-build /build/frontend/dist/ ./backend/target/classes/static/
RUN ./backend/mvnw -f backend/pom.xml --batch-mode -DskipTests package

FROM eclipse-temurin:25.0.4.1_1-jre-noble AS runtime
WORKDIR /app
ENV SPRING_PROFILES_ACTIVE=staging
COPY --from=backend-build --chown=10001:10001 \
    /build/backend/target/memory-archive-0.0.1-SNAPSHOT.jar /app/app.jar
USER 10001:10001
EXPOSE 10000
ENTRYPOINT ["java", "-Djava.awt.headless=true", "-jar", "/app/app.jar"]
