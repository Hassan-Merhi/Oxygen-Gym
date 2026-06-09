export * from "./generated/api";
// TypeScript interfaces live in ./generated/types but are not re-exported here
// because named component schemas generate same-named Zod validators in api.ts.
// Use z.infer<typeof SchemaName> to get the TypeScript type from any Zod validator.
