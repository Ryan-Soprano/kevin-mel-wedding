# Kevin & Melanie's Living Memory Archive

A private home for preserving the couple's memories, beginning with contributions from their wedding guests.

## Start here

- **Choose or claim work:** use the Notion [Memory Archive — Issues](https://app.notion.com/p/2d5a40baef85426a94bd059f7d0e2ce8) database for MVPs, status, ownership, dependencies, acceptance criteria, blockers, pull-request links, and evidence.
- **Understand the project:** open the [Notion project home](https://app.notion.com/p/3dad9739c6bc81ff89cbd713cddf08d1?pvs=204) and read the [project plan](docs/project-plan.md) for scope, accepted architecture, module boundaries, and collaboration conventions.
- **Run the code:** use the local-development instructions below.

This is a learning project. Explain and agree on infrastructure, dependencies, and CI/CD before Ryan performs each hands-on setup step. Do not automatically create provider accounts, connect services, provision infrastructure, add dependencies, configure CI/CD, or deploy application changes without Ryan's explicit request.

## Local development

The application saves named or anonymous text messages privately in PostgreSQL and returns committed receipts with safe same-key retries. Photo selection remains a local preview; **photos are not uploaded or saved**. Use synthetic content during local development. Production collection still requires the security, operations, and release work tracked in Notion.

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

The [v1 API contract](docs/api/v1/README.md) is authoritative. The development proxy preserves the browser Host header for same-origin submission checks. The wedding form uses the durable real adapter; synthetic preview scenarios use an isolated mock.

| Request | Current response |
|---|---|
| GET /api/health | HTTP 200 with status ok; not a database readiness check |
| POST /api/contributions | HTTP 201 after commit, HTTP 200 for an equivalent same-key replay; IDs/states only |
| GET /api/contributions/{contributionId}/receipt | HTTP 200 with current states when both ID and retry key match; otherwise safe 404 |
| Invalid text or retry key | HTTP 400 VALIDATION_FAILED with safe field errors where applicable |
| Missing/unsupported contract version | HTTP 400 UNSUPPORTED_CONTRACT |
| Same key with changed normalized content | HTTP 409 IDEMPOTENCY_CONFLICT |
| Database/commit failure | HTTP 503 SERVICE_UNAVAILABLE; never a false saved acknowledgment |

Send X-Api-Contract: 1 and a random UUID-v4 Idempotency-Key. The server canonicalizes UUID case. Names are optional (blank becomes null), at most 100 raw UTF-16 units; messages are required/nonblank, at most 5,000 raw units. Outer whitespace follows JavaScript String.trim(), including NBSP; internal whitespace is retained. NUL and unpaired surrogates are rejected. Unknown fields and wrong types are rejected. State/event/IDs belong to the server.

With the backend running, inspect synthetic responses from Git Bash. Generate the key once and retain it for retries of this exact message:

~~~sh
submission_key=$(node -e 'process.stdout.write(crypto.randomUUID())')
curl --fail http://localhost:8080/api/health
curl --fail-with-body --request POST http://localhost:8080/api/contributions \
  --header 'Content-Type: application/json' \
  --header 'X-Api-Contract: 1' \
  --header "Idempotency-Key: $submission_key" \
  --data '{"guestName":"Test Guest","message":"Local test message"}'
~~~

Use the same POST/body/key after a lost response; do not generate another key. If the returned contributionId is known, GET its receipt with the same two headers. Receipts contain no guest content or private retrieval links, and responses use Cache-Control: no-store.

The form confirms saved only after a valid complete receipt. It retains the original draft/key for deliberate retry, locks text editing while the outcome is uncertain, honors Retry-After, and requires **Write another message** before creating a new logical submission. Retry state is in memory: keep the page open until confirmed; refresh/tab closure does not preserve it. Guest payloads and errors are not logged to the browser console. Photo selections are not included in text requests.

### Checks

```sh
npm --prefix frontend run lint
npm --prefix frontend test
npm --prefix frontend run build
./backend/mvnw -f backend/pom.xml test
```

These run ESLint, frontend API-contract tests (Node's built-in runner, no new dependency), the production build into `frontend/dist/`, and backend tests. [CI](.github/workflows/ci.yml) runs parallel backend/frontend jobs for every PR and push to `main`: Java 25/Maven backend tests and Node from `.nvmrc` with lockfile install, lint, build, and frontend tests. Backend database tests use Testcontainers to start disposable PostgreSQL 17, apply Flyway migrations, exercise persistence, and discard the test database. Docker Desktop must run locally; GitHub-hosted runners provide CI's Docker environment.

For synthetic failure/retry demonstrations, start Vite and open [the contract preview](http://localhost:5173/contract-preview.html) using Vite's actual port. It needs no backend. The clearly labeled mock is isolated from the wedding form and excluded from the normal production build. Refreshing clears its state; nothing entered there is saved.

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

After a migration has been applied, treat its SQL file as immutable. Make later schema changes in a new migration with the next unused version. This lets collaborators receive the same schema changes through Git without sharing one physical database.

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

V2 adds an immutable SHA-256 creation fingerprint without rewriting V1. It backfills normalized single-text V1 envelopes without changing their stored content or IDs; other legacy keys remain reserved. PostgreSQL unique-key arbitration and one transaction prevent duplicate memories and orphan envelopes. Tests cover fresh schema, populated V1 upgrade, migration rerun, real HTTP concurrency, insert/commit rollback, database outage, and application restart against the same test database. See [MSG-01 verification](docs/api/v1/text-verification.md) for the evidence and remaining boundaries.

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
