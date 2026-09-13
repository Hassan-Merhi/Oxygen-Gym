import type { NextFunction, Request, Response } from "express";

export interface ContractIssue {
  path?: readonly (string | number)[];
  message?: string;
  code?: string;
}

export interface ContractSchema<T> {
  safeParse(input: unknown):
    | { success: true; data: T }
    | { success: false; error: { issues: readonly ContractIssue[] } };
}

export type ContractOutput<TSchema> = TSchema extends ContractSchema<infer T> ? T : never;

export class RequestContractError extends Error {
  readonly issues: readonly ContractIssue[];

  constructor(issues: readonly ContractIssue[]) {
    super("Invalid request");
    this.name = "RequestContractError";
    this.issues = issues;
  }
}

function issuePayload(issues: readonly ContractIssue[]) {
  return issues.map((issue) => ({
    path: issue.path?.join(".") ?? "",
    message: issue.message ?? "Invalid value",
    code: issue.code,
  }));
}

function invalidInput(res: Response, issues: readonly ContractIssue[]): null {
  res.status(400).json({ error: "Invalid request", details: issuePayload(issues) });
  return null;
}

function requireContract<T>(input: unknown, schema: ContractSchema<T>): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new RequestContractError(parsed.error.issues);
  return parsed.data;
}

export function contractBody<T>(req: Request, schema: ContractSchema<T>): T {
  return requireContract(req.body, schema);
}

export function contractParams<T>(req: Request, schema: ContractSchema<T>): T {
  return requireContract(req.params, schema);
}

export function contractQuery<T>(req: Request, schema: ContractSchema<T>): T {
  return requireContract(req.query, schema);
}

export function parseBody<T>(req: Request, res: Response, schema: ContractSchema<T>): T | null {
  const parsed = schema.safeParse(req.body);
  return parsed.success ? parsed.data : invalidInput(res, parsed.error.issues);
}

export function parseParams<T>(req: Request, res: Response, schema: ContractSchema<T>): T | null {
  const parsed = schema.safeParse(req.params);
  return parsed.success ? parsed.data : invalidInput(res, parsed.error.issues);
}

export function parseQuery<T>(req: Request, res: Response, schema: ContractSchema<T>): T | null {
  const parsed = schema.safeParse(req.query);
  return parsed.success ? parsed.data : invalidInput(res, parsed.error.issues);
}

export function contractErrorHandler(
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (err instanceof RequestContractError) {
    req.log.warn({ issues: err.issues }, "Request violated OpenAPI contract");
    res.status(400).json({ error: "Invalid request", details: issuePayload(err.issues) });
    return;
  }
  next(err);
}

export function sendContract<T>(
  req: Request,
  res: Response,
  schema: ContractSchema<T>,
  payload: unknown,
  status = 200,
): void {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    req.log.error({ issues: parsed.error.issues }, "Response violated OpenAPI contract");
    res.status(500).json({ error: "Response contract violation" });
    return;
  }
  res.status(status).json(parsed.data);
}
