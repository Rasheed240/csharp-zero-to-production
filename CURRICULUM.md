# CURRICULUM.md — Single Source of Truth

**Project:** Zero → Production-Grade Backend Engineering in C# / .NET
**Target runtime for all code:** .NET 10 (differences in .NET 8/9 noted inline where they matter)
**Last updated:** 2026-08-30 (session 8)

---

## How to read this file

This file is the **only** authoritative list of what the site contains. If a module is not
listed here, it does not exist. If it is listed here, it either exists or is owed.

Every module has a stable **ID**. The ID is the filename stem of its content file
(`content/modules/<ID>.js`) and the URL fragment (`index.html#/m/<ID>`). **IDs never change**
once assigned — changing an ID breaks saved progress and bookmarks.

### Status vocabulary

| Status | Meaning |
| --- | --- |
| `planned` | Listed here, no content file. The site renders a generated placeholder showing the scope line. |
| `drafting` | Content file exists but is incomplete. Not yet reviewed. |
| `written` | Complete and conforms to `STYLE-CONTRACT.md`. Awaiting review. |
| `frozen` | Reviewed and approved. **Must not be restructured, re-themed, or "improved" by later work.** Changes require explicit sign-off first. |

### Adding a module

1. Add a row to the relevant track table below.
2. Add a matching entry to the `modules` array in `content/manifest.js`.
3. Create `content/modules/<ID>.js`.

No site machinery (`assets/js/*`, `assets/css/*`, `index.html`) is touched. See `STYLE-CONTRACT.md` §9.

### Counts

| Track | Modules | Written / Frozen |
| --- | ---: | ---: |
| 1 — Language Foundations | 32 | 32 |
| 2 — Async, Memory, Performance | 25 | 25 |
| 3 — Web APIs & The Request Pipeline | 27 | 20 |
| 4 — Data | 25 | 0 |
| 5 — Production Systems & Architecture | 42 | 0 |
| 6 — Data Structures, Algorithms, Interviews | 28 | 0 |
| **Total** | **179** | **77** |

---

## Track 1 — Language Foundations

*Assumes literally nothing. Module 1 explains what a program is. By the end of the track the
reader can read and write idiomatic modern C# and reason about how the type system behaves.*

