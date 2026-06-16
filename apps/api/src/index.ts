import { Elysia } from "elysia";

const app = new Elysia()
  .get("/", () => ({ status: "ok", service: "drej-api" }))
  .get("/health", () => ({ healthy: true }))
  .listen(3000);

console.log(`drej API running at ${app.server?.hostname}:${app.server?.port}`);
