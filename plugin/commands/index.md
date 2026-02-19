---
description: Index codebase into Supermemory for persistent context
allowed-tools: ["Read", "Glob", "Grep", "Bash", "Task"]
---

# Codebase Indexing

Explore this codebase deeply and compile findings into Supermemory.

## Phase 0: Detect Ecosystem

Before anything else, determine the primary tech stack by checking which manifest files exist:

```
Glob for these patterns at the repo root (and one level deep):
*.sln, *.csproj, Directory.Build.props, global.json    → .NET/C#
package.json                                            → JS/TS
Cargo.toml                                              → Rust
pyproject.toml, setup.py, requirements.txt              → Python
go.mod                                                  → Go
pom.xml, build.gradle, build.gradle.kts                 → Java/Kotlin
Gemfile                                                 → Ruby
composer.json                                           → PHP
Package.swift                                           → Swift
mix.exs                                                 → Elixir
```

Note the detected ecosystem(s). A repo may use multiple (e.g., a JS frontend + Go backend). Use the **Ecosystem Reference** below to guide all subsequent phases.

---

## Ecosystem Reference

Use this table based on the ecosystem(s) detected in Phase 0. For each phase, look up what to search for.

### Manifest & Config Files (Phase 1)

| Ecosystem | Manifests | Config Files |
|-----------|-----------|-------------|
| **.NET/C#** | `*.sln`, `*.csproj`, `Directory.Build.props`, `Directory.Packages.props`, `global.json`, `nuget.config` | `appsettings.json`, `appsettings.*.json`, `launchSettings.json`, `.editorconfig` |
| **JS/TS** | `package.json`, `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml` | `tsconfig.json`, `.eslintrc*`, `vite.config.*`, `next.config.*`, `webpack.config.*` |
| **Rust** | `Cargo.toml`, `Cargo.lock` | `rust-toolchain.toml`, `.cargo/config.toml` |
| **Python** | `pyproject.toml`, `setup.py`, `setup.cfg`, `requirements*.txt`, `Pipfile` | `tox.ini`, `pytest.ini`, `.flake8`, `mypy.ini` |
| **Go** | `go.mod`, `go.sum` | `.golangci.yml` |
| **Java/Kotlin** | `pom.xml`, `build.gradle`, `build.gradle.kts`, `settings.gradle*` | `application.properties`, `application.yml`, `logback.xml` |
| **Ruby** | `Gemfile`, `Gemfile.lock`, `*.gemspec` | `config/database.yml`, `config/routes.rb`, `.rubocop.yml` |
| **PHP** | `composer.json`, `composer.lock` | `.env`, `config/*.php`, `phpunit.xml` |

### Entry Points & Architecture (Phase 2)

| Ecosystem | Entry Points | Architectural Patterns to Find |
|-----------|-------------|-------------------------------|
| **.NET/C#** | `Program.cs`, `Startup.cs` | DI registrations (`IServiceCollection`), middleware pipeline (`app.Use*`), Controllers or Minimal API endpoints, `DbContext` subclasses, project references in `*.csproj` |
| **JS/TS** | `index.ts`, `main.ts`, `App.tsx`, `server.ts` | Route definitions, React/Vue/Svelte components, API handlers, module exports |
| **Rust** | `main.rs`, `lib.rs` | `mod.rs` modules, trait definitions, `impl` blocks, feature flags in `Cargo.toml` |
| **Python** | `main.py`, `app.py`, `__main__.py`, `wsgi.py`, `asgi.py` | Decorators (`@app.route`, `@router`), `__init__.py` structure, ORM models, management commands |
| **Go** | `main.go`, `cmd/*/main.go` | Interface definitions, package structure, handler functions, middleware chains |
| **Java/Kotlin** | `*Application.java`, `Main.java`, `App.kt` | `@SpringBootApplication`, `@RestController`, `@Service`, `@Repository` annotations, dependency injection |
| **Ruby** | `config.ru`, `app/controllers/application_controller.rb` | Rails MVC structure (`app/models`, `app/controllers`, `app/views`), routes, migrations, gems |
| **PHP** | `public/index.php`, `artisan` | Laravel service providers, routes (`routes/web.php`, `routes/api.php`), Eloquent models, middleware |

