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

if (env.staticDir) {
  const resolvedStaticDir = path.resolve(env.staticDir);
  app.use(express.static(resolvedStaticDir));
  app.get("/{*splat}", (_req, res) => {
    res.sendFile(path.join(resolvedStaticDir, "index.html"));
  });
}

app.use(errorHandler);

export default app;