| # | ID | Title | Scope (one line) | Status |
| --: | --- | --- | --- | --- |
| 1 | `t1-01-what-a-program-is` | What a Program Actually Is | Source code, compilation, the CLR, IL, JIT, and what happens between double-clicking and output. | **written** |
| 2 | `t1-02-variables-and-types` | Variables and Types | Named boxes for data, why types exist, the built-in primitives, `var`, and type inference. | **written** |
| 3 | `t1-03-value-vs-reference` | Value Types vs Reference Types | Stack, heap, what copying means, boxing, mutable-struct traps, and why this underlies everything later. | **frozen** |
| 4 | `t1-04-control-flow` | Control Flow | `if`/`else`, `switch`, loops, `break`/`continue`, and how branching compiles down. | **written** |
| 5 | `t1-05-methods-and-parameters` | Methods, Arguments, and Parameters | Signatures, overloads, `ref`/`out`/`in`, optional and named arguments, `params`. | **written** |
| 6 | `t1-06-arrays` | Arrays | Fixed-size contiguous storage, bounds checking, multidimensional vs jagged, and their cost model. | **written** |
| 7 | `t1-07-strings-and-interning` | Strings, Immutability, and Interning | UTF-16 internals, immutability, the intern pool, `StringBuilder`, and comparison/culture pitfalls. | **written** |
| 8 | `t1-08-classes-and-objects` | Classes and Objects | Blueprint vs instance, fields, constructors, object initialisers, `this`, and object lifetime. | **written** |
| 9 | `t1-09-encapsulation` | Encapsulation and Access Modifiers | Why hiding state is not bureaucracy, properties vs fields, `private`/`internal`/`protected`/`public`/`file`. | **written** |
| 10 | `t1-10-inheritance` | Inheritance | Type hierarchies, base calls, constructor chaining, and the fragile base class problem. | **written** |
| 11 | `t1-11-polymorphism` | Polymorphism and Virtual Dispatch | `virtual`/`override`/`new`/`sealed`, the vtable, and what dispatch costs. | **written** |
| 12 | `t1-12-abstraction-and-interfaces` | Abstraction, Abstract Classes, and Interfaces | `abstract` vs `virtual` vs `sealed`, interface contracts, default interface methods, explicit implementation. | **written** |
| 13 | `t1-13-composition-over-inheritance` | Composition Over Inheritance | Why deep hierarchies rot, delegation, and rewriting an inheritance tree as composition. | **written** |
| 14 | `t1-14-static-and-lifetime` | Static Members, Constructors, and Lifetime | `static` state, static constructors and their threading guarantees, and why static mutable state hurts. | **written** |
| 15 | `t1-15-structs-and-records` | Structs, Records, `readonly`, and `init` | `record class` vs `record struct`, `readonly struct`, `init` accessors, `with` expressions, value equality. | **written** |
| 16 | `t1-16-equality-and-hashing` | Equality, `GetHashCode`, and Comparers | Reference vs value equality, the hashcode contract, `IEquatable<T>`, `IComparer<T>`, and dictionary corruption. | **written** |
| 17 | `t1-17-generics` | Generics | Type parameters, why they beat `object`, JIT specialisation for value types, variance basics. | **written** |
| 18 | `t1-18-generic-constraints` | Generic Constraints | `where` clauses, `new()`, `notnull`, `unmanaged`, `struct`/`class`, and static abstract members in interfaces. | **written** |
| 19 | `t1-19-collections-overview` | Collections and Their Cost Model | `List`, `Dictionary`, `HashSet`, `Queue`, `Stack`, `SortedDictionary`, arrays — and when each is the wrong choice. | **written** |
| 20 | `t1-20-ienumerable-vs-icollection` | `IEnumerable` vs `ICollection` vs `IList` vs `IReadOnly*` | The interface hierarchy, what each guarantees, which members exist where, and choosing return types. | **written** |
| 21 | `t1-21-delegates` | Delegates | Function pointers with a type, `Func`/`Action`/`Predicate`, multicast delegates, and invocation cost. | **written** |
| 22 | `t1-22-lambdas-and-closures` | Lambdas and Closures | Capture semantics, the compiler-generated closure class, allocation, and the captured-loop-variable trap. | **written** |
| 23 | `t1-23-events` | Events | The publish/subscribe pattern, `event` vs delegate field, the event-handler memory leak, and safe raising. | **written** |
| 24 | `t1-24-linq-fundamentals` | LINQ: Both Syntaxes | Query vs method syntax, the standard operators, and how query syntax lowers to method calls. | written |
| 25 | `t1-25-deferred-execution` | Deferred Execution and the Cost of LINQ | Lazy pipelines, multiple enumeration, closure capture in queries, allocation cost, and when to write a loop. | written |
| 26 | `t1-26-iterators-and-yield` | Iterators and `yield` | Writing your own lazy sequences, the generated state machine, `try`/`finally` semantics, and streaming. | written |
| 27 | `t1-27-pattern-matching` | Pattern Matching | Type, constant, relational, logical, property, positional, and list patterns; switch expressions; exhaustiveness. | written |
| 28 | `t1-28-nullable-reference-types` | Nullable Reference Types | The `?` annotation, flow analysis, `!`, nullable attributes, and migrating a codebase without lying to the compiler. | written |
| 29 | `t1-29-exceptions` | Exceptions and Exception Design | Throwing, catching, filters, `finally`, custom exception types, cost, and when *not* to use exceptions. | written |
| 30 | `t1-30-extension-methods` | Extension Methods | Static methods that read like instance methods, resolution rules, and when they become a maintenance problem. | written |
| 31 | `t1-31-reflection-and-attributes` | Reflection and Attributes | Metadata at runtime, `Type`, `MethodInfo`, writing and reading attributes, cost, and trimming/AOT hazards. | written |
| 32 | `t1-32-source-generators` | Source Generators | Compile-time code generation, incremental generators, when they replace reflection, and debugging them. | written |

---

## Track 2 — Async, Memory, and Performance Internals

*The track that separates people who use `async` from people who can explain a production
thread-pool starvation incident.*