### Conventions & Patterns (Phase 3)

| Ecosystem | What to Look For |
|-----------|-----------------|
| **.NET/C#** | Namespace-per-folder structure, `src/`/`tests/` split, `IOptions<T>` configuration pattern, attribute-based routing, extension method conventions (`*Extensions.cs`) |
| **JS/TS** | Import style (ESM vs CJS), component file naming, barrel exports (`index.ts`), path aliases, monorepo structure |
| **Rust** | Module hierarchy, error handling patterns (`Result`, `?`), derive macro usage, visibility modifiers |
| **Python** | Package structure, type hint usage, decorator patterns, test organization (`tests/`), linter/formatter choice |
| **Go** | Package naming, error return patterns, interface placement, table-driven tests |
| **Java/Kotlin** | Package hierarchy, annotation usage, builder patterns, DTO/entity separation |
| **Ruby** | Rails conventions (CoC), concern modules, service objects, RSpec vs Minitest |
| **PHP** | PSR standards, namespace structure, facade usage, artisan commands |

### Key Files to Read (Phase 4)

| Ecosystem | Important Files & Patterns |
|-----------|--------------------------|
| **.NET/C#** | `ServiceCollectionExtensions` or DI setup, middleware classes, `DbContext` + migrations, `AutoMapper`/`Mapster` profiles, `MediatR` handlers, `appsettings.json` structure |
| **JS/TS** | Auth middleware, database client setup, API client wrappers, shared utilities, state management (Redux store, Context providers) |
| **Rust** | Error types, trait implementations, build scripts (`build.rs`), integration test structure |
| **Python** | Settings/config module, ORM models, serializers, middleware, celery tasks, management commands |
| **Go** | HTTP handlers, database layer, middleware, config loading, wire/dependency injection |
| **Java/Kotlin** | Security config, JPA entities, repository interfaces, service layer, exception handlers |
| **Ruby** | ApplicationController, model validations/callbacks, initializers, service objects, background jobs |
| **PHP** | Service providers, form requests, policies, event/listener pairs, scheduled tasks |

---

## Phase 1: Project Overview

Read and note the manifest and config files identified by the Ecosystem Reference above, plus:
- `README.md`
- CI/CD config (`.github/workflows/`, `Jenkinsfile`, `.gitlab-ci.yml`, etc.)
- Docker files (`Dockerfile`, `docker-compose.yml`)

Gather: project name, purpose, tech stack, how to run/build/test

## Phase 2: Architecture

Explore and note:
- Use Glob to understand folder structure
- Find entry points per the Ecosystem Reference
- Identify the architectural patterns listed for the detected ecosystem
- Look for API routes/endpoints, database models/entities, and data flow

Gather: architecture, key modules, data flow

## Phase 3: Conventions

Analyze and note:
- Ecosystem-specific conventions from the reference table
- Naming conventions (files, classes, functions, variables)
- File organization and project structure patterns
- Git history: `git log --oneline -20`

Gather: coding conventions, patterns to follow

## Phase 4: Key Files

Read and note the ecosystem-specific key files from the reference table, plus:
- Auth logic
- Database connections / ORM setup
- API clients
- Shared utilities and helpers

Gather: where important logic lives

## Final Step: Save to Supermemory

After exploring all phases, compile everything into one comprehensive summary and save:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/add-memory.cjs" "YOUR COMPILED FINDINGS HERE"
```

Include: detected ecosystem, tech stack, architecture, conventions, key files, important patterns.

## Instructions

- Make ~20-50 tool calls to explore thoroughly
- Skip dependency/package folders (`node_modules`, `bin`, `obj`, `target`, `vendor`, `__pycache__`, `.gradle`, `build`), generated files, and lock files
- Compile all findings at the end into one save

Start now.
