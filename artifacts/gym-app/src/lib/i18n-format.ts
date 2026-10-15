/**
 * Fill `{name}` placeholders in a translated string.
 *
 *   fmt(t("common.pageOf"), { page: 2, total: 5 }) // "Page 2 sur 5"
 */
export function fmt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}
