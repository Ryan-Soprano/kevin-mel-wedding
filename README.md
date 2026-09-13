# Kevin & Melanie's Living Memory Archive

A private home for preserving the couple's memories, beginning with contributions from their wedding guests.

## Start here

- **Choose or claim work:** use the Notion [Memory Archive — Issues](https://app.notion.com/p/2d5a40baef85426a94bd059f7d0e2ce8) database for MVPs, status, ownership, dependencies, acceptance criteria, blockers, pull-request links, and evidence.
- **Understand the project:** open the [Notion project home](https://app.notion.com/p/3dad9739c6bc81ff89cbd713cddf08d1?pvs=204) and read [Preview plan.md](<Preview plan.md>) for scope, accepted architecture, module boundaries, and collaboration conventions.
- **Run the code:** use the local-development instructions below.

This is a learning project. Explain and agree on infrastructure, dependencies, and CI/CD before Ryan performs each hands-on setup step. Do not automatically create provider accounts, connect services, provision infrastructure, add dependencies, configure CI/CD, or deploy application changes without Ryan's explicit request.

## Local development

The prototype validates and echoes text requests; **it does not save messages or photos**. Use test content only. Check the matching Notion issue for current progress and expected completion evidence.

### Prerequisites

- **Java 25**, matching `java.version` in [backend/pom.xml](backend/pom.xml), with `JAVA_HOME` pointing to the JDK directory and Java on `PATH`. Java 25 is the accepted baseline; the POM edit still needs to be committed and reviewed through the normal workflow.
- Maven on `PATH`; no Maven wrapper is checked in yet.
- **Node.js 24 LTS** and npm for the shared frontend runtime. [frontend/package-lock.json](frontend/package-lock.json) remains authoritative for resolved packages.
- Docker with Compose for the optional local database; it is not required for the current echo flow.

Check the terminal toolchain:

```sh
java -version
mvn -version
node --version
npm --version
```

If Maven reports an invalid `JAVA_HOME`, point it at the installed JDK directory, reopen the terminal, and repeat the checks. IDE Java settings alone do not configure Maven's terminal environment.

### Run the application

Run commands from the repository root in Git Bash or PowerShell. In PowerShell, use `npm.cmd` if execution policy prevents `npm.ps1` from running.

Install frontend dependencies from the lockfile:

```sh
npm --prefix frontend ci
```

Start Spring in one terminal - cd to backend:

```sh
mvn spring-boot:run
```

Start Vite in another - cd to frontend:

```sh
npm run dev
```

Open the Local URL Vite prints, normally [localhost:5173](http://localhost:5173/). The [Vite configuration](frontend/vite.config.js) forwards `/api` requests to Spring at [localhost:8080](http://localhost:8080). This proxy is for development; production routing is not configured. Stop each process with Ctrl+C.

### Current API behavior

These examples describe the prototype. Notion issue API-01 tracks the future durable contract; a successful echo is not a saved memory.

| Request | Current response |
|---|---|
| `GET /api/health` | HTTP 200 with `{"status":"ok"}`; does not check DB or storage |
| `POST /api/contributions` with JSON `guestName` and `message` | HTTP 200 with trimmed input; omitted/null name becomes an empty string |
| Contribution violating request-field validation | HTTP 400 with `{"errors":["validation message"]}` |

Name is optional with a 100-character limit; message is required, nonblank, and limited to 5,000 characters. Backend validation occurs before service trimming. Exact constraints and normalization live in [ContributionRequest.java](backend/src/main/java/com/kevinandmelanie/memoryarchive/contribution/ContributionRequest.java) and [ContributionService.java](backend/src/main/java/com/kevinandmelanie/memoryarchive/contribution/ContributionService.java).

With the backend running, inspect responses in PowerShell:

```powershell
Invoke-RestMethod -Uri 'http://localhost:8080/api/health'
Invoke-RestMethod -Uri 'http://localhost:8080/api/contributions' -Method Post -ContentType 'application/json' -Body '{"guestName":"Test Guest","message":"Local test message"}'
```

The form currently logs successful responses in the browser console and has no saved confirmation. Photo files are not included in the text request.

### Checks

```sh
npm --prefix frontend run lint
npm --prefix frontend run build
mvn -f backend/pom.xml test
```

These run ESLint, build the frontend into `frontend/dist/`, and run backend tests. There is no frontend `test` script or CI workflow yet. The only checked-in automated backend test is [HealthControllerTest.java](backend/src/test/java/com/kevinandmelanie/memoryarchive/health/HealthControllerTest.java).

**September 13 review:** commands were checked against source and configuration. Node `v25.8.0` and npm `11.11.0` were available in that session, though Node 24 LTS is now the accepted team baseline. Maven's version check failed with an invalid `JAVA_HOME`; Java and Docker were not discoverable on the review session's `PATH`, and `frontend/node_modules/` was absent. Build, lint, API runtime, and database checks were not rerun. An existing local September 11 health-test report records one pass; it is historical evidence rather than a fresh result for this checkout.

### Optional local PostgreSQL

[compose.yaml](compose.yaml) defines the database service, local credentials, published port, named data volume, and health check. Spring is **not connected**: [application.properties](backend/src/main/resources/application.properties) only sets the app name, and the POM has no database driver, JdbcClient, or migration dependency.

When Docker is available, start and inspect the database:

```sh
docker compose up -d postgres
docker compose ps
docker compose port postgres 5432
```

The saved binding is `127.0.0.1:5433` to container port `5432`. A previous README proposed `5434` after a conflict; that change is not in the saved configuration. Verify the actual binding before writing a JDBC URL. Change Compose and eventual application connection settings together if a different port is needed.

Compose's `POSTGRES_DB`, `POSTGRES_USER`, and `POSTGRES_PASSWORD` values are local-development defaults only. Application datasource variables have not been introduced. Git shares source and configuration, not database contents.

Stop the containers while keeping the named data volume:

```sh
docker compose down
```

## Repository navigation

| Location | Responsibility |
|---|---|
| [Memory Archive — Issues](https://app.notion.com/p/2d5a40baef85426a94bd059f7d0e2ce8) | MVPs, decisions, status, ownership, dependencies, acceptance criteria, and evidence |
| [frontend/](frontend/) | React/Vite app; see its [source map](frontend/README.md) |
| [backend/src/main/java/com/kevinandmelanie/memoryarchive/](backend/src/main/java/com/kevinandmelanie/memoryarchive/) | Spring app and current contribution, health, and web packages |
| [backend/src/test/](backend/src/test/) | Backend tests |
| [compose.yaml](compose.yaml) | Local database configuration |
| [Preview plan.md](<Preview plan.md>) | Product scope, accepted architecture, and collaboration conventions |
| [Feature tracker.md](<Feature tracker.md>) | Migration pointer to Notion; do not maintain task status here |

Work in small, explained increments. Claim work in Notion and use `feature/<description>` for new feature branches. The current branch does not assign tasks. Commit or push only when explicitly requested.

## Where information belongs

| Information | Authoritative location |
|---|---|
| Introduction and setup, run, and check instructions | This README |
| Scope, accepted architecture, module boundaries, and collaboration conventions | [Project plan](<Preview plan.md>) |
| MVPs, decisions, backlog, status, ownership, dependencies, acceptance criteria, blockers, and evidence | [Notion issue database](https://app.notion.com/p/2d5a40baef85426a94bd059f7d0e2ce8) |
| Dependency versions and executable build/test configuration | [POM](backend/pom.xml), [frontend manifest](frontend/package.json), [lockfile](frontend/package-lock.json), and future runtime pins |
| Detailed API contracts, architecture rationale, and operations | Dedicated repository documents created by their Notion issues and linked from the relevant issue |

Update information in its authoritative location and link to it elsewhere. When a topic moves into a dedicated document, replace its old explanation with a short summary and link instead of maintaining two copies.
