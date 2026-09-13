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
})) changed.push("audit.ts");

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
  text = text.replace(/\(\(([A-Za-z_$][\w$]*)\.rows \?\? \1\) as any\[\]\)/g, "sqlRows<AttendanceSqlRow>($1)");
  text = text.replace(/\(([A-Za-z_$][\w$]*)\.rows \?\? \1\) as any\[\]/g, "sqlRows<AttendanceSqlRow>($1)");
  text = text.replace(/\(r: any\)/g, "(r)");
  return text;
})) changed.push("attendance.ts");

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
})) changed.push("notifications.ts");

const paymentsPath = path.join(routes, "payments.ts");
if (writeIfChanged(paymentsPath, (source) => source.replace("          )) as any,\n", "          )),\n"))) {
  changed.push("payments.ts");
}

console.log(changed.length > 0
  ? `Phase 3 explicit-any cleanup updated: ${changed.join(", ")}`
  : "Phase 3 explicit-any cleanup: no changes needed.");
