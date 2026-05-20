/**
 * Backfill: migrates legacy venues to the organization model.
 *
 * For each venue with no organization_id:
 *   1. Finds or creates an organization for the venue's user.
 *   2. Sets venues.organization_id to that org's id.
 *   3. Creates a service_connections row with provider="square",
 *      the encrypted credentials, and status="active".
 *
 * Usage:
 *   pnpm tsx artifacts/api-server/scripts/migrate-venues-to-orgs.ts
 */
import pg from "pg";
import { randomUUID } from "node:crypto";
import { encrypt, decrypt } from "../src/lib/secrets";

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

  // Cache of userId -> organizationId so we only create one org per user
  const userOrgMap = new Map<number, string>();

  // Pre-populate from existing memberships
  const { rows: existingMemberships } = await pool.query(
    "SELECT user_id, organization_id FROM organization_memberships WHERE role = 'owner'",
  );
  for (const m of existingMemberships) {
    userOrgMap.set(m.user_id, m.organization_id);
  }

  // Find all venues that don't have an organization yet
  const { rows: venues } = await pool.query(
    `SELECT v.id, v.user_id, v.name, v.square_access_token, v.square_merchant_id,
            v.square_location_id, v.square_location_name
     FROM venues v
     WHERE v.organization_id IS NULL`,
  );

  let migratedVenues = 0;
  let createdOrgs = 0;
  let createdConnections = 0;

  for (const venue of venues) {
    const userId: number = venue.user_id;
    let orgId = userOrgMap.get(userId);

    if (!orgId) {
      // Look up user name for the org
      const { rows: users } = await pool.query("SELECT name FROM users WHERE id = $1", [userId]);
      const userName = users[0]?.name ?? "User";

      orgId = randomUUID();
      await pool.query(
        "INSERT INTO organizations (id, name, owner_user_id) VALUES ($1, $2, $3)",
        [orgId, `${userName}'s Workspace`, userId],
      );
      const membershipId = randomUUID();
      await pool.query(
        "INSERT INTO organization_memberships (id, organization_id, user_id, role) VALUES ($1, $2, $3, 'owner')",
        [membershipId, orgId, userId],
      );
      userOrgMap.set(userId, orgId);
      createdOrgs++;
    }

    // Assign venue to organization
    await pool.query("UPDATE venues SET organization_id = $1 WHERE id = $2", [orgId, venue.id]);
    migratedVenues++;

    // Create a service_connections row if the venue has Square credentials
    if (venue.square_access_token) {
      const plainToken = decrypt(venue.square_access_token);
      const encryptedToken = encrypt(plainToken);

      const connId = randomUUID();
      const credentials = JSON.stringify({ access_token: encryptedToken, merchant_id: venue.square_merchant_id ?? "" });
      const config = JSON.stringify({ location_id: venue.square_location_id ?? "", location_name: venue.square_location_name ?? "" });

      await pool.query(
        `INSERT INTO service_connections (id, organization_id, venue_id, provider, credentials, config, status)
         VALUES ($1, $2, $3, 'square', $4::jsonb, $5::jsonb, 'active')`,
        [connId, orgId, venue.id, credentials, config],
      );
      createdConnections++;
    }
  }

  console.log(
    `Done. Migrated ${migratedVenues} venues, created ${createdOrgs} orgs, created ${createdConnections} service connections.`,
  );
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
