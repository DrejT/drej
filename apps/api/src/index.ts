import { Elysia, t } from "elysia";

const app = new Elysia()
  .get("/", () => ({ status: "ok", service: "drej-api" }))
  .get("/health", () => ({ healthy: true }))
  .post("/sandbox/run", ({ body }) => ({ id: crypto.randomUUID(), code: body.code, status: "queued" }), {
    body: t.Object({ code: t.String() }),
  })
  .listen(3000);

console.log(`drej API running at ${app.server?.hostname}:${app.server?.port}`);
