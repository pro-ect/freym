/**
 * Database Query Layer
 *
 * All database queries use prepared statements for security and performance
 */

import { db } from './db';
import type { ImageRecord, ImageType, ImageStatus, QueryOptions } from '../types';

/**
 * Map database row to ImageRecord type
 */
function mapRowToRecord(row: any): ImageRecord {
  return {
    id: row.id,
    localUri: row.localUri,
    remoteUri: row.remoteUri || undefined,
    type: row.type,
    category: row.category || undefined,
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    createdAt: row.createdAt,
    lastAccessedAt: row.lastAccessedAt,
    syncedAt: row.syncedAt || undefined,
    status: row.status,
    fileSize: row.fileSize || undefined,
    mimeType: row.mimeType || undefined,
    width: row.width || undefined,
    height: row.height || undefined,
    is_favorite: row.is_favorite || 0,
    favorite_synced_at: row.favorite_synced_at || undefined,
    favorite_remote_id: row.favorite_remote_id || undefined,
  };
}

export const queries = {
  /**
   * Insert a new image record
   */
  async insertImage(record: ImageRecord): Promise<void> {
    const database = db.getDatabase();

    await database.runAsync(
      `INSERT INTO images (
        id, localUri, remoteUri, type, category, metadata,
        createdAt, lastAccessedAt, syncedAt, status,
        fileSize, mimeType, width, height
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.id,
        record.localUri,
        record.remoteUri || null,
        record.type,
        record.category || null,
        record.metadata ? JSON.stringify(record.metadata) : null,
        record.createdAt,
        record.lastAccessedAt,
        record.syncedAt || null,
        record.status,
        record.fileSize || null,
        record.mimeType || null,
        record.width || null,
        record.height || null,
      ]
    );
  },

  /**
   * Get an image by ID
   */
  async getImageById(id: string): Promise<ImageRecord | null> {
    const database = db.getDatabase();

    const result = await database.getFirstAsync<any>(
      'SELECT * FROM images WHERE id = ? AND status != ?',
      [id, 'deleted']
    );

    return result ? mapRowToRecord(result) : null;
  },

  /**
   * Get images by type with optional filtering
   */
  async getImagesByType(
    type: ImageType,
    options: QueryOptions = {}
  ): Promise<ImageRecord[]> {
    const database = db.getDatabase();

    let query = 'SELECT * FROM images WHERE type = ? AND status = ?';
    const params: any[] = [type, options.status || 'active'];

    if (options.category) {
      query += ' AND category = ?';
      params.push(options.category);
    }

    // Order by
    const orderBy = options.orderBy || 'createdAt';
    const orderDirection = options.orderDirection || 'DESC';
    query += ` ORDER BY ${orderBy} ${orderDirection}`;

    // Pagination
    if (options.limit) {
      query += ' LIMIT ?';
      params.push(options.limit);
    }

    if (options.offset) {
      query += ' OFFSET ?';
      params.push(options.offset);
    }

    const results = await database.getAllAsync<any>(query, params);
    return results.map(mapRowToRecord);
  },

  /**
   * Get all active images
   */
  async getAllActiveImages(): Promise<ImageRecord[]> {
    const database = db.getDatabase();

    const results = await database.getAllAsync<any>(
      'SELECT * FROM images WHERE status = ? ORDER BY createdAt DESC',
      ['active']
    );

    return results.map(mapRowToRecord);
  },

  /**
   * Get ALL images (including deleted) - for migrations
   */
  async getAllImages(): Promise<ImageRecord[]> {
    const database = db.getDatabase();

    const results = await database.getAllAsync<any>(
      'SELECT * FROM images ORDER BY createdAt DESC'
    );

    return results.map(mapRowToRecord);
  },

  /**
   * Get images older than a timestamp (for cleanup)
   */
  async getImagesOlderThan(timestamp: number): Promise<ImageRecord[]> {
    const database = db.getDatabase();

    const results = await database.getAllAsync<any>(
      'SELECT * FROM images WHERE lastAccessedAt < ? AND status = ?',
      [timestamp, 'active']
    );

    return results.map(mapRowToRecord);
  },

  /**
   * Get images by status
   */
  async getImagesByStatus(status: ImageStatus): Promise<ImageRecord[]> {
    const database = db.getDatabase();

    const results = await database.getAllAsync<any>(
      'SELECT * FROM images WHERE status = ? ORDER BY createdAt DESC',
      [status]
    );

    return results.map(mapRowToRecord);
  },

  /**
   * Update last accessed time (for LRU cache management)
   */
  async updateLastAccessed(id: string, timestamp: number): Promise<void> {
    const database = db.getDatabase();

    await database.runAsync(
      'UPDATE images SET lastAccessedAt = ? WHERE id = ?',
      [timestamp, id]
    );
  },

  /**
   * Update image status
   */
  async updateImageStatus(id: string, status: ImageStatus): Promise<void> {
    const database = db.getDatabase();

    await database.runAsync(
      'UPDATE images SET status = ? WHERE id = ?',
      [status, id]
    );
  },

  /**
   * Update an image record with partial updates
   */
  async updateImage(id: string, updates: Partial<ImageRecord>): Promise<void> {
    const database = db.getDatabase();

    // Build dynamic UPDATE query
    const fields: string[] = [];
    const values: any[] = [];

    Object.entries(updates).forEach(([key, value]) => {
      if (key === 'id') return; // Don't update ID

      fields.push(`${key} = ?`);

      // Special handling for metadata
      if (key === 'metadata' && value) {
        values.push(JSON.stringify(value));
      } else {
        values.push(value ?? null);
      }
    });

    if (fields.length === 0) return;

    values.push(id); // Add ID for WHERE clause

    const query = `UPDATE images SET ${fields.join(', ')} WHERE id = ?`;
    await database.runAsync(query, values);
  },

  /**
   * Hard delete an image record
   */
  async deleteImage(id: string): Promise<void> {
    const database = db.getDatabase();

    await database.runAsync('DELETE FROM images WHERE id = ?', [id]);
  },

  /**
   * Get count of images by type
   */
  async getImageCountByType(type: ImageType): Promise<number> {
    const database = db.getDatabase();

    const result = await database.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) as count FROM images WHERE type = ? AND status = ?',
      [type, 'active']
    );

    return result?.count ?? 0;
  },

  /**
   * Get total file size of all images
   */
  async getTotalFileSize(): Promise<number> {
    const database = db.getDatabase();

    const result = await database.getFirstAsync<{ total: number }>(
      'SELECT SUM(fileSize) as total FROM images WHERE status = ?',
      ['active']
    );

    return result?.total ?? 0;
  },

  /**
   * Search images by metadata
   * (Simple implementation - can be enhanced with FTS5 for full-text search)
   */
  async searchImages(searchTerm: string): Promise<ImageRecord[]> {
    const database = db.getDatabase();

    const results = await database.getAllAsync<any>(
      `SELECT * FROM images
       WHERE status = 'active'
         AND (
           category LIKE ? OR
           metadata LIKE ?
         )
       ORDER BY createdAt DESC`,
      [`%${searchTerm}%`, `%${searchTerm}%`]
    );

    return results.map(mapRowToRecord);
  },

  // Image Relations (for Souls)

  /**
   * Add an image to a parent (e.g., Soul)
   */
  async addImageRelation(
    parentId: string,
    imageId: string,
    position: number
  ): Promise<void> {
    console.log(`🔗 [SQLite] Adding image relation: parentId=${parentId}, imageId=${imageId}, position=${position}`);
    const database = db.getDatabase();

    try {
      await database.runAsync(
        'INSERT INTO image_relations (parentId, imageId, position) VALUES (?, ?, ?)',
        [parentId, imageId, position]
      );
      console.log(`✅ [SQLite] Image relation added successfully`);
    } catch (error) {
      console.error(`❌ [SQLite] Failed to add image relation:`, error);
      throw error;
    }
  },

  /**
   * Get all images for a parent
   */
  async getImageRelations(parentId: string): Promise<ImageRecord[]> {
    console.log(`🔍 [SQLite] Getting image relations for parent: ${parentId}`);
    const database = db.getDatabase();

    try {
      const results = await database.getAllAsync<any>(
        `SELECT i.* FROM images i
         INNER JOIN image_relations ir ON i.id = ir.imageId
         WHERE ir.parentId = ?
         ORDER BY ir.position ASC`,
        [parentId]
      );

      console.log(`✅ [SQLite] Found ${results.length} image relation(s) for ${parentId}`);
      if (results.length > 0) {
        console.log(`📸 [SQLite] Image IDs:`, results.map(r => r.id));
      }

      return results.map(mapRowToRecord);
    } catch (error) {
      console.error(`❌ [SQLite] Failed to get image relations:`, error);
      throw error;
    }
  },

  /**
   * Remove image relation
   */
  async removeImageRelation(parentId: string, imageId: string): Promise<void> {
    const database = db.getDatabase();

    await database.runAsync(
      'DELETE FROM image_relations WHERE parentId = ? AND imageId = ?',
      [parentId, imageId]
    );
  },

  /**
   * Clear all relations for a parent
   */
  async clearImageRelations(parentId: string): Promise<void> {
    const database = db.getDatabase();

    await database.runAsync(
      'DELETE FROM image_relations WHERE parentId = ?',
      [parentId]
    );
  },

  // Soul Queries

  /**
   * Insert a new soul
   */
  async insertSoul(soul: {
    id: string;
    name: string;
    createdAt: number;
    updatedAt?: number;
  }): Promise<void> {
    console.log(`💾 [SQLite] Inserting soul into database:`, {
      id: soul.id,
      name: soul.name,
      createdAt: soul.createdAt,
      updatedAt: soul.updatedAt
    });

    const database = db.getDatabase();

    try {
      await database.runAsync(
        'INSERT INTO souls (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
        [soul.id, soul.name, soul.createdAt, soul.updatedAt || null]
      );
      console.log(`✅ [SQLite] Soul inserted successfully: ${soul.id}`);
    } catch (error) {
      console.error(`❌ [SQLite] Failed to insert soul:`, error);
      throw error;
    }
  },

  /**
   * Get all souls
   */
  async getAllSouls(): Promise<Array<{
    id: string;
    name: string;
    createdAt: number;
    updatedAt?: number;
  }>> {
    console.log(`📖 [SQLite] Loading all souls from database...`);
    const database = db.getDatabase();

    try {
      const results = await database.getAllAsync<any>(
        'SELECT id, name, created_at as createdAt, updated_at as updatedAt FROM souls ORDER BY created_at DESC'
      );

      console.log(`✅ [SQLite] Loaded ${results.length} soul(s) from database`);
      if (results.length > 0) {
        console.log(`📋 [SQLite] Souls:`, results.map(r => `${r.name} (${r.id})`));
      }

      return results.map(r => ({
        id: r.id,
        name: r.name,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt || undefined,
      }));
    } catch (error) {
      console.error(`❌ [SQLite] Failed to load souls:`, error);
      throw error;
    }
  },

  /**
   * Get a soul by ID
   */
  async getSoulById(id: string): Promise<{
    id: string;
    name: string;
    createdAt: number;
    updatedAt?: number;
  } | null> {
    const database = db.getDatabase();

    const result = await database.getFirstAsync<any>(
      'SELECT id, name, created_at as createdAt, updated_at as updatedAt FROM souls WHERE id = ?',
      [id]
    );

    if (!result) return null;

    return {
      id: result.id,
      name: result.name,
      createdAt: result.createdAt,
      updatedAt: result.updatedAt || undefined,
    };
  },

  /**
   * Update a soul
   */
  async updateSoul(
    id: string,
    updates: { name?: string; updatedAt: number }
  ): Promise<void> {
    const database = db.getDatabase();

    const fields: string[] = [];
    const values: any[] = [];

    if (updates.name !== undefined) {
      fields.push('name = ?');
      values.push(updates.name);
    }

    fields.push('updated_at = ?');
    values.push(updates.updatedAt);

    values.push(id);

    const query = `UPDATE souls SET ${fields.join(', ')} WHERE id = ?`;
    await database.runAsync(query, values);
  },

  /**
   * Delete a soul
   */
  async deleteSoul(id: string): Promise<void> {
    const database = db.getDatabase();

    // Delete the soul record
    await database.runAsync('DELETE FROM souls WHERE id = ?', [id]);

    // Also clear all image relations for this soul
    await this.clearImageRelations(id);
  },

  /**
   * Mark a soul as synced to Supabase
   */
  async markSoulSynced(id: string, remoteId?: string): Promise<void> {
    const database = db.getDatabase();
    if (remoteId) {
      await database.runAsync(
        'UPDATE souls SET synced_at = ?, remote_id = ? WHERE id = ?',
        [Date.now(), remoteId, id]
      );
    } else {
      await database.runAsync(
        'UPDATE souls SET synced_at = ? WHERE id = ?',
        [Date.now(), id]
      );
    }
  },

  // Library Favorites

  /**
   * Toggle favorite status for an image
   */
  async toggleFavorite(id: string, isFavorite: boolean): Promise<void> {
    const database = db.getDatabase();
    await database.runAsync(
      'UPDATE images SET is_favorite = ?, favorite_synced_at = NULL WHERE id = ?',
      [isFavorite ? 1 : 0, id]
    );
  },

  /**
   * Get favorite images
   */
  async getFavoriteImages(options: QueryOptions = {}): Promise<ImageRecord[]> {
    const database = db.getDatabase();

    let query = 'SELECT * FROM images WHERE is_favorite = 1 AND status = ?';
    const params: any[] = [options.status || 'active'];

    const orderBy = options.orderBy || 'createdAt';
    const orderDirection = options.orderDirection || 'DESC';
    query += ` ORDER BY ${orderBy} ${orderDirection}`;

    if (options.limit) {
      query += ' LIMIT ?';
      params.push(options.limit);
    }

    if (options.offset) {
      query += ' OFFSET ?';
      params.push(options.offset);
    }

    const results = await database.getAllAsync<any>(query, params);
    return results.map(mapRowToRecord);
  },

  /**
   * Mark a favorite as synced to Supabase
   */
  async markFavoriteSynced(id: string, remoteId: string): Promise<void> {
    const database = db.getDatabase();
    await database.runAsync(
      'UPDATE images SET favorite_synced_at = ?, favorite_remote_id = ? WHERE id = ?',
      [Date.now(), remoteId, id]
    );
  },

  /**
   * Clear favorite sync fields (when unfavoriting)
   */
  async clearFavoriteSync(id: string): Promise<void> {
    const database = db.getDatabase();
    await database.runAsync(
      'UPDATE images SET favorite_synced_at = NULL, favorite_remote_id = NULL WHERE id = ?',
      [id]
    );
  },

  /**
   * Get all favorite_remote_id values for dedup during cloud download
   */
  async getAllFavoriteRemoteIds(): Promise<Set<string>> {
    const database = db.getDatabase();
    const results = await database.getAllAsync<{ favorite_remote_id: string }>(
      'SELECT favorite_remote_id FROM images WHERE favorite_remote_id IS NOT NULL'
    );
    return new Set(results.map(r => r.favorite_remote_id));
  },

  /**
   * Get all souls that haven't been synced to Supabase
   */
  async getUnsyncedSouls(): Promise<Array<{
    id: string;
    name: string;
    createdAt: number;
    updatedAt?: number;
    remoteId?: string;
  }>> {
    const database = db.getDatabase();
    const results = await database.getAllAsync<{
      id: string;
      name: string;
      createdAt: number;
      updatedAt?: number;
      remoteId?: string;
    }>(
      'SELECT id, name, created_at as createdAt, updated_at as updatedAt, remote_id as remoteId FROM souls WHERE synced_at IS NULL'
    );
    return results;
  },
};
