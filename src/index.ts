import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { createWebMiddleware } from "@octokit/webhooks";
import { Scalar } from "@scalar/hono-api-reference";
import { env } from "hono/adapter";
import { HTTPException } from "hono/http-exception";
import { App } from "octokit";
import { Logger } from "tslog";
import { UAParser } from "ua-parser-js";

const app: OpenAPIHono<{ Bindings: CloudflareBindings }> = new OpenAPIHono<{
  Bindings: CloudflareBindings;
}>();

const logger = new Logger();

app.doc("/openapi.json", {
  openapi: "3.1.0",
  info: { title: "liblaf-bot", version: "v0" },
  externalDocs: {
    description: "GitHub",
    url: "https://github.com/liblaf/liblaf-bot",
  },
});

app.onError(async (err, c) => {
  logger.error(err);
  if (err instanceof HTTPException) return err.getResponse();
  return c.text(`${err}`, 500);
});

app.get("/", async (c) => {
  const ua = UAParser(c.req.header("User-Agent"));
  if (ua.browser.name) return c.redirect("/scalar");
  return c.newResponse(null, 204);
});

app.get("/scalar", Scalar({ url: "/openapi.json" }));

app.openapi(
  createRoute({
    method: "post",
    path: "/api/github/webhooks",
    responses: { 200: { description: "OK" } },
  }),
  async (c) => {
    const gh = new App({
      appId: env(c).GITHUB_APP_ID,
      privateKey: env(c).GITHUB_APP_PRIVATE_KEY,
      webhooks: {
        secret: env(c).GITHUB_APP_WEBHOOK_SECRET,
      },
    });

    gh.webhooks.on("repository.created", async ({ octokit, payload }) => {
      typeof octokit;
      const owner: string = payload.repository.owner.login;
      const repo: string = payload.repository.name;
      await octokit.request(
        "POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches",
        {
          owner,
          repo,
          workflow_id: "bot-repo-created.yaml",
          ref: "main",
          inputs: { owner, repo },
        },
      );
    });

    gh.webhooks.onError((err) => {
      logger.error(err);
    });

    const middleware = createWebMiddleware(gh.webhooks);
    const resp = await middleware(c.req.raw);
    return resp;
  },
);

export default app;
