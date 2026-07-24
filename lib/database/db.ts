/**
 * Database Connection and Initialization
 *
 * Manages SQLite database connection with WAL mode for better performance
 */

import * as SQLite from 'expo-sqlite';
import { migrations } from './migrations';

class Database {
  private db: SQLite.SQLiteDatabase | null = null;
  private initialized = false;
  private initializationPromise: Promise<void> | null = null;

  /**
   * Initialize the database
   * - Opens connection
   * - Enables foreign keys and WAL mode
   * - Runs migrations
   * Uses a lock to prevent concurrent initializations
   */
  async initialize(): Promise<void> {
    // If already initialized, return immediately
    if (this.initialized) {
      console.log('⚡ Database already initialized - skipping');
      return;
    }

    // If initialization is in progress, wait for it to complete
    if (this.initializationPromise) {
      console.log('⏳ Database initialization in progress - waiting...');
      return this.initializationPromise;
    }

    // Start initialization and store the promise
    this.initializationPromise = this.performInitialization();

    try {
      await this.initializationPromise;
    } finally {
      this.initializationPromise = null;
    }
  }

  /**
   * Internal initialization logic
   */
  private async performInitialization(): Promise<void> {

    const startTime = Date.now();
    console.log('🔧 Database: Starting initialization...');

    try {
      // Open database (creates if doesn't exist)
      const openStartTime = Date.now();
      this.db = await SQLite.openDatabaseAsync('images.db');
      const openDuration = Date.now() - openStartTime;
      console.log(`✅ Database: Opened in ${openDuration}ms`);

      // Enable foreign keys for referential integrity
      const fkStartTime = Date.now();
      await this.db.execAsync('PRAGMA foreign_keys = ON;');
      const fkDuration = Date.now() - fkStartTime;
      console.log(`✅ Database: Foreign keys enabled in ${fkDuration}ms`);

      // Enable WAL (Write-Ahead Logging) mode for better performance
      // WAL allows multiple readers while one writer is active
      const walStartTime = Date.now();
      await this.db.execAsync('PRAGMA journal_mode = WAL;');
      const walDuration = Date.now() - walStartTime;
      console.log(`✅ Database: WAL mode enabled in ${walDuration}ms`);

      // Run migrations to create/update schema
      const migrationsStartTime = Date.now();
      await migrations.run(this.db);
      const migrationsDuration = Date.now() - migrationsStartTime;
      console.log(`✅ Database: Migrations completed in ${migrationsDuration}ms`);

      this.initialized = true;
      const totalDuration = Date.now() - startTime;
      console.log(`🎉 Database initialized successfully in ${totalDuration}ms`);
    } catch (error) {
      console.error('Failed to initialize database:', error);
      throw new Error(`Database initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get the database instance
   * @throws Error if database is not initialized
   */
  getDatabase(): SQLite.SQLiteDatabase {
    if (!this.db || !this.initialized) {
      throw new Error('Database not initialized. Call initialize() first.');
    }
    return this.db;
  }

  /**
   * Close the database connection
   */
  async close(): Promise<void> {
    if (this.db) {
      await this.db.closeAsync();
      this.db = null;
      this.initialized = false;
      console.log('Database closed');
    }
  }

  /**
   * Check if database is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Run pending migrations (useful when adding new migrations after initial setup)
   */
  async runPendingMigrations(): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized. Call initialize() first.');
    }
    await migrations.run(this.db);
  }
}

// Export singleton instance
export const db = new Database();
