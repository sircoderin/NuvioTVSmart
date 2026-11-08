import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.localStorage ||= { getItem: () => null, setItem() {}, removeItem() {} };
const { getSidebarProfileState } =
  await import("./sidebarNavigationHelpers-02-get-sidebar-avatar-catalog.js");
const { sidebarAvatarCatalogPromises } =
  await import("./sidebarNavigationHelpers-01-root-sidebar-items.js");
const { AvatarRepository } = await import("../../data/remote/supabase/avatarRepository.js");
const { MemberAccessRepository } =
  await import("../../data/remote/supabase/memberAccessRepository.js");
const { ProfileManager } = await import("../../core/profile/profileManager.js");

const STANDARD = [{ id: "fox", imageUrl: "https://avatars/fox.png" }];
const MEMBER = [{ id: "gold", imageUrl: "blob:gold" }];

function stub(t, avatarId) {
  const requested = [];
  sidebarAvatarCatalogPromises.clear();
  t.mock.method(ProfileManager, "getActiveProfileId", () => "1");
  t.mock.method(ProfileManager, "getProfiles", async () => [{ id: "1", name: "Ana", avatarId }]);
  t.mock.method(MemberAccessRepository, "getAccess", async () => ({}));
  t.mock.method(MemberAccessRepository, "hasEntitlement", () => true);
  t.mock.method(AvatarRepository, "getAvatarCatalog", async (member) => {
    requested.push(member);
    return member ? [...STANDARD, ...MEMBER] : STANDARD;
  });
  t.mock.method(
    AvatarRepository,
    "getAvatarImageUrl",
    (id, catalog) => catalog.find((a) => a.id === id)?.imageUrl || null
  );
  return requested;
}

test("a standard avatar never loads the supporter avatar set", async (t) => {
  const requested = stub(t, "fox");
  const state = await getSidebarProfileState();
  assert.equal(state.activeProfileAvatarUrl, "https://avatars/fox.png");
  assert.deepEqual(requested, [false]);
});

test("a supporter avatar still resolves", async (t) => {
  const requested = stub(t, "gold");
  const state = await getSidebarProfileState();
  assert.equal(state.activeProfileAvatarUrl, "blob:gold");
  assert.deepEqual(requested, [false, true]);
});
