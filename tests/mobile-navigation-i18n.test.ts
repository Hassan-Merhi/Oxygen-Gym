import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  NAVIGATION_COPY,
  NAVIGATION_LANGUAGE_OPTIONS,
  directionForNavigationLanguage,
  nextNavigationLanguage,
  type NavigationLanguage,
} from "../artifacts/gym-app/src/lib/mobile-navigation";

const languages: NavigationLanguage[] = ["en", "fr", "ar"];

test("mobile navigation uses LTR for English/French and RTL for Arabic", () => {
  assert.equal(directionForNavigationLanguage("en"), "ltr");
  assert.equal(directionForNavigationLanguage("fr"), "ltr");
  assert.equal(directionForNavigationLanguage("ar"), "rtl");
});

test("mobile language cycling covers English, French and Arabic exactly once", () => {
  assert.equal(nextNavigationLanguage("en"), "fr");
  assert.equal(nextNavigationLanguage("fr"), "ar");
  assert.equal(nextNavigationLanguage("ar"), "en");
  assert.deepEqual(NAVIGATION_LANGUAGE_OPTIONS.map((option) => option.value), languages);
});

test("navigation chrome has localized copy for English, French and Arabic", () => {
  for (const language of languages) {
    const copy = NAVIGATION_COPY[language];
    assert.ok(copy.openMenu.length > 0);
    assert.ok(copy.closeMenu.length > 0);
    assert.ok(copy.moreActions.length > 0);
    assert.ok(copy.languageLabel.length > 0);
    assert.ok(copy.memberOverview.length > 0);
    assert.ok(copy.periodReset.length > 0);
    assert.ok(copy.collapse.length > 0);
    assert.ok(copy.expand.length > 0);
    assert.ok(copy.lightMode.length > 0);
    assert.ok(copy.darkMode.length > 0);
  }

  assert.equal(NAVIGATION_COPY.en.languageLabel, "Language");
  assert.equal(NAVIGATION_COPY.fr.languageLabel, "Langue");
  assert.equal(NAVIGATION_COPY.ar.languageLabel, "اللغة");
});

// ─── Dictionary integrity (text-parsed so the zustand store is not loaded) ──

const GYM_SRC = fileURLToPath(new URL("../artifacts/gym-app/src/", import.meta.url));

function dictionaryBlock(source: string, name: string): Map<string, string> {
  const match = source.match(new RegExp(`\\nconst ${name}: Translations = \\{\\n([\\s\\S]*?)\\n\\};`));
  assert.ok(match, `could not find the ${name} dictionary in lib/i18n.ts`);
  const entries = new Map<string, string>();
  for (const line of match[1].matchAll(/^\s*"([^"]+)":\s*"((?:[^"\\]|\\.)*)"/gm)) {
    entries.set(line[1], line[2]);
  }
  return entries;
}

const i18nSource = readFileSync(join(GYM_SRC, "lib/i18n.ts"), "utf8");
const dictionaries = {
  en: dictionaryBlock(i18nSource, "en"),
  fr: dictionaryBlock(i18nSource, "fr"),
  ar: dictionaryBlock(i18nSource, "ar"),
};

// Pages owned by the accounting workstream use lib/i18n-accounting.ts.
const EXCLUDED = new Set([
  "pages/cash-book-canonical.tsx",
  "pages/payments.tsx",
  "pages/accounts.tsx",
  "pages/financials.tsx",
  "pages/period-reset.tsx",
  "pages/audit.tsx",
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

const appFiles = sourceFiles(GYM_SRC)
  .map((path) => ({ path, rel: relative(GYM_SRC, path).replace(/\\/g, "/") }))
  .filter(({ rel }) => !EXCLUDED.has(rel) && !rel.startsWith("lib/i18n"));

test("English, French and Arabic dictionaries define exactly the same keys", () => {
  const enKeys = [...dictionaries.en.keys()].sort();
  for (const language of ["fr", "ar"] as const) {
    const keys = [...dictionaries[language].keys()].sort();
    const missing = enKeys.filter((key) => !dictionaries[language].has(key));
    const extra = keys.filter((key) => !dictionaries.en.has(key));
    assert.deepEqual(missing, [], `${language} is missing keys`);
    assert.deepEqual(extra, [], `${language} has keys that English lacks`);
  }
});

test("no dictionary value is empty", () => {
  for (const [language, entries] of Object.entries(dictionaries)) {
    for (const [key, value] of entries) {
      assert.ok(value.trim().length > 0, `${language}.${key} is empty`);
    }
  }
});

test("every literal t(\"key\") used by the app exists in the dictionaries", () => {
  const missing: string[] = [];
  for (const { path, rel } of appFiles) {
    const source = readFileSync(path, "utf8");
    for (const match of source.matchAll(/\bt\(\s*"([a-zA-Z0-9_.-]+)"\s*[,)]/g)) {
      if (!dictionaries.en.has(match[1])) missing.push(`${rel}: ${match[1]}`);
    }
  }
  assert.deepEqual(missing, []);
});

test("no t(key) || \"fallback\" patterns hide missing translations", () => {
  const offenders: string[] = [];
  for (const { path, rel } of appFiles) {
    const source = readFileSync(path, "utf8");
    for (const match of source.matchAll(/\bt\(\s*["'`][^)]*\)\s*\|\|\s*["'`]/g)) {
      offenders.push(`${rel}: ${match[0]}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("French is the default interface language", () => {
  assert.match(i18nSource, /persist\(\s*\(set, get\) => \(\{\s*language: "fr"/);
  assert.match(readFileSync(join(GYM_SRC, "../index.html"), "utf8"), /<html[^>]*lang="fr"/);
});

test("approveCorrections permission is labelled in every language", () => {
  assert.equal(dictionaries.en.get("perm.approveCorrections"), "Approve corrections & voids");
  assert.equal(dictionaries.fr.get("perm.approveCorrections"), "Approuver corrections et annulations");
  assert.equal(dictionaries.ar.get("perm.approveCorrections"), "اعتماد التصحيحات والإلغاءات");
});