| # | ID | Title | Scope (one line) | Status |
| --: | --- | --- | --- | --- |
| 1 | `t2-01-threads-and-scheduling` | Threads, Cores, and the OS Scheduler | What a thread physically is, context switching, concurrency vs parallelism, and why threads are expensive. | written |
| 2 | `t2-02-thread-pool` | The Thread Pool | Work queues, local vs global queues, work stealing, hill-climbing injection, and starvation. | written |
| 3 | `t2-03-what-async-really-is` | What `async` Actually Is | Async as *not occupying a thread while waiting*, I/O completion ports, and the lie that async means parallel. | written |
| 4 | `t2-04-task-and-valuetask` | `Task`, `Task<T>`, and `ValueTask<T>` | Promise semantics, completion sources, when `ValueTask` is worth it, and its consumption rules. | written |
| 5 | `t2-05-async-state-machine` | The `async`/`await` State Machine | Reading the compiler-generated struct, `MoveNext`, awaiters, and what each `await` actually costs. | written |
| 6 | `t2-06-synchronizationcontext` | `SynchronizationContext` and `ConfigureAwait` | Context capture, why ASP.NET Core has no context, when `ConfigureAwait(false)` matters, and library rules. | written |
| 7 | `t2-07-sync-over-async-deadlocks` | Deadlocks and Sync-Over-Async | `.Result`/`.Wait()`, the classic deadlock, thread-pool exhaustion, and how to actually fix a blocking call. | written |
| 8 | `t2-08-cancellation` | Cancellation Tokens | Cooperative cancellation, linked sources, timeouts, and threading tokens end to end through a request. | written |
| 9 | `t2-09-iasyncenumerable` | `IAsyncEnumerable<T>` | Async streams, `await foreach`, cancellation in streams, and streaming a query result without buffering. | written |
| 10 | `t2-10-parallelism` | Parallelism: `Parallel`, PLINQ, and `Task.WhenAll` | CPU-bound work, partitioning, degree of parallelism, and why parallel is not always faster. | written |
| 11 | `t2-11-race-conditions` | Race Conditions and Memory Visibility | Interleaving, torn reads, the memory model, `volatile`, and why "it works on my machine" is meaningless here. | written |
| 12 | `t2-12-locking` | `lock`, `Monitor`, and Lock Design | Mutual exclusion, lock granularity, lock ordering, deadlock avoidance, and `System.Threading.Lock` in .NET 9+. | written |
| 13 | `t2-13-interlocked-and-lockfree` | `Interlocked` and Lock-Free Basics | Atomic operations, compare-and-swap, spin waiting, and when lock-free is a mistake. | written |
| 14 | `t2-14-async-coordination` | `SemaphoreSlim`, Channels, and Async Coordination | Async-safe throttling, producer/consumer with `System.Threading.Channels`, and bounded backpressure. | written |
| 15 | `t2-15-concurrent-collections` | Concurrent Collections | `ConcurrentDictionary` and friends, their atomicity guarantees, `GetOrAdd` re-entrancy, and when to just lock. | written |
| 16 | `t2-16-gc-fundamentals` | Garbage Collection Fundamentals | Managed heap, roots, mark/sweep/compact, generations 0/1/2, and what a collection pauses. | written |
| 17 | `t2-17-gc-tuning` | LOH, Server vs Workstation GC, and Allocation Pressure | Large object heap, fragmentation, GC modes, `GCSettings`, DATAS in .NET 8+, and reading GC counters. | written |
| 18 | `t2-18-finalisers-and-idisposable` | `IDisposable`, `IAsyncDisposable`, and Finalisers | Deterministic cleanup, the dispose pattern, `using` declarations, and why finalisers are a last resort. | written |
| 19 | `t2-19-span-and-memory` | `Span<T>` and `Memory<T>` | Stack-only slices, `ref struct` rules, slicing without allocating, and where `Memory<T>` is required instead. | written |
| 20 | `t2-20-zero-allocation` | Zero-Allocation Techniques | `stackalloc`, `ArrayPool<T>`, `ObjectPool`, `SearchValues`, and rewriting a hot path to allocate nothing. | written |
| 21 | `t2-21-string-without-allocation` | String Handling Without Allocation | `ReadOnlySpan<char>`, `string.Create`, interpolated string handlers, UTF-8 literals, and parsing in place. | written |
| 22 | `t2-22-streams-and-buffering` | Streams, Buffering, and Async I/O | Stream contracts, buffer sizing, `PipeReader` vs `Stream`, and copying files without wasting memory. | written |
| 23 | `t2-23-pipelines` | `System.IO.Pipelines` | Why parsing network data with `Stream` is hard, back-pressure, `SequenceReader`, and a real protocol parser. | written |
| 24 | `t2-24-benchmarkdotnet` | Benchmarking with BenchmarkDotNet | Harness setup, warmup, memory diagnosers, reading the output honestly, and the benchmarks that lie. | written |
| 25 | `t2-25-diagnostics-tooling` | Profiling and Production Diagnostics | `dotnet-counters`, `dotnet-trace`, `dotnet-dump`, `dotnet-gcdump`, and walking a real memory dump. | written |

---

## Track 3 — Web APIs and the Request Pipeline

