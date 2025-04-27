import { type OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { Scalar } from "@scalar/hono-api-reference";
import { HTTPException } from "hono/http-exception";
import { App } from "octokit";

import { createWebMiddleware } from "@octokit/webhooks";
import { Logger } from "tslog";
import { UAParser } from "ua-parser-js";
import { createApp } from "../utils/app";
import { env } from "hono/adapter";

export const app: OpenAPIHono<{ Bindings: CloudflareBindings }> = createApp();
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
    responses: {
      200: { description: "OK" },
    },
  }),
  async (c) => {
    const gh = new App({
      appId: env(c).GITHUB_APP_ID,
      privateKey: env(c).GITHUB_APP_PRIVATE_KEY.trim(),
      webhooks: {
        secret: env(c).GITHUB_APP_WEBHOOK_SECRET,
      },
    });

    console.debug(c.env.GITHUB_APP_ID);
    console.debug(c.env.GITHUB_APP_PRIVATE_KEY);
    console.debug(c.env.GITHUB_APP_WEBHOOK_SECRET);

    gh.webhooks.on("repository.created", async ({ octokit, payload }) => {
      console.log("Repository created", payload);
      const owner = payload.repository.owner.login;
      const repo = payload.repository.name;
      try {
        const resp =
          await octokit.rest.actions.setGithubActionsDefaultWorkflowPermissionsRepository(
            {
              owner,
              repo,
              default_workflow_permissions: "read",
              can_approve_pull_request_reviews: true,
            },
          );
        logger.debug(resp);
      } catch (err) {
        logger.error(err);
      }
      // const resp = await octokit.request(
      //   "POST /repos/{owner}/{repo}/actions/permissions/workflow",
      //   {
      //     owner,
      //     repo,
      //     default_workflow_permissions: "read",
      //     can_approve_pull_request_reviews: true,
      //   },
      // );
    });

    gh.webhooks.onError((err) => {
      if (err.name === "AggregateError")
        logger.error(`Error processing request: ${err.event}`);
      else logger.error(err);
    });

    const middleware = createWebMiddleware(gh.webhooks);
    const resp = await middleware(c.req.raw);
    logger.debug(resp);
    return resp;
  },
);
