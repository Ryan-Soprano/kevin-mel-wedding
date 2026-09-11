# Kevin & Melanie's Memory Archive

A private living memory archive for Kevin and Melanie.
The wedding reception on October 24, 2026 is the first collection event.

## Current milestone: Foundation and guest contribution form

Implemented:
- React guest form with optional name and required message
- Name limit of 100 characters and message limit of 5,000 characters
- Character counter, submission progress state, and error feedback
- Basic responsive layout
- Spring Boot health endpoint
- Contribution controller, service, and request validation
- Structured validation errors displayed by React
- Docker Compose configuration for local PostgreSQL

Submissions are currently validated, normalized, and echoed back.
Nothing is saved. The application is not ready to collect real memories.

## Project structure

- frontend/ — React with JavaScript and Vite
- backend/ — Spring Boot REST API
- compose.yaml — local PostgreSQL configuration

## Development prerequisites

- JDK 21-compatible toolchain (tested with JDK 25)
- Maven (tested with 3.9.16)
- Node.js compatible with the project's Vite version and npm
- Docker Desktop and Docker Compose for the database milestone

## Run the application

Run commands from the project root in Git Bash.

Install frontend dependencies after cloning:

```bash
npm --prefix frontend ci
```

Start the backend in one terminal:

```bash
mvn -f backend/pom.xml spring-boot:run
```

Start the frontend in another:

```bash
npm --prefix frontend run dev
```

Open the Local URL printed by Vite, normally http://localhost:5173/.

Vite forwards /api requests to Spring Boot at http://localhost:8080.
This proxy configuration applies to local development.

PostgreSQL is not required for the current echo-only application.

## Current API behavior

- GET /api/health returns HTTP 200 with {"status":"ok"}.
- POST /api/contributions accepts guestName and message.
- Valid submissions return HTTP 200 with normalized input.
- Invalid submissions return HTTP 400 with an errors array.
- No contribution records are persisted.

## Checks

```bash
npm --prefix frontend run lint
npm --prefix frontend run build
mvn -f backend/pom.xml test
```

These checks passed at the foundation milestone.
The automated backend test currently covers the health endpoint.
Contribution requests and validation were checked manually.

## Database setup: pending home-computer work

Spring Boot has not been connected to PostgreSQL.

The saved compose.yaml currently specifies host port 5433.
That port conflicted on the development computer. Port 5434 was
proposed, but the saved configuration and actual published port
must be checked at home before configuring Spring Boot.

The Compose credentials are local-development defaults only.

Git shares configuration and source code between computers.
Local database contents are separate and are not synchronized by Git.

## Next milestone: Save written contributions

- Verify the home computer's toolchain and database port
- Connect Spring Boot to PostgreSQL
- Add versioned schema migrations and persistence
- Preserve submission grouping and individually reviewable items
- Default each submitted item to pending moderation and private visibility
- Confirm success to guests only after persistence succeeds

Keeping an item must not automatically publish it.

Later milestones include photo uploads, secure couple login,
private moderation, and deployment preparation.

## Collaboration preferences

Work in small, explained steps.
The developer makes file edits and runs commands, including Git commands.