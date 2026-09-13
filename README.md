# Kevin & Melanie's Living Memory Archive

A private home for preserving the couple's memories, beginning with contributions from their wedding guests.

## Start here

- **Choose or claim work:** use the Notion [Memory Archive — Issues](https://app.notion.com/p/2d5a40baef85426a94bd059f7d0e2ce8) database for MVPs, status, ownership, dependencies, acceptance criteria, blockers, pull-request links, and evidence.
- **Understand the project:** open the [Notion project home](https://app.notion.com/p/3dad9739c6bc81ff89cbd713cddf08d1?pvs=204) and read [Preview plan.md](<Preview plan.md>) for scope, accepted architecture, module boundaries, and collaboration conventions.
- **Run the code:** use the local-development instructions below.

This is a learning project. Explain and agree on infrastructure, dependencies, and CI/CD before Ryan performs each hands-on setup step. Do not automatically create provider accounts, connect services, provision infrastructure, add dependencies, configure CI/CD, or deploy application changes without Ryan's explicit request.

## Local development

The prototype validates and echoes text requests and provides local selectable photo previews; **it does not save messages or photos**. Use test content only. Check the matching Notion issue for current progress and expected completion evidence.

### Prerequisites

- **Java 25**, matching `java.version` in [backend/pom.xml](backend/pom.xml), with `JAVA_HOME` pointing to the JDK directory and Java on `PATH`.
- **Maven 3.9.16 through the checked-in wrapper.** A fresh checkout can run `./mvnw` from `backend/` without separately installing the project's Maven version.
- **Node.js 24.21.0 LTS** and npm for the shared frontend runtime, matching the root [.nvmrc](.nvmrc) and the engine declared in [frontend/package.json](frontend/package.json). [frontend/package-lock.json](frontend/package-lock.json) remains authoritative for resolved packages.
- Docker with Compose for the optional local database; it is not required for the current echo flow.

Check the terminal toolchain:

```sh
java -version
./backend/mvnw --version
node --version
npm --version
```

If Maven reports an invalid `JAVA_HOME`, point it at the installed JDK directory, reopen the terminal, and repeat the checks. IDE Java settings alone do not configure Maven's terminal environment.

### Run the application

Run the documented commands in Git Bash. Paths and examples below use Bash syntax.

Install frontend dependencies from the lockfile:

```sh
npm --prefix frontend ci
```

Start Spring in one terminal - cd to backend:

```sh
./mvnw spring-boot:run
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

With the backend running, inspect responses from Git Bash:

```sh
curl --fail http://localhost:8080/api/health
curl --fail --request POST http://localhost:8080/api/contributions \
  --header 'Content-Type: application/json' \
  --data '{"guestName":"Test Guest","message":"Local test message"}'
```

The form currently logs successful responses in the browser console and has no saved confirmation. Photo files are not included in the text request.

### Checks

```sh
npm --prefix frontend run lint
npm --prefix frontend run build
./backend/mvnw test
```

These run ESLint, build the frontend into `frontend/dist/`, and run backend tests. There is no frontend `test` script or CI workflow yet. The only checked-in automated backend test is [HealthControllerTest.java](backend/src/test/java/com/kevinandmelanie/memoryarchive/health/HealthControllerTest.java).

**September 13 verification:** Ryan confirmed Java `25.0.3`, Maven `3.9.15`, Node `25.2.1`, npm `11.6.2`, and NVM for Windows `1.2.2` on his machine. The application has started locally, and the frontend lint/build checks passed during MED-02 verification. The repository now pins Maven `3.9.16` through the wrapper and Node `24.21.0` LTS through `.nvmrc`. Ryan switched to Node `24.21.0`; `npm ci`, frontend lint, and the production build completed successfully. The wrapper also ran the backend test suite successfully: one test passed with no failures or errors. Ryan explicitly waived the two-collaborator fresh-checkout criterion on September 13, completing FND-01.

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
| Dependency versions and executable build/test configuration | [POM](backend/pom.xml), [Maven wrapper properties](backend/.mvn/wrapper/maven-wrapper.properties), [frontend manifest](frontend/package.json), [lockfile](frontend/package-lock.json), and [.nvmrc](.nvmrc) |
| Detailed API contracts, architecture rationale, and operations | Dedicated repository documents created by their Notion issues and linked from the relevant issue |

Update information in its authoritative location and link to it elsewhere. When a topic moves into a dedicated document, replace its old explanation with a short summary and link instead of maintaining two copies.
