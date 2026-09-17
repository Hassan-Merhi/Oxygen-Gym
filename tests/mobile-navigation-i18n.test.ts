import assert from "node:assert/strict";
import test from "node:test";
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
