/**
 * Database Migrations System
 *
 * Version-based migration system for schema changes
 */

import type * as SQLite from 'expo-sqlite';

interface Migration {
  version: number;
  name: string;
  up: string[];
}

/**
 * Define all database migrations
 * Each migration should be idempotent (safe to run multiple times)
 */
const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    up: [
      // Create images table
      `CREATE TABLE IF NOT EXISTS images (
        -- Primary Key
        id TEXT PRIMARY KEY NOT NULL,

        -- File Locations
        localUri TEXT NOT NULL,
        remoteUri TEXT,

        -- Classification
        type TEXT NOT NULL,
        category TEXT,

        -- Metadata (JSON)
        metadata TEXT,

        -- Timestamps
        createdAt INTEGER NOT NULL,
        lastAccessedAt INTEGER NOT NULL,
        syncedAt INTEGER,

        -- Status
        status TEXT NOT NULL DEFAULT 'active',

        -- File Info
        fileSize INTEGER,
        mimeType TEXT,
        width INTEGER,
        height INTEGER
      );`,

      // Create indexes for performance
      `CREATE INDEX IF NOT EXISTS idx_type ON images(type);`,
      `CREATE INDEX IF NOT EXISTS idx_category ON images(category);`,
      `CREATE INDEX IF NOT EXISTS idx_createdAt ON images(createdAt DESC);`,
      `CREATE INDEX IF NOT EXISTS idx_lastAccessedAt ON images(lastAccessedAt);`,
      `CREATE INDEX IF NOT EXISTS idx_status ON images(status);`,
      `CREATE INDEX IF NOT EXISTS idx_remoteUri ON images(remoteUri);`,

      // Composite index for common query pattern
      `CREATE INDEX IF NOT EXISTS idx_type_status_created
        ON images(type, status, createdAt DESC);`,

      // Create image_relations table for souls with multiple images
      `CREATE TABLE IF NOT EXISTS image_relations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        parentId TEXT NOT NULL,
        imageId TEXT NOT NULL,
        position INTEGER NOT NULL,
        FOREIGN KEY (imageId) REFERENCES images(id) ON DELETE CASCADE
      );`,

      `CREATE INDEX IF NOT EXISTS idx_parent ON image_relations(parentId);`,
      `CREATE INDEX IF NOT EXISTS idx_image ON image_relations(imageId);`,

      // Create cache_stats table for analytics
      `CREATE TABLE IF NOT EXISTS cache_stats (
        date TEXT PRIMARY KEY NOT NULL,
        totalImages INTEGER NOT NULL,
        totalSizeBytes INTEGER NOT NULL,
        hitRate REAL,
        avgLoadTimeMs REAL
      );`,

      // Create migration_version table to track applied migrations
      `CREATE TABLE IF NOT EXISTS migration_version (
        version INTEGER PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        appliedAt INTEGER NOT NULL
      );`,
    ],
  },
  {
    version: 2,
    name: 'add_settings_table',
    up: [
      // Create settings table for key-value storage
      `CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL,
        updatedAt INTEGER NOT NULL
      );`,
    ],
  },
  {
    version: 3,
    name: 'add_custom_models_table',
    up: [
      // Create custom_models table for user-defined Replicate models
      `CREATE TABLE IF NOT EXISTS custom_models (
        id TEXT PRIMARY KEY NOT NULL,
        replicate_model TEXT NOT NULL,
        version_hash TEXT,
        name TEXT NOT NULL,
        description TEXT,
        schema TEXT NOT NULL,
        field_mapping TEXT NOT NULL,
        optimization_settings TEXT,
        pricing TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_used_at INTEGER,
        usage_count INTEGER DEFAULT 0
      );`,

      // Create indexes for performance
      `CREATE INDEX IF NOT EXISTS idx_custom_models_created_at ON custom_models(created_at DESC);`,
      `CREATE INDEX IF NOT EXISTS idx_custom_models_replicate_model ON custom_models(replicate_model);`,
    ],
  },
  {
    version: 4,
    name: 'add_recipes_tables',
    up: [
      // Create recipes table
      `CREATE TABLE IF NOT EXISTS recipes (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        input_type TEXT NOT NULL,
        input_description TEXT,
        is_public INTEGER DEFAULT 0,
        steps TEXT NOT NULL,
        example_input_uri TEXT,
        example_result_uri TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        is_favorite INTEGER DEFAULT 0
      );`,

      // Create indexes for recipes
      `CREATE INDEX IF NOT EXISTS idx_recipes_created_at ON recipes(created_at DESC);`,
      `CREATE INDEX IF NOT EXISTS idx_recipes_favorite ON recipes(is_favorite);`,

      // Create recipe_executions table
      `CREATE TABLE IF NOT EXISTS recipe_executions (
        id TEXT PRIMARY KEY NOT NULL,
        recipe_id TEXT NOT NULL,
        status TEXT NOT NULL,
        current_step_index INTEGER NOT NULL,
        started_at INTEGER NOT NULL,
        completed_at INTEGER,
        error TEXT,
        step_results TEXT,
        FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
      );`,

      // Create indexes for recipe_executions
      `CREATE INDEX IF NOT EXISTS idx_recipe_executions_recipe_id ON recipe_executions(recipe_id);`,
      `CREATE INDEX IF NOT EXISTS idx_recipe_executions_status ON recipe_executions(status);`,
    ],
  },
  {
    version: 5,
    name: 'update_recipes_schema',
    up: [
      // SQLite doesn't support DROP COLUMN, so we need to recreate the table
      // Create new table with updated schema
      `CREATE TABLE recipes_new (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        input_type TEXT NOT NULL,
        input_description TEXT,
        is_public INTEGER DEFAULT 0,
        steps TEXT NOT NULL,
        example_input_uri TEXT,
        example_result_uri TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        is_favorite INTEGER DEFAULT 0
      );`,

      // Copy existing data (excluding description column if it exists)
      `INSERT INTO recipes_new (id, name, input_type, input_description, steps, example_input_uri, example_result_uri, created_at, updated_at, is_favorite)
       SELECT id, name, input_type, input_description, steps, example_input_uri, example_result_uri, created_at, updated_at, is_favorite
       FROM recipes;`,

      // Drop old table
      `DROP TABLE recipes;`,

      // Rename new table
      `ALTER TABLE recipes_new RENAME TO recipes;`,

      // Recreate indexes
      `CREATE INDEX IF NOT EXISTS idx_recipes_created_at ON recipes(created_at DESC);`,
      `CREATE INDEX IF NOT EXISTS idx_recipes_favorite ON recipes(is_favorite);`,
    ],
  },
  {
    version: 6,
    name: 'add_souls_table',
    up: [
      // Create souls table
      `CREATE TABLE IF NOT EXISTS souls (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER
      );`,

      // Create indexes for souls
      `CREATE INDEX IF NOT EXISTS idx_souls_created_at ON souls(created_at DESC);`,
      `CREATE INDEX IF NOT EXISTS idx_souls_name ON souls(name);`,
    ],
  },
  {
    version: 7,
    name: 'add_supabase_recipe_id_to_recipes',
    up: [
      // Add supabase_recipe_id column to recipes table
      `ALTER TABLE recipes ADD COLUMN supabase_recipe_id TEXT;`,

      // Create index for faster lookups
      `CREATE INDEX IF NOT EXISTS idx_recipes_supabase_id ON recipes(supabase_recipe_id);`,
    ],
  },
  {
    version: 8,
    name: 'add_is_hidden_to_recipes',
    up: [
      // Add is_hidden column to recipes table for temporary imports
      `ALTER TABLE recipes ADD COLUMN is_hidden INTEGER DEFAULT 0;`,

      // Create index for filtering hidden recipes
      `CREATE INDEX IF NOT EXISTS idx_recipes_hidden ON recipes(is_hidden);`,
    ],
  },
  {
    version: 9,
    name: 'convert_absolute_paths_to_relative',
    up: [
      // Convert absolute paths to relative paths in images table
      // This ensures paths survive app reinstalls when iOS changes container UUID
      // Pattern: extract 'generated_images/...' from full absolute path
      `UPDATE images
       SET localUri = substr(localUri, instr(localUri, 'generated_images/'))
       WHERE localUri LIKE '%generated_images/%'
         AND localUri NOT LIKE 'generated_images/%';`,
    ],
  },
  {
    version: 10,
    name: 'move_library_images_to_document_directory',
    up: [
      // Note: This migration is handled by imageManager.migrateImagesToDocumentDirectory()
      // We changed storage location for library/generated images from cache to document directory
      // to prevent iOS from auto-deleting them when storage is low
      // The actual file moving happens in TypeScript, not SQL
      `SELECT 1;`, // No-op SQL statement
    ],
  },
  {
    version: 11,
    name: 'add_synced_at_to_souls',
    up: [
      // Add synced_at column to souls table for Supabase sync tracking
      `ALTER TABLE souls ADD COLUMN synced_at INTEGER;`,
    ],
  },
  {
    version: 12,
    name: 'add_library_favorites',
    up: [
      `ALTER TABLE images ADD COLUMN is_favorite INTEGER DEFAULT 0;`,
      `ALTER TABLE images ADD COLUMN favorite_synced_at INTEGER;`,
      `ALTER TABLE images ADD COLUMN favorite_remote_id TEXT;`,
      `CREATE INDEX idx_images_favorite ON images(is_favorite);`,
    ],
  },
  {
    version: 13,
    name: 'add_reference_image_uris_to_recipes',
    up: [
      `ALTER TABLE recipes ADD COLUMN reference_image_uris TEXT;`,
    ],
  },
  {
    version: 14,
    name: 'add_photo_input_label_and_instructions_to_recipes',
    up: [
      `ALTER TABLE recipes ADD COLUMN photo_input_label TEXT;`,
      `ALTER TABLE recipes ADD COLUMN instructions TEXT;`,
    ],
  },
  {
    version: 15,
    name: 'add_remote_id_to_souls',
    up: [
      // Store the Supabase soul UUID locally so re-syncs reuse the same
      // cloud row instead of inserting a duplicate.
      `ALTER TABLE souls ADD COLUMN remote_id TEXT;`,
    ],
  },
];