| # | ID | Title | Scope (one line) | Status |
| --: | --- | --- | --- | --- |
| 1 | `t3-01-http-fundamentals` | HTTP As It Actually Behaves | Methods, status codes, headers, content negotiation, keep-alive, HTTP/2 and /3, and idempotency/safety semantics. | written |
| 2 | `t3-02-hosting-model` | The Hosting Model | `WebApplication`, the generic host, service registration vs pipeline building, startup order, graceful shutdown. | written |
| 3 | `t3-03-kestrel` | Kestrel | The socket-to-request path, connection limits, request limits, timeouts, TLS, and reverse-proxy deployment. | written |
| 4 | `t3-04-middleware-pipeline` | The Middleware Pipeline | Ordering as behaviour, `Use`/`Run`/`Map`, short-circuiting, writing custom middleware, and terminal middleware. | written |
| 5 | `t3-05-routing` | Routing and Endpoints | Route templates, constraints, endpoint metadata, route groups, and link generation. | written |
| 6 | `t3-06-minimal-vs-controllers` | Minimal APIs vs Controllers | The real trade-offs — testability, filters, conventions, discoverability — with an honest recommendation. | written |
| 7 | `t3-07-model-binding` | Model Binding | Sources, binding rules, custom binders, `[AsParameters]`, and binding failures that silently produce nulls. | written |
| 8 | `t3-08-validation` | Validation | Data annotations, `IValidatableObject`, FluentValidation, minimal-API validation in .NET 10, and layering rules. | written |
| 9 | `t3-09-problem-details` | `ProblemDetails` and Error Contracts | RFC 9457, exception handling middleware, a consistent error envelope, and never leaking internals. | written |
| 10 | `t3-10-dependency-injection` | Dependency Injection | Inversion of control from first principles, the container, constructor injection, and composition roots. | written |
| 11 | `t3-11-di-lifetimes` | DI Lifetimes and the Bugs They Cause | Singleton/scoped/transient, captive dependencies, scope in background services, and `DbContext` disasters. | written |
| 12 | `t3-12-configuration` | Configuration | Providers, precedence, binding, reloading, and configuration that differs per environment. | written |
| 13 | `t3-13-options-pattern` | The Options Pattern | `IOptions` vs `IOptionsSnapshot` vs `IOptionsMonitor`, validation on startup, and named options. | written |
| 14 | `t3-14-secrets` | Environments and Secret Handling | User secrets, environment variables, key vaults, what must never reach source control, and rotation. | written |
| 15 | `t3-15-api-versioning` | API Versioning | URL vs header vs media-type versioning, deprecation, and evolving a contract without breaking clients. | written |
| 16 | `t3-16-pagination` | Pagination, Filtering, and Sorting | Offset vs keyset pagination, stable ordering, filter contracts, and not letting clients DoS your database. | written |
| 17 | `t3-17-file-upload` | File Upload and Storage | Multipart handling, streaming large uploads, size limits, content sniffing, virus scanning, and blob storage. | written |
| 18 | `t3-18-openapi` | OpenAPI and Documentation | Built-in OpenAPI in .NET 9+/10, schema shaping, examples, and keeping docs honest. | written |
| 19 | `t3-19-health-checks` | Health Checks | Liveness vs readiness vs startup, dependency checks, and the health check that took down the cluster. | written |
| 20 | `t3-20-feature-flags` | Feature Flags | Toggle types, `Microsoft.FeatureManagement`, targeting filters, flag lifecycle, and removing dead flags. | written |
| 21 | `t3-21-hosted-services` | `IHostedService` and `BackgroundService` | Lifetime hooks, long-running loops, scope creation, exception handling, and graceful shutdown. | planned |
| 22 | `t3-22-scheduled-jobs` | Scheduled and Queued Jobs: Hangfire and Quartz | Persistent job storage, retries, cron scheduling, distributed execution, and job idempotency. | planned |
| 23 | `t3-23-signalr` | Real-Time with SignalR | Hubs, transports and fallback, groups, scale-out with a backplane, and connection lifecycle handling. | planned |
| 24 | `t3-24-grpc` | gRPC | Protobuf contracts, the four call types, code generation, deadlines, interceptors, and when to prefer REST. | planned |
| 25 | `t3-25-http-client` | Calling Other Services: `HttpClient` | `IHttpClientFactory`, socket exhaustion, handler lifetime, typed clients, and timeout layering. | planned |
| 26 | `t3-26-webhooks-outbound` | Sending Webhooks | Signing payloads (HMAC), timestamps, retries with backoff, delivery logs, and consumer-friendly design. | planned |
| 27 | `t3-27-webhooks-inbound` | Consuming Webhooks Safely | Signature verification, replay protection, constant-time comparison, idempotent handling, and fast ACK. | planned |

---

## Track 4 — Data

