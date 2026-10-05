import assert from "node:assert/strict";
import { test } from "node:test";
import { matchStreamBadges, prepareStreamBadgeRules } from "./streamBadgeRules.js";

function rules(pattern, name = "Release") {
  return {
    imports: [{ sourceUrl: "fixture", filters: [{ name, pattern, imageURL: "badge.png" }] }]
  };
}

test("preloading and rendering cloned streams reuse badge matches", () => {
  const config = rules("(?i)TVPERF-CACHE");
  const stream = { title: "TVPERF-CACHE 1080p" };
  const expected = matchStreamBadges(stream, config);
  assert.equal(expected.length, 1);
  const original = RegExp.prototype.test;
  let tests = 0;
  RegExp.prototype.test = function (value) {
    if (this.source.includes("TVPERF-CACHE")) tests++;
    return original.call(this, value);
  };
  try {
    assert.deepEqual(matchStreamBadges({ ...stream }, structuredClone(config)), expected);
    assert.deepEqual(matchStreamBadges({ ...stream }, config), expected);
    assert.equal(tests, 0, "identical presentations must not rerun badge regexes");
  } finally {
    RegExp.prototype.test = original;
  }
});

test("changed stream metadata and edited rules invalidate cached matches", () => {
  const config = rules("TVPERF-CHANGE");
  const stream = { title: "TVPERF-CHANGE" };
  assert.equal(matchStreamBadges(stream, config).length, 1);
  stream.title = "different release";
  assert.equal(matchStreamBadges(stream, config).length, 0);
  config.imports[0].filters[0].pattern = "different";
  config.imports[0].filters[0].name = "Updated";
  assert.equal(matchStreamBadges(stream, config)[0].name, "Updated");
  config.imports[0].filters[0].isEnabled = false;
  assert.equal(matchStreamBadges(stream, config).length, 0);
});

test("cached misses remain misses and callers cannot modify cached badges", () => {
  const config = rules("TVPERF-OWNERSHIP");
  assert.deepEqual(matchStreamBadges({ title: "unmatched" }, config), []);
  assert.deepEqual(matchStreamBadges({ title: "unmatched" }, config), []);
  const stream = { title: "TVPERF-OWNERSHIP" };
  const first = matchStreamBadges(stream, config);
  first[0].name = "Caller edit";
  first.push({ name: "Extra" });
  assert.deepEqual(
    matchStreamBadges(stream, config).map((b) => b.name),
    ["Release"]
  );
});

test("prepared render snapshots isolate settings edits and retain cached matches", () => {
  const config = rules("TVPERF-SNAPSHOT");
  const snapshot = prepareStreamBadgeRules(config);
  const stream = { title: "TVPERF-SNAPSHOT" };
  assert.equal(matchStreamBadges(stream, snapshot)[0].name, "Release");
  config.imports[0].filters[0].name = "Edited";
  assert.equal(matchStreamBadges(stream, snapshot)[0].name, "Release");
  assert.equal(matchStreamBadges(stream, prepareStreamBadgeRules(config))[0].name, "Edited");
  assert.throws(() => {
    snapshot.imports[0].filters[0].isEnabled = false;
  }, TypeError);
});

test("release-group lookaheads match the original regex on cold stream metadata", () => {
  const patterns = [
    "(?=.*WEB[-. ]DL)(?=.*\\b(?:TVPERF-COLD|OtherGroup)\\b)",
    "(?=.*WEB[-. ]DL)(?=.*TVPERF-COLD)(?=.*1080p)",
    "(?=.*[()]TVPERF-COLD)(?=.*WEB-DL)",
    "(?=.*WEB-DL)(?!.*TVPERF-COLD)",
    "(?=WEB-DL)(?=.*TVPERF-COLD)",
    "(?=.*(WEB-DL))(?=.*TVPERF-COLD)",
    "(?=.*WEB-DL)TVPERF-COLD"
  ];
  const titles = [
    "TVPERF-COLD.WEB-DL.1080p",
    "Title 1080p WEB DL TVPERF-COLD",
    "Title WEB-DL OtherGroup",
    "Title (TVPERF-COLD) WEB-DL",
    "WEB-DL TVPERF-COLD",
    "prefix WEB-DL",
    "no matching release",
    "prefix\u2028WEB-DL TVPERF-COLD",
    "prefix\u2029WEB-DL TVPERF-COLD",
    ""
  ];
  for (const pattern of patterns) {
    const expected = new RegExp(pattern, "i");
    const config = rules(`(?i)${pattern}`);
    for (const title of titles) {
      assert.equal(
        matchStreamBadges({ title }, config).length > 0,
        expected.test(title),
        `${pattern}: ${title}`
      );
    }
  }
});
