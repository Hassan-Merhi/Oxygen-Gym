import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "path";
import router from "./routes";
import { logger } from "./lib/logger";
import { errorHandler } from "./shared/http/errors";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(cors({ credentials: true, origin: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve uploaded files
const UPLOAD_DIR = path.resolve(process.cwd(), "uploads");
app.use("/api/uploads", express.static(UPLOAD_DIR));

app.use("/api", router);

// ── Production / Electron: serve the built frontend ───────────────────────────
const staticDir = process.env.STATIC_DIR ?? process.env.ELECTRON_STATIC_DIR;
if (staticDir) {
  const resolvedStaticDir = path.resolve(staticDir);
  app.use(express.static(resolvedStaticDir));
  app.get("/{*splat}", (_req, res) => {
    res.sendFile(path.join(resolvedStaticDir, "index.html"));
  });
}

// Centralized error mapping must remain last so domain services can throw typed errors.
app.use(errorHandler);

export default app;