| # | ID | Title | Scope (one line) | Status |
| --: | --- | --- | --- | --- |
| 1 | `t4-01-relational-modelling` | Relational Modelling From Scratch | Tables, rows, keys, relationships, normal forms, and modelling a real domain end to end. | planned |
| 2 | `t4-02-sql-basics` | SQL: Reading and Filtering | `SELECT`, `WHERE`, `ORDER BY`, `NULL` semantics, and the three-valued logic that catches everyone. | planned |
| 3 | `t4-03-joins` | Joins | Inner, left, right, full, cross, self, and anti-joins — with the row-multiplication trap. | planned |
| 4 | `t4-04-grouping` | Grouping and Aggregation | `GROUP BY`, `HAVING`, aggregate semantics with `NULL`, and grouping sets. | planned |
| 5 | `t4-05-window-functions` | Window Functions | `OVER`, partitioning, ranking, running totals, `LAG`/`LEAD`, and de-duplication patterns. | planned |
| 6 | `t4-06-ctes-and-recursion` | CTEs and Recursive Queries | Readability, materialisation, recursive hierarchies, and cycle protection. | planned |
| 7 | `t4-07-indexes` | Indexes | B-trees, clustered vs non-clustered, composite key order, covering indexes, and the write-cost trade-off. | planned |
| 8 | `t4-08-execution-plans` | Execution Plans and Why a Query Is Slow | Reading a plan, scans vs seeks, estimated vs actual rows, parameter sniffing, and SARGability. | planned |
| 9 | `t4-09-transactions` | Transactions and ACID | Atomicity in practice, transaction scope, long transactions, and what a rollback does not undo. | planned |
| 10 | `t4-10-isolation-levels` | Isolation Levels and Their Anomalies | Dirty/non-repeatable/phantom reads, write skew, snapshot isolation, and picking a level deliberately. | planned |
| 11 | `t4-11-concurrency-control` | Optimistic and Pessimistic Concurrency | Row versions, `ETag`s, `UPDATE ... WHERE version =`, explicit locks, and conflict resolution UX. | planned |
| 12 | `t4-12-connection-pooling` | Connection Pooling | Pool mechanics, pool exhaustion symptoms, connection string tuning, and leaked connections. | planned |
| 13 | `t4-13-orms-what-they-hide` | ORMs and What They Hide | Impedance mismatch, generated SQL, leaky abstractions, and the cost you accept when you adopt one. | planned |
| 14 | `t4-14-efcore-dbcontext` | EF Core: `DbContext` and Configuration Approaches | Data annotations vs fluent API vs `IEntityTypeConfiguration`, and why one scales better. | planned |
| 15 | `t4-15-efcore-change-tracking` | EF Core: Change Tracking | The identity map, entity states, `SaveChanges` mechanics, and tracking bugs in long-lived contexts. | planned |
| 16 | `t4-16-efcore-relationships` | EF Core: Relationship Configuration | One-to-one, one-to-many, many-to-many, owned types, and cascade delete behaviour. | planned |
| 17 | `t4-17-efcore-inheritance` | EF Core: Inheritance Mapping | TPH, TPT, TPC — storage shape, query cost, and discriminator configuration. | planned |
| 18 | `t4-18-efcore-querying` | EF Core: Querying, Tracking, and N+1 | `AsNoTracking`, split queries, eager vs lazy loading, projection, and diagnosing N+1 from logs. | planned |
| 19 | `t4-19-efcore-performance` | EF Core: Compiled Queries and Performance | Query compilation cost, compiled queries, bulk operations, `ExecuteUpdate`/`ExecuteDelete`, batching. | planned |
| 20 | `t4-20-efcore-migrations` | EF Core: Migrations | Model snapshots, generated SQL, data migrations, and migrations you can safely run against production. | planned |
| 21 | `t4-21-raw-sql-and-dapper` | Raw SQL Escape Hatches and Dapper | `FromSql`, parameterisation, when Dapper wins, and running both in one codebase without chaos. | planned |
| 22 | `t4-22-caching-in-memory` | In-Memory Caching | `IMemoryCache`, `HybridCache` in .NET 9+, sizing, eviction, and the cache stampede. | planned |
| 23 | `t4-23-distributed-cache-redis` | Distributed Caching and Redis | `IDistributedCache`, Redis data types, serialisation, connection management, and failure modes. | planned |
| 24 | `t4-24-cache-invalidation` | Cache Invalidation Strategies | TTL, write-through, write-behind, cache-aside, tag-based invalidation, and staleness budgets. | planned |
| 25 | `t4-25-nosql` | NoSQL Where It Genuinely Fits | Document/key-value/wide-column/graph, access-pattern-first modelling, and the cases SQL still wins. | planned |

