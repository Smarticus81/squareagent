const pg = require("pg");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  const client = await pool.connect();
  try {
    await client.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        name TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    console.log("users table OK");

    await client.query(`
      CREATE TABLE IF NOT EXISTS organizations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS organizations_owner_idx ON organizations(owner_user_id)`);
    console.log("organizations table OK");

    await client.query(`
      CREATE TABLE IF NOT EXISTS organization_memberships (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role TEXT NOT NULL DEFAULT 'owner',
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS org_memberships_user_idx ON organization_memberships(user_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS org_memberships_org_idx ON organization_memberships(organization_id)`);
    console.log("organization_memberships table OK");

    await client.query(`
      CREATE TABLE IF NOT EXISTS venues (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        square_access_token TEXT,
        square_merchant_id TEXT,
        square_location_id TEXT,
        square_location_name TEXT,
        connected_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`ALTER TABLE venues ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL`);
    await client.query(`CREATE INDEX IF NOT EXISTS venues_organization_idx ON venues(organization_id)`);
    console.log("venues table OK");

    await client.query(`
      CREATE TABLE IF NOT EXISTS service_connections (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        venue_id INTEGER REFERENCES venues(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        credentials JSONB NOT NULL DEFAULT '{}'::jsonb,
        config JSONB NOT NULL DEFAULT '{}'::jsonb,
        status TEXT NOT NULL DEFAULT 'needs_configuration',
        last_health_check JSONB,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS service_connections_org_idx ON service_connections(organization_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS service_connections_venue_idx ON service_connections(venue_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS service_connections_provider_idx ON service_connections(provider)`);
    console.log("service_connections table OK");

    await client.query(`
      CREATE TABLE IF NOT EXISTS agent_profiles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        venue_id INTEGER REFERENCES venues(id) ON DELETE SET NULL,
        connected_service_id UUID REFERENCES service_connections(id) ON DELETE SET NULL,
        display_name TEXT NOT NULL,
        wake_phrase TEXT NOT NULL,
        wake_mode TEXT NOT NULL DEFAULT 'ambient',
        voice_pipeline_provider TEXT NOT NULL,
        voice_pipeline_config JSONB NOT NULL DEFAULT '{}'::jsonb,
        noise_mode TEXT NOT NULL DEFAULT 'standard',
        allowed_tools JSONB NOT NULL DEFAULT '[]'::jsonb,
        confirmation_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
        personality TEXT NOT NULL DEFAULT '',
        is_default BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`ALTER TABLE agent_profiles ADD COLUMN IF NOT EXISTS wake_mode TEXT NOT NULL DEFAULT 'ambient'`);
    await client.query(`CREATE INDEX IF NOT EXISTS agent_profiles_org_idx ON agent_profiles(organization_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS agent_profiles_venue_idx ON agent_profiles(venue_id)`);
    console.log("agent_profiles table OK");

    await client.query(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        stripe_customer_id TEXT,
        stripe_subscription_id TEXT,
        plan TEXT NOT NULL DEFAULT 'trial',
        status TEXT NOT NULL DEFAULT 'trialing',
        trial_ends_at TIMESTAMP,
        current_period_end TIMESTAMP,
        cancel_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    // Keep legacy databases compatible with the current Drizzle schema.
    await client.query(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS organization_id UUID`);
    await client.query(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS clerk_subscription_id TEXT`);
    console.log("subscriptions table OK");

    await client.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    console.log("sessions table OK");

    await client.query(`
      CREATE TABLE IF NOT EXISTS exchange_codes (
        code TEXT PRIMARY KEY,
        token TEXT NOT NULL,
        venue_id TEXT NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    console.log("exchange_codes table OK");
  } finally {
    client.release();
    await pool.end();
  }
  console.log("All tables created successfully!");
}

run().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
