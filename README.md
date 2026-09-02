# Kevin & Melanie's Memory Archive

A private living memory archive for photographs, messages, audio, video, and
other meaningful records from Kevin and Melanie's life together.

The first release will support collecting and privately moderating written
messages and photographs from wedding guests on October 24, 2026.

## Current milestone

The first walking-skeleton step is a Spring Boot health endpoint:

```text
GET /api/health
200 OK
{"status":"ok"}
```

## Repository structure

```text
backend/    Spring Boot REST API
frontend/   React application (added in a later step)
```

## Run the backend

The project targets Java 21 or newer. From the `backend` directory:

```powershell
mvn spring-boot:run
```

Then open <http://localhost:8080/api/health>.

Run the automated tests with:

```powershell
mvn test
```

