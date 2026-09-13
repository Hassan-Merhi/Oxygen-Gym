import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const routes = path.join(root, "artifacts/api-server/src/routes");

function writeIfChanged(file, transform) {
  const before = fs.readFileSync(file, "utf8");
  const after = transform(before);
  if (after === before) return false;
  fs.writeFileSync(file, after);
  return true;
}

const changed = [];
function markChanged(name) {
  if (!changed.includes(name)) changed.push(name);
}

const auditPath = path.join(routes, "audit.ts");
if (writeIfChanged(auditPath, (source) => {
  let text = source;
  if (!text.includes('from "../lib/sql-rows"')) {
    text = text.replace(
      'import { db } from "@workspace/db";\n',
      'import { db } from "@workspace/db";\nimport { sqlRows } from "../lib/sql-rows";\n',
    );
  }

  if (!text.includes("interface AuditSqlRow")) {
    const marker = `interface AuditSection {\n  name: string;\n  pass: boolean;\n  issueCount: number;\n  issues: AuditIssue[];\n}\n`;
    const addition = `${marker}\ntype AuditSqlScalar = string | number | boolean | null | undefined;\ninterface AuditSqlRow {\n  id?: string | number;\n  permissions?: Record<string, boolean>;\n  expiryDate?: string | number;\n  [key: string]: AuditSqlScalar | Record<string, boolean>;\n}\n`;
    text = text.replace(marker, addition);
  }

  text = text.replace(
    "Promise<{ section: AuditSection; rows: any[] }>",
    "Promise<{ section: AuditSection; rows: AuditSqlRow[] }>",
  );
  text = text.replace(/\(([A-Za-z_$][\w$.]*)\.rows\[0\] as any\)/g, "sqlRows<AuditSqlRow>($1)[0]");
  text = text.replace(/\(([A-Za-z_$][\w$.]*)\.rows as any\[\]\)/g, "sqlRows<AuditSqlRow>($1)");
  text = text.replace(/([A-Za-z_$][\w$.]*)\.rows as any\[\]/g, "sqlRows<AuditSqlRow>($1)");
  text = text.replace("new Date(r.expiryDate)", "new Date(String(r.expiryDate ?? \"\"))");
  return text;
})) markChanged("audit.ts");

const attendancePath = path.join(routes, "attendance.ts");
if (writeIfChanged(attendancePath, (source) => {
  let text = source;
  if (!text.includes('from "../lib/sql-rows"')) {
    text = text.replace(
      'import { lubumbashiTodayStart, lubumbashiTodayEnd } from "../lib/timezone";\n',
      'import { lubumbashiTodayStart, lubumbashiTodayEnd } from "../lib/timezone";\nimport { sqlRows } from "../lib/sql-rows";\n',
    );
  }
  if (!text.includes("interface AttendanceSqlRow")) {
    text = text.replace(
      "const router = Router();\nrouter.use(requireAuth());\n",
      `const router = Router();\nrouter.use(requireAuth());\n\ninterface AttendanceSqlRow {\n  id?: number;\n  memberId?: number;\n  memberName?: string;\n  checkedInAt?: string | Date;\n  planName?: string | null;\n  date?: string;\n  month?: string;\n  hour?: number;\n  day?: string;\n  count?: number | string;\n  cnt?: number | string;\n}\n`,
    );
  }

  text = text.replace(/\(([A-Za-z_$][\w$.]*)\.rows as any\[\]\)/g, "sqlRows<AttendanceSqlRow>($1)");
  text = text.replace(/([A-Za-z_$][\w$.]*)\.rows as any\[\]/g, "sqlRows<AttendanceSqlRow>($1)");
  text = text.replace(/\(\(([A-Za-z_$][\w$]*)\.rows \?\? \1\) as any\[\]\)/g, "sqlRows<AttendanceSqlRow>($1)");
  text = text.replace(/\(([A-Za-z_$][\w$]*)\.rows \?\? \1\) as any\[\]/g, "sqlRows<AttendanceSqlRow>($1)");
  text = text.replace(/\(r: any\)/g, "(r)");
  text = text.replaceAll(
    "res.jsonsqlRows<AttendanceSqlRow>(rows);",
    "res.json(sqlRows<AttendanceSqlRow>(rows));",
  );
  text = text.replace(
    "monthlyHistory.filter(r => r.count > 0).length",
    "monthlyHistory.filter((r) => Number(r.count ?? 0) > 0).length",
  );
  return text;
})) markChanged("attendance.ts");

const notificationsPath = path.join(routes, "notifications.ts");
if (writeIfChanged(notificationsPath, (source) => {
  let text = source;
  if (!text.includes('from "../lib/sql-rows"')) {
    text = text.replace(
      'import { logActivity } from "../lib/activity";\n',
      'import { logActivity } from "../lib/activity";\nimport { sqlRows } from "../lib/sql-rows";\n',
    );
  }
  if (!text.includes("interface NotificationSqlRow")) {
    text = text.replace(
      "interface Notification {\n",
      `interface NotificationSqlRow {\n  id?: number;\n  name?: string;\n  quantity?: number | string;\n  alertQuantity?: number | string;\n}\n\ninterface Notification {\n`,
    );
  }
  text = text.replace("permissions: any", "permissions: Record<string, boolean> | null");
  text = text.replace(/\(\(lowStockProducts\.rows \?\? lowStockProducts\) as any\[\]\)/g, "sqlRows<NotificationSqlRow>(lowStockProducts)");
  text = text.replace(/\(\(outOfStockProducts\.rows \?\? outOfStockProducts\) as any\[\]\)/g, "sqlRows<NotificationSqlRow>(outOfStockProducts)");
  text = text.replace("draftPayrolls as any[]", "draftPayrolls");
  return text;
})) markChanged("notifications.ts");

const paymentsPath = path.join(routes, "payments.ts");
if (writeIfChanged(paymentsPath, (source) => source.replace("          )) as any,\n", "          )),\n"))) {
  markChanged("payments.ts");
}

// Generated path contracts coerce integer parameters to numbers. Legacy route
// code still wrapped several of those values in parseInt(... as string), which
// is both redundant and rejected by TS 5.9. Normalize only this generated-
// contract pattern; unrelated string assertions are left untouched.
for (const entry of fs.readdirSync(routes, { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith(".ts") || entry.name === "index.ts") continue;
  const file = path.join(routes, entry.name);
  if (writeIfChanged(file, (source) => source.replace(
    /parseInt\((contractParams\(req,\s*ApiContracts\.[A-Za-z0-9_]+Params\)\.[A-Za-z0-9_]+)\s+as\s+string\)/g,
    "Number($1)",
  ))) {
    markChanged(entry.name);
  }
}

console.log(changed.length > 0
  ? `Phase 3 typed-route cleanup updated: ${changed.join(", ")}`
  : "Phase 3 typed-route cleanup: no changes needed.");