---

## Track 5 — Production Systems and Architecture

| # | ID | Title | Scope (one line) | Status |
| --: | --- | --- | --- | --- |
| 1 | `t5-01-layered-architecture` | Layered Architecture | The classic N-tier split, dependency direction, and where it genuinely breaks down. | planned |
| 2 | `t5-02-clean-architecture` | Clean / Onion Architecture | Dependency inversion at the architecture level, the ports-and-adapters idea, and its real ceremony cost. | planned |
| 3 | `t5-03-vertical-slice` | Vertical Slice Architecture | Organising by feature, coupling trade-offs, and why it often beats layers in practice. | planned |
| 4 | `t5-04-hexagonal` | Hexagonal Architecture | Ports, adapters, the domain at the centre, and testing without infrastructure. | planned |
| 5 | `t5-05-modular-monolith` | The Modular Monolith | Module boundaries, enforced isolation, shared database vs schema-per-module, and the migration path out. | planned |
| 6 | `t5-06-microservices` | Microservices — and When They Are Overkill | Service boundaries, the distributed-systems tax, data ownership, and an honest cost/benefit account. | planned |
| 7 | `t5-07-cqrs` | CQRS With and Without MediatR | Splitting reads from writes, when a mediator helps, when it is indirection theatre, and hand-rolled dispatch. | planned |
| 8 | `t5-08-ddd-building-blocks` | DDD Building Blocks | Entities, value objects, aggregates, aggregate roots, repositories, domain services, and ubiquitous language. | planned |
| 9 | `t5-09-domain-events` | Domain Events | Raising events inside an aggregate, dispatch timing, and keeping side effects out of the domain model. | planned |
| 10 | `t5-10-event-driven-design` | Event-Driven Design | Events vs commands, choreography vs orchestration, eventual consistency, and event schema evolution. | planned |
| 11 | `t5-11-message-brokers` | Message Brokers | Queues vs topics, RabbitMQ/Kafka/Azure Service Bus models, delivery guarantees, consumer groups, DLQs. | planned |
| 12 | `t5-12-outbox-pattern` | The Outbox Pattern | The dual-write problem, transactional outbox, relay processing, and de-duplication downstream. | planned |
| 13 | `t5-13-sagas` | Sagas and Long-Running Processes | Orchestration vs choreography, compensating actions, state persistence, and timeout handling. | planned |
| 14 | `t5-14-idempotency` | Idempotency | Why at-least-once delivery forces it, idempotency keys, storage design, and making a payment endpoint safe. | planned |
| 15 | `t5-15-distributed-locks` | Distributed Locks | Why they are harder than they look, Redis/DB-based locks, fencing tokens, lease expiry, and safer alternatives. | planned |
| 16 | `t5-16-resilience-retry` | Retry and Exponential Backoff With Jitter | Transient vs permanent failures, backoff maths, jitter strategies, and how naive retries amplify an outage. | planned |
| 17 | `t5-17-circuit-breaker` | Circuit Breakers, Bulkheads, Timeouts, Fallbacks | Polly v8 resilience pipelines, state transitions, isolation, and composing strategies in the right order. | planned |
| 18 | `t5-18-rate-limiting` | Rate Limiting and Throttling | Fixed/sliding window, token bucket, concurrency limiter, .NET rate-limiting middleware, and per-tenant limits. | planned |
| 19 | `t5-19-load-shedding` | Backpressure and Load Shedding | Queue depth as a signal, shedding cheaply, degradation modes, and protecting the system from itself. | planned |
| 20 | `t5-20-authn-vs-authz` | Authentication vs Authorisation, Defined Precisely | The two questions, where each belongs, identity vs claims vs permissions, and the vocabulary used correctly. | planned |
| 21 | `t5-21-cookie-auth` | Cookie Authentication | Cookie flags, sessions, sliding expiration, sign-out semantics, and when cookies beat tokens. | planned |
| 22 | `t5-22-jwt` | JWT: Structure, Signing, Validation | Header/payload/signature, HS vs RS vs ES, validation parameters, `alg` confusion, and what a JWT does *not* protect. | planned |
| 23 | `t5-23-refresh-tokens` | Refresh Token Rotation | Short access tokens, rotation, reuse detection, revocation lists, and secure client-side storage. | planned |
| 24 | `t5-24-oauth2` | OAuth2 Grant Types | Authorisation code + PKCE, client credentials, device code, deprecated implicit/password grants, and scopes. | planned |
| 25 | `t5-25-oidc` | OpenID Connect | ID tokens vs access tokens, discovery, JWKS and key rotation, userinfo, and federated sign-out. | planned |
| 26 | `t5-26-api-keys-and-mtls` | API Keys and mTLS | Key issuance, hashing at rest, scoping, rotation, client certificate auth, and service-to-service identity. | planned |
| 27 | `t5-27-authorization-models` | Role vs Claims vs Permission vs Policy-Based Authorisation | The four models compared precisely, requirement handlers, and resource-based authorisation. | planned |
| 28 | `t5-28-rbac-design` | Designing a Full RBAC Model | Users, roles, permissions, scopes, hierarchy, delegation, the data model, and caching authorisation decisions. | planned |
| 29 | `t5-29-owasp-top-10` | OWASP Top 10 With .NET Mitigations | Each category mapped to concrete ASP.NET Core defences and the misconfigurations that reintroduce it. | planned |
| 30 | `t5-30-injection-attacks` | SQL Injection, XSS, CSRF, SSRF, Mass Assignment | How each attack actually works, a working exploit, and the .NET-specific fix for each. | planned |
| 31 | `t5-31-crypto-basics` | Hashing vs Encryption, and Secret Storage | Password hashing, salts, HMAC, symmetric vs asymmetric, key management, and what never to invent yourself. | planned |
| 32 | `t5-32-data-protection` | ASP.NET Core Data Protection | The key ring, purposes, key persistence across instances, and the "cookies invalid after deploy" incident. | planned |
| 33 | `t5-33-multi-tenancy` | Multi-Tenancy | Tenant resolution, isolation models (row/schema/database), noisy neighbours, and cross-tenant leak prevention. | planned |
| 34 | `t5-34-structured-logging` | Logging Done Right | Structured logging, Serilog, levels, message templates, sampling, and what must never be logged. | planned |
| 35 | `t5-35-correlation-ids` | Correlation IDs and Request Context | Propagating identity across services, `Activity`, log scopes, and reconstructing a request from logs. | planned |
| 36 | `t5-36-metrics` | Metrics and Monitoring | Counters/gauges/histograms, RED and USE methods, `System.Diagnostics.Metrics`, dashboards, and alert design. | planned |
| 37 | `t5-37-opentelemetry` | OpenTelemetry and Distributed Tracing | Spans, context propagation, instrumentation, exporters, sampling, and reading a trace end to end. | planned |
| 38 | `t5-38-unit-testing` | Unit Testing | xUnit, arrange/act/assert, test naming, fakes vs mocks vs stubs, and tests that survive refactoring. | planned |
| 39 | `t5-39-integration-testing` | Integration Testing With `WebApplicationFactory` | In-memory hosting, overriding services, auth in tests, and testing the real pipeline. | planned |
| 40 | `t5-40-testcontainers` | Testcontainers and Test Data Strategy | Real databases in tests, fixtures, seeding, isolation between tests, and keeping the suite fast. | planned |
| 41 | `t5-41-docker` | Docker for .NET | Layered images, multi-stage builds, chiselled/distroless bases, image size, and container-aware runtime config. | planned |
| 42 | `t5-42-cicd-and-deployment` | CI/CD, Migrations in a Pipeline, Zero-Downtime Releases | Pipeline stages, expand/contract migrations, blue-green and rolling deploys, and safe rollback. | planned |

