import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "path";
import router from "./routes";
import { logger } from "./lib/logger";
import { env } from "./config/env";
import { contractErrorHandler } from "./http/contracts";
import { errorHandler } from "./shared/http/errors";
import { mutationRequestContext } from "./shared/http/idempotency-context";

const app: Express = express();
const resolvedStaticDir = env.staticDir ? path.resolve(env.staticDir) : null;

// Serve real frontend files before request logging, body parsing, and the API
// stack. A normal page load can request many hashed JS/CSS assets; those files
// do not need JSON parsing, CORS work, request-context setup, or one log line per
// asset. Missing files still fall through to the API / SPA fallback below.
if (resolvedStaticDir) {
  app.use(express.static(resolvedStaticDir, {
    setHeaders(res, filePath) {
      // Vite emits content-hashed JS/CSS under /assets. Those files can be kept
      // indefinitely by the browser and CDN. HTML must always revalidate so a
      // deployment can point clients at the newest asset hashes immediately.
      if (filePath.endsWith(`${path.sep}index.html`)) {
        res.setHeader("Cache-Control", "no-cache");
      } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      } else {
        res.setHeader("Cache-Control", "public, max-age=3600");
      }
    },
  }));
}

app.use(
  pinoHttp({
    logger,
    // Render probes this endpoint continuously. Keep application/API request
    // visibility without spending log I/O on successful platform health polls.
    autoLogging: {
      ignore: (req) => req.url?.split("?")[0] === "/api/healthz",
    },
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

app.use(cors({ credentials: true, origin: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(mutationRequestContext);

const uploadDir = path.resolve(process.cwd(), "uploads");
app.use("/api/uploads", express.static(uploadDir));
app.use("/api", router);

// Contract violations are normalized before the general domain error mapper.
app.use(contractErrorHandler);

if (resolvedStaticDir) {
  app.get("/{*splat}", (_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.join(resolvedStaticDir, "index.html"));
  });
}

app.use(errorHandler);

export default app;
