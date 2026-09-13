import type { Request, Response } from "express";

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

function invalidInput(res: Response, issues: readonly ContractIssue[]): null {
  res.status(400).json({
    error: "Invalid request",
    details: issues.map((issue) => ({
      path: issue.path?.join(".") ?? "",
      message: issue.message ?? "Invalid value",
      code: issue.code,
    })),
  });
  return null;
}

export function parseBody<T>(req: Request, res: Response, schema: ContractSchema<T>): T | null {
  const parsed = schema.safeParse(req.body as unknown);
  return parsed.success ? parsed.data : invalidInput(res, parsed.error.issues);
}

export function parseParams<T>(req: Request, res: Response, schema: ContractSchema<T>): T | null {
  const parsed = schema.safeParse(req.params as unknown);
  return parsed.success ? parsed.data : invalidInput(res, parsed.error.issues);
}

export function parseQuery<T>(req: Request, res: Response, schema: ContractSchema<T>): T | null {
  const parsed = schema.safeParse(req.query as unknown);
  return parsed.success ? parsed.data : invalidInput(res, parsed.error.issues);
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