class MigrationManager {
  /**
   * Get the current database version
   */
  private async getCurrentVersion(db: SQLite.SQLiteDatabase): Promise<number> {
    try {
      // Try to get the latest version from migration_version table
      const result = await db.getFirstAsync<{ version: number }>(
        'SELECT MAX(version) as version FROM migration_version'
      );
      return result?.version ?? 0;
    } catch (error) {
      // Table doesn't exist yet, we're at version 0
      return 0;
    }
  }

  /**
   * Record a migration as applied
   */
  private async recordMigration(
    db: SQLite.SQLiteDatabase,
    migration: Migration
  ): Promise<void> {
    await db.runAsync(
      'INSERT OR REPLACE INTO migration_version (version, name, appliedAt) VALUES (?, ?, ?)',
      [migration.version, migration.name, Date.now()]
    );
  }

  /**
   * Run all pending migrations
   */
  async run(db: SQLite.SQLiteDatabase): Promise<void> {
    const startTime = Date.now();

    const versionStartTime = Date.now();
    const currentVersion = await this.getCurrentVersion(db);
    const versionDuration = Date.now() - versionStartTime;
    console.log(`🔍 Migrations: Current database version: ${currentVersion} (checked in ${versionDuration}ms)`);

    // Get migrations that need to be applied
    const pendingMigrations = MIGRATIONS.filter(
      (m) => m.version > currentVersion
    );

    if (pendingMigrations.length === 0) {
      const totalDuration = Date.now() - startTime;
      console.log(`✅ Migrations: Database schema is up to date (${totalDuration}ms)`);
      return;
    }

    console.log(`🔧 Migrations: Applying ${pendingMigrations.length} migration(s)...`);

    // Apply each migration in a transaction
    for (const migration of pendingMigrations) {
      const migrationStartTime = Date.now();
      console.log(`🔧 Migrations: Applying migration ${migration.version}: ${migration.name}`);

      try {
        await db.withTransactionAsync(async () => {
          // Execute all SQL statements in the migration
          for (const sql of migration.up) {
            await db.execAsync(sql);
          }

          // Record the migration
          await this.recordMigration(db, migration);
        });

        const migrationDuration = Date.now() - migrationStartTime;
        console.log(`✅ Migrations: Migration ${migration.version} applied successfully in ${migrationDuration}ms`);
      } catch (error) {
        console.error(`❌ Migrations: Failed to apply migration ${migration.version}:`, error);
        throw new Error(
          `Migration ${migration.version} failed: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    }

    const totalDuration = Date.now() - startTime;
    console.log(`🎉 Migrations: All migrations applied successfully in ${totalDuration}ms`);
  }

  /**
   * Get list of applied migrations
   */
  async getAppliedMigrations(db: SQLite.SQLiteDatabase): Promise<Migration[]> {
    try {
      const results = await db.getAllAsync<{
        version: number;
        name: string;
        appliedAt: number;
      }>('SELECT version, name, appliedAt FROM migration_version ORDER BY version');

      return results.map((r) => {
        const migration = MIGRATIONS.find((m) => m.version === r.version);
        return migration || {
          version: r.version,
          name: r.name,
          up: [],
        };
      });
    } catch (error) {
      return [];
    }
  }
}

// Export singleton instance
export const migrations = new MigrationManager();
