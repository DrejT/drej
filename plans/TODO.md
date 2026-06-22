~add snapshot interval in params when starting the workflow
so the sandbox snapshot can be taken after/before each step
more discussion should be done on this as after/before or what if a workflow does not even rely on sandbox then how to the wal ndjson logs file will work~


think over whether this will turn into a business or a project idea that gives a job or a longterm project
whos the target audience

how to setup issue templates on github and what are releases on github

add contributing.md and init define how to make the setup
additionally, create docker files that allow running opensandbox and drej apis and drej engine


Good framing. Flue touches AI (agent reasoning, LLM calls, tool orchestration). drej should own everything else — the boring execution infrastructure that every AI product needs but nobody wants to build.

Here's what Flue offers where drej either has nothing or does it better:

Flue has it, drej has nothing:
- OpenTelemetry / observability — Flue integrates Braintrust, Sentry, OTel out of the box. drej has a ledger but zero tracing. Every SaaS needs this.
- Event triggers / channels — Slack, GitHub webhooks, etc. as workflow triggers. drej has no ingestion layer.
- CLI tooling — @flue/cli for local dev. drej has no CLI.
- Concurrency controls — Nothing in drej prevents 500 users from spawning 500 sandboxes simultaneously. Flue presumably handles this. For a SaaS that's critical.

Flue has it, drej does it better:
- Durable execution — Flue preserves progress through failures. drej has snapshot-based resumption + saga rollback with compensating transactions. That's a harder guarantee.
- Typed execution — Flue's tools are typed but LLM-driven. drej's StepDef is fully deterministic — no LLM in the loop, which means it's auditable, reproducible, testable.
- Code execution layer — Flue has generic sandbox file ops. drej has stateful language contexts across 6 languages.

What Flue doesn't do at all that the "shovel" angle owns:
- Multi-tenancy primitives — namespacing runs by user/org, isolation between tenants. If a SaaS embeds drej, they need this.
- Run management API — list runs, inspect state, cancel mid-flight. Operators need visibility into what's running.
- Sandbox cost controls — timeout guarantees at the workflow level, not just sandbox level.

The highest-leverage boring things to build next, in order: OpenTelemetry traces → run management API → concurrency limits. Those three turn drej from a library into something a SaaS can actually operate in production.

4. Missing features — things that would make the SDK more production-ready: per-step timeouts, AbortSignal cancellation support, or a dryRun mode.

docker ps -q --filter name=sandbox | xargs -r docker rm -f