---

## Track 6 — Data Structures, Algorithms, and Interview Problems

*Organised by pattern so unseen problems are attackable. Every problem inside these modules
carries: difficulty, pattern, brute force + why it fails, the unlocking insight, a full commented
C# solution, complexity analysis, common wrong turns, and "how would I have recognised this cold?".*

| # | ID | Title | Scope (one line) | Status |
| --: | --- | --- | --- | --- |
| 1 | `t6-01-complexity-from-scratch` | Complexity Analysis From Scratch | Counting operations, deriving Big-O rather than recalling it, amortised cost, and space complexity. | planned |
| 2 | `t6-02-complexity-in-practice` | Complexity of the BCL | Real costs of `List`, `Dictionary`, `HashSet`, `SortedSet`, LINQ operators, and string operations. | planned |
| 3 | `t6-03-arrays-and-hashing` | Pattern: Arrays and Hashing | Frequency maps, seen-sets, trading space for time, and the problems this pattern silently solves. | planned |
| 4 | `t6-04-two-pointers` | Pattern: Two Pointers | Opposite-end and same-direction pointers, sorted-array exploitation, and in-place partitioning. | planned |
| 5 | `t6-05-sliding-window` | Pattern: Sliding Window | Fixed and variable windows, the shrink condition, and recognising "contiguous subarray/substring". | planned |
| 6 | `t6-06-prefix-sums` | Pattern: Prefix Sums | Range queries in O(1), prefix-sum + hashmap for subarray targets, and 2-D prefix sums. | planned |
| 7 | `t6-07-binary-search` | Pattern: Binary Search and Its Disguises | Boundary search, search on answer space, `lo`/`hi` invariants, and off-by-one elimination. | planned |
| 8 | `t6-08-stacks` | Pattern: Stacks | LIFO problems, matching pairs, expression evaluation, and simulating recursion. | planned |
| 9 | `t6-09-monotonic-stack` | Pattern: Monotonic Stack | Next-greater/smaller element, histogram problems, and recognising the "nearest boundary" shape. | planned |
| 10 | `t6-10-queues-and-deques` | Pattern: Queues and Monotonic Deques | FIFO processing, sliding-window maximum, and `Queue<T>`/`LinkedList<T>` in C#. | planned |
| 11 | `t6-11-linked-lists` | Pattern: Linked Lists | Pointer manipulation, dummy heads, reversal, cycle detection (Floyd), and merge patterns. | planned |
| 12 | `t6-12-trees-traversal` | Trees and Traversal | Binary trees, DFS orders, BFS by level, recursive vs iterative, and building traversal intuition. | planned |
| 13 | `t6-13-bst` | Binary Search Trees | Ordering invariant, search/insert/delete, in-order = sorted, and balance (why AVL/red-black exist). | planned |
| 14 | `t6-14-tree-dp` | Pattern: Tree Recursion and Tree DP | Returning state up the tree, path problems, diameter, and lowest common ancestor. | planned |
| 15 | `t6-15-tries` | Tries | Prefix trees, node design in C#, autocomplete, word search, and memory trade-offs. | planned |
| 16 | `t6-16-heaps` | Heaps and Priority Queues | Heap invariant, `PriorityQueue<TElement,TPriority>`, top-K, and k-way merge. | planned |
| 17 | `t6-17-graphs-representation` | Graphs: Representation and Traversal | Adjacency list vs matrix, BFS, DFS, connected components, and grid-as-graph. | planned |
| 18 | `t6-18-topological-sort` | Pattern: Topological Sort | Dependency ordering, Kahn's algorithm, DFS-based ordering, and cycle detection. | planned |
| 19 | `t6-19-shortest-path` | Shortest Path | BFS on unweighted graphs, Dijkstra, Bellman-Ford, and choosing between them. | planned |
| 20 | `t6-20-union-find` | Union-Find (Disjoint Set) | Union by rank, path compression, near-constant amortised cost, and connectivity/MST problems. | planned |
| 21 | `t6-21-backtracking` | Pattern: Backtracking | The choose/explore/unchoose skeleton, pruning, and subsets/permutations/combinations/N-Queens. | planned |
| 22 | `t6-22-greedy` | Pattern: Greedy | Exchange argument, proving a greedy choice is safe, and when greedy quietly fails. | planned |
| 23 | `t6-23-dp-foundations` | Dynamic Programming: Memoisation → Tabulation → Space Optimisation | State definition, recurrence derivation, and the mechanical path from recursion to O(1) space. | planned |
| 24 | `t6-24-dp-patterns` | DP Pattern Catalogue | Knapsack, LIS, LCS, edit distance, grid paths, interval DP, and bitmask DP. | planned |
| 25 | `t6-25-intervals` | Pattern: Intervals | Sorting by start/end, merging, overlap detection, meeting rooms, and sweep line. | planned |
| 26 | `t6-26-bit-manipulation` | Pattern: Bit Manipulation | Masks, XOR tricks, counting bits, subsets via bitmask, and `BitOperations` in .NET. | planned |
| 27 | `t6-27-matrix` | Pattern: Matrix Traversal | Rotation, spiral order, in-place transforms, and flood fill. | planned |
| 28 | `t6-28-csharp-interview-idioms` | C#-Specific Interview Idioms | Which BCL type to reach for under time pressure, LINQ vs loops in interviews, and idiomatic fast writing. | planned |

---

## Deferred / explicitly out of scope

Nothing from the original brief has been dropped. The items below were considered and
deliberately excluded; they are recorded so the decision is not silently re-litigated later.

| Item | Decision |
| --- | --- |
| Blazor / front-end frameworks | Out of scope — the brief is backend engineering. |
| MAUI / desktop | Out of scope. |
| F# / VB.NET | Out of scope. |
| Cloud-provider-specific service catalogues | Out of scope — storage, queue, and vault concepts are taught provider-neutrally so they transfer. |
