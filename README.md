# Kevin & Melanie's Living Memory Archive

A private home for preserving the couple's memories, beginning with contributions from their wedding guests.

## Start here

- **Choose or claim work:** use the Notion [Memory Archive — Issues](https://app.notion.com/p/2d5a40baef85426a94bd059f7d0e2ce8) database for MVPs, status, ownership, dependencies, acceptance criteria, blockers, pull-request links, and evidence.
- **Understand the project:** open the [Notion project home](https://app.notion.com/p/3dad9739c6bc81ff89cbd713cddf08d1?pvs=204) and read the [project plan](docs/project-plan.md) for scope, accepted architecture, module boundaries, and collaboration conventions.
- **Run the code:** use the local-development instructions below.

This is a learning project. Explain and agree on infrastructure, dependencies, and CI/CD before Ryan performs each hands-on setup step. Do not automatically create provider accounts, connect services, provision infrastructure, add dependencies, configure CI/CD, or deploy application changes without Ryan's explicit request.

## Local development

The prototype validates and echoes text requests and provides local selectable photo previews; **it does not save messages or photos**. Use test content only. Check the matching Notion issue for current progress and expected completion evidence.

### Prerequisites

- **Java 25**, matching `java.version` in [backend/pom.xml](backend/pom.xml), with `JAVA_HOME` pointing to the JDK directory and Java on `PATH`.
- **Maven 3.9.16 through the checked-in wrapper.** A fresh checkout can run `./mvnw` from `backend/` without separately installing the project's Maven version.
- **Node.js 24.21.0 LTS** and npm for the shared frontend runtime, matching the root [.nvmrc](.nvmrc) and the engine declared in [frontend/package.json](frontend/package.json). [frontend/package-lock.json](frontend/package-lock.json) remains authoritative for resolved packages.
- Docker with Compose for the local PostgreSQL database used by Spring.

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

Start PostgreSQL from the repository root:

```sh
docker compose up -d postgres
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
./backend/mvnw -f backend/pom.xml test
```

These run ESLint, build the frontend into `frontend/dist/`, and run backend tests. There is no frontend `test` script yet. [The CI workflow](.github/workflows/ci.yml) runs parallel backend and frontend jobs for every pull request and every push to `main`: the backend job uses Java 25 and the Maven wrapper, while the frontend job uses the Node version in `.nvmrc`, installs from `package-lock.json`, runs ESLint, and builds the production bundle. Backend database integration tests use Testcontainers to start a disposable PostgreSQL 17 database, apply the Flyway migrations, exercise persistence behavior, and discard the test database afterward. Docker Desktop must be running for those tests locally; GitHub-hosted runners provide the Docker environment used by CI.

**September 13 verification:** Ryan confirmed Java `25.0.3`, Maven `3.9.15`, Node `25.2.1`, npm `11.6.2`, and NVM for Windows `1.2.2` on his machine. The application has started locally, and the frontend lint/build checks passed during MED-02 verification. The repository now pins Maven `3.9.16` through the wrapper and Node `24.21.0` LTS through `.nvmrc`. Ryan switched to Node `24.21.0`; `npm ci`, frontend lint, and the production build completed successfully. The wrapper also ran the backend test suite successfully: one test passed with no failures or errors. Ryan explicitly waived the two-collaborator fresh-checkout criterion on September 13, completing FND-01.

**September 27 CI verification:** PR #5 passed the backend and frontend jobs. A separate disposable pull request introduced an intentional frontend syntax error; the backend job stayed green, ESLint failed with exit code 1, and the frontend build was correctly prevented from running. The disposable pull request was closed without merging.

### Local PostgreSQL

[compose.yaml](compose.yaml) defines the local PostgreSQL service, credentials, published port, named data volume, and health check. Spring reads its datasource settings from [application.properties](backend/src/main/resources/application.properties). Flyway applies the versioned migrations in [backend/src/main/resources/db/migration/](backend/src/main/resources/db/migration/) when the application starts.

Start and inspect PostgreSQL from the repository root:

```sh
docker compose up -d postgres
docker compose ps postgres
docker compose port postgres 5432
docker compose exec postgres pg_isready \
  -U memory_archive \
  -d memory_archive
```

The default JDBC connection is `jdbc:postgresql://127.0.0.1:5433/memory_archive`. The application accepts `MEMORY_ARCHIVE_DB_URL`, `MEMORY_ARCHIVE_DB_USERNAME`, and `MEMORY_ARCHIVE_DB_PASSWORD` environment-variable overrides. The saved Compose credentials are for local development only.

Flyway records every successfully applied migration in `flyway_schema_history`. Inspect that history with:

```sh
docker compose exec postgres psql \
  -U memory_archive \
  -d memory_archive \
  -c 'SELECT installed_rank, version, description, success FROM flyway_schema_history ORDER BY installed_rank;'
```

After a migration has been applied, treat its SQL file as immutable. Make later schema changes in a new migration such as `V2__describe_the_change.sql`. This lets collaborators receive the same schema changes through Git without sharing one physical database.

Stop PostgreSQL while preserving its named data volume:

```sh
docker compose down
```

To deliberately delete all local database data and recreate an empty database, run:

```sh
docker compose down --volumes
docker compose up -d postgres
```

The `--volumes` command permanently deletes this project's local PostgreSQL data. The next Spring startup rebuilds the schema by applying the committed Flyway migrations.

The repository can atomically save a contribution and its text memory, but the public contribution endpoint still has prototype echo behavior. API-01 will define the durable request and idempotency contract before that repository is wired into the controller.

## Repository navigation

| Location | Responsibility |
|---|---|
| [Memory Archive — Issues](https://app.notion.com/p/2d5a40baef85426a94bd059f7d0e2ce8) | MVPs, decisions, status, ownership, dependencies, acceptance criteria, and evidence |
| [frontend/](frontend/) | React/Vite app; see its [source map](frontend/README.md) |
| [backend/src/main/java/com/kevinandmelanie/memoryarchive/](backend/src/main/java/com/kevinandmelanie/memoryarchive/) | Spring app and current contribution, health, and web packages |
| [backend/src/test/](backend/src/test/) | Backend tests |
| [docs/](docs/) | Architecture, API contracts, decision records, and operational runbooks |
| [compose.yaml](compose.yaml) | Local database configuration |
| [docs/project-plan.md](docs/project-plan.md) | Product scope, accepted architecture, and collaboration conventions |
| [Feature tracker.md](<Feature tracker.md>) | Migration pointer to Notion; do not maintain task status here |

Work in small, explained increments. Claim work in Notion and use `feature/<description>` for new feature branches. The current branch does not assign tasks. Commit or push only when explicitly requested.

## Where information belongs

| Information | Authoritative location |
|---|---|
| Introduction and setup, run, and check instructions | This README |
| Scope, accepted architecture, module boundaries, and collaboration conventions | [Project plan](docs/project-plan.md) |
| MVPs, decisions, backlog, status, ownership, dependencies, acceptance criteria, blockers, and evidence | [Notion issue database](https://app.notion.com/p/2d5a40baef85426a94bd059f7d0e2ce8) |
| Dependency versions and executable build/test configuration | [POM](backend/pom.xml), [Maven wrapper properties](backend/.mvn/wrapper/maven-wrapper.properties), [frontend manifest](frontend/package.json), [lockfile](frontend/package-lock.json), and [.nvmrc](.nvmrc) |
| Detailed API contracts, architecture rationale, and operations | The matching folder under [docs/](docs/) and the relevant Notion issue |

Update information in its authoritative location and link to it elsewhere. When a topic moves into a dedicated document, replace its old explanation with a short summary and link instead of maintaining two copies.
