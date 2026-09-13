import type { ErrorRequestHandler } from "express";
import { logger } from "../../lib/logger";

export class AppError extends Error {
  readonly statusCode: number;
  readonly code?: string;
  readonly details?: unknown;

  constructor(statusCode: number, message: string, options?: { code?: string; details?: unknown }) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = options?.code;
    this.details = options?.details;
  }
}

export function badRequest(message: string, details?: unknown): AppError {
  return new AppError(400, message, { code: "BAD_REQUEST", details });
}

export function unauthorized(message = "Unauthorized"): AppError {
  return new AppError(401, message, { code: "UNAUTHORIZED" });
}

export function forbidden(message = "Forbidden"): AppError {
  return new AppError(403, message, { code: "FORBIDDEN" });
}

export function notFound(message = "Not found"): AppError {
  return new AppError(404, message, { code: "NOT_FOUND" });
}

export function conflict(message: string, details?: unknown): AppError {
  return new AppError(409, message, { code: "CONFLICT", details });
}

export function assertFound<T>(value: T | null | undefined, message = "Not found"): T {
  if (value === null || value === undefined) throw notFound(message);
  return value;
}

export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  if (error instanceof AppError) {
    res.status(error.statusCode).json({
      error: error.message,
      ...(error.code ? { code: error.code } : {}),
      ...(error.details !== undefined ? { details: error.details } : {}),
    });
    return;
  }

  logger.error(
    { err: error, method: req.method, path: req.path },
    "Unhandled API error",
  );
  res.status(500).json({ error: "Internal server error", code: "INTERNAL_ERROR" });
};
