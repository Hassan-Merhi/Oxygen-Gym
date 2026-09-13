import fs from "node:fs";

const specPath = "lib/api-spec/openapi.yaml";
let spec = fs.readFileSync(specPath, "utf8");
const marker = "\ncomponents:\n";
if (!spec.includes(marker)) throw new Error("Could not locate OpenAPI components marker");

let changed = false;

if (!spec.includes("operationId: PreviewCashCleanup")) {
  const cashCleanupPath = String.raw`
  /payments/admin/cash-cleanup:
    get:
      tags: [payments]
      summary: Preview one-time cash cleanup
      operationId: PreviewCashCleanup
      responses:
        '200':
          description: Cleanup preview
          content:
            application/json:
              schema:
                type: object
                additionalProperties: true
    post:
      tags: [payments]
      summary: Apply one-time cash cleanup
      operationId: ApplyCashCleanup
      requestBody:
        required: false
        content:
          application/json:
            schema:
              type: object
              properties:
                dry_run:
                  type: boolean
                  default: false
      responses:
        '200':
          description: Cleanup result
          content:
            application/json:
              schema:
                type: object
                additionalProperties: true
`;
  spec = spec.replace(marker, `${cashCleanupPath}${marker}`);
  changed = true;
}

if (changed) {
  fs.writeFileSync(specPath, spec);
  console.log("Phase 3 OpenAPI synchronization added the remaining explicit route contracts.");
} else {
  console.log("Phase 3 OpenAPI paths already synchronized.");
}
