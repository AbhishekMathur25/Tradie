/** Sign-up and crew invites against an in-memory Postgres. */
import { beforeAll, describe, expect, it } from "vitest";
import { openPglite, type Db } from "@/db/client";
import {
  acceptInvite,
  findInvite,
  inviteCrew,
  listTeam,
  removeCrew,
  revokeInvite,
  signUp,
} from "@/services/accounts";
import { checkPassword } from "@/lib/passwords";

let db: Db;
const APP = "http://localhost:3000";

beforeAll(async () => {
  db = await openPglite();
});

describe("sign-up", () => {
  it("creates a business and its owner, storing only a password hash", async () => {
    const owner = await signUp(db, {
      businessName: "Test Plumbing",
      name: "Pat Owner",
      email: "  Pat@Example.com ",
      password: "a-long-enough-password",
    });
    expect(owner.role).toBe("owner");
    expect(owner.email).toBe("pat@example.com");
    expect(owner.passwordHash).not.toContain("a-long-enough-password");
    expect(await checkPassword("a-long-enough-password", owner.passwordHash)).toBe(true);
  });

  it("refuses a second account with the same email", async () => {
    await expect(
      signUp(db, {
        businessName: "Other",
        name: "Pat",
        email: "pat@example.com",
        password: "another-long-password",
      }),
    ).rejects.toThrow(/already exists/);
  });
});

describe("crew invites", () => {
  it("lets an owner invite crew who then set a password, once", async () => {
    const owner = await signUp(db, {
      businessName: "Crew Co",
      name: "Olly",
      email: "olly@example.com",
      password: "owner-password-123",
    });
    const actor = { businessId: owner.businessId, userId: owner.id };
    const { token } = await inviteCrew(
      db,
      actor,
      { name: "Chris Crew", email: "chris@example.com" },
      APP,
    );
    expect((await listTeam(db, owner.businessId)).pending).toHaveLength(1);

    const crew = await acceptInvite(db, token, "crew-password-123");
    expect(crew.role).toBe("crew");
    expect(crew.businessId).toBe(owner.businessId);
    await expect(acceptInvite(db, token, "crew-password-123")).rejects.toThrow(
      /expired or was already used/,
    );

    const team = await listTeam(db, owner.businessId);
    expect(team.members.map((m) => m.role).sort()).toEqual(["crew", "owner"]);
    expect(team.pending).toHaveLength(0);

    await removeCrew(db, actor, crew.id);
    await expect(removeCrew(db, actor, owner.id)).rejects.toThrow(/Only crew/);
  });

  it("rejects short passwords and revoked invites", async () => {
    const owner = await signUp(db, {
      businessName: "Rev Co",
      name: "Rae",
      email: "rae@example.com",
      password: "owner-password-123",
    });
    const actor = { businessId: owner.businessId, userId: owner.id };
    const first = await inviteCrew(db, actor, { name: "Sam", email: "sam@example.com" }, APP);
    await expect(acceptInvite(db, first.token, "short")).rejects.toThrow(/at least 10/);

    // Re-inviting replaces the earlier link.
    const second = await inviteCrew(db, actor, { name: "Sam", email: "sam@example.com" }, APP);
    expect(await findInvite(db, first.token)).toBeNull();
    const invite = await findInvite(db, second.token);
    await revokeInvite(db, actor, invite!.id);
    await expect(acceptInvite(db, second.token, "crew-password-123")).rejects.toThrow(/expired/);
  });
});
