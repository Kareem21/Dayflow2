const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

class DatabaseManager {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = null;
  }

  initialize() {
    // Ensure directory exists
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Open database
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');

    // Create tables
    this.createTables();
  }

  createTables() {
    this.db.exec(`
      -- Video chunks table (15-second recordings)
      CREATE TABLE IF NOT EXISTS chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        start_time INTEGER NOT NULL,
        end_time INTEGER NOT NULL,
        duration REAL NOT NULL,
        file_path TEXT NOT NULL,
        file_size INTEGER,
        created_at INTEGER NOT NULL,
        UNIQUE(start_time, end_time)
      );

      CREATE INDEX IF NOT EXISTS idx_chunks_time ON chunks(start_time, end_time);

      -- Analysis batches table (~15-minute logical batches)
      CREATE TABLE IF NOT EXISTS analysis_batches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        start_time INTEGER NOT NULL,
        end_time INTEGER NOT NULL,
        total_duration REAL NOT NULL,
        chunk_count INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at INTEGER NOT NULL,
        processed_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_batches_time ON analysis_batches(start_time, end_time);
      CREATE INDEX IF NOT EXISTS idx_batches_status ON analysis_batches(status);

      -- Join table for batches and chunks
      CREATE TABLE IF NOT EXISTS batch_chunks (
        batch_id INTEGER NOT NULL,
        chunk_id INTEGER NOT NULL,
        PRIMARY KEY (batch_id, chunk_id),
        FOREIGN KEY (batch_id) REFERENCES analysis_batches(id) ON DELETE CASCADE,
        FOREIGN KEY (chunk_id) REFERENCES chunks(id) ON DELETE CASCADE
      );

      -- Timeline cards (AI-generated activity summaries)
      CREATE TABLE IF NOT EXISTS timeline_cards (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        batch_id INTEGER NOT NULL,
        start_time INTEGER NOT NULL,
        end_time INTEGER NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        category TEXT,
        is_distraction INTEGER DEFAULT 0,
        video_path TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (batch_id) REFERENCES analysis_batches(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_cards_time ON timeline_cards(start_time, end_time);
      CREATE INDEX IF NOT EXISTS idx_cards_category ON timeline_cards(category);

      -- Categories table
      CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        color TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      -- Settings table
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      -- LLM calls log (for debugging)
      CREATE TABLE IF NOT EXISTS llm_calls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        batch_id INTEGER,
        provider TEXT NOT NULL,
        model TEXT,
        prompt_tokens INTEGER,
        completion_tokens INTEGER,
        response TEXT,
        error TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (batch_id) REFERENCES analysis_batches(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_llm_calls_batch ON llm_calls(batch_id);
    `);

    // Insert default categories if none exist
    const count = this.db.prepare('SELECT COUNT(*) as count FROM categories').get();
    if (count.count === 0) {
      const insert = this.db.prepare('INSERT INTO categories (name, color, created_at) VALUES (?, ?, ?)');
      const now = Date.now();

      const defaultCategories = [
        ['Work', '#3B82F6'],
        ['Meeting', '#8B5CF6'],
        ['Break', '#10B981'],
        ['Communication', '#F59E0B'],
        ['Research', '#EC4899'],
        ['Development', '#06B6D4'],
        ['Other', '#6B7280']
      ];

      defaultCategories.forEach(([name, color]) => {
        insert.run(name, color, now);
      });
    }
  }

  // Chunk operations
  saveChunk(chunk) {
    const stmt = this.db.prepare(`
      INSERT INTO chunks (start_time, end_time, duration, file_path, file_size, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    return stmt.run(
      chunk.startTime,
      chunk.endTime,
      chunk.duration,
      chunk.filePath,
      chunk.fileSize || 0,
      Date.now()
    ).lastInsertRowid;
  }

  getUnprocessedChunks() {
    const stmt = this.db.prepare(`
      SELECT c.* FROM chunks c
      LEFT JOIN batch_chunks bc ON c.id = bc.chunk_id
      WHERE bc.chunk_id IS NULL
      ORDER BY c.start_time ASC
    `);

    return stmt.all();
  }

  // Batch operations
  saveBatch(batch, chunkIds) {
    const insertBatch = this.db.prepare(`
      INSERT INTO analysis_batches (start_time, end_time, total_duration, chunk_count, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const batchId = insertBatch.run(
      batch.startTime,
      batch.endTime,
      batch.totalDuration,
      batch.chunkCount,
      'pending',
      Date.now()
    ).lastInsertRowid;

    // Link chunks to batch
    const insertLink = this.db.prepare('INSERT INTO batch_chunks (batch_id, chunk_id) VALUES (?, ?)');
    chunkIds.forEach(chunkId => {
      insertLink.run(batchId, chunkId);
    });

    return batchId;
  }

  updateBatchStatus(batchId, status) {
    const stmt = this.db.prepare(`
      UPDATE analysis_batches
      SET status = ?, processed_at = ?
      WHERE id = ?
    `);

    stmt.run(status, Date.now(), batchId);
  }

  getPendingBatches() {
    const stmt = this.db.prepare(`
      SELECT * FROM analysis_batches
      WHERE status = 'pending'
      ORDER BY start_time ASC
    `);

    return stmt.all();
  }

  getBatchChunks(batchId) {
    const stmt = this.db.prepare(`
      SELECT c.* FROM chunks c
      JOIN batch_chunks bc ON c.id = bc.chunk_id
      WHERE bc.batch_id = ?
      ORDER BY c.start_time ASC
    `);

    return stmt.all(batchId);
  }

  // Timeline card operations
  saveTimelineCard(card) {
    const stmt = this.db.prepare(`
      INSERT INTO timeline_cards (batch_id, start_time, end_time, title, description, category, is_distraction, video_path, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    return stmt.run(
      card.batchId,
      card.startTime,
      card.endTime,
      card.title,
      card.description || '',
      card.category || 'Other',
      card.isDistraction ? 1 : 0,
      card.videoPath || null,
      Date.now()
    ).lastInsertRowid;
  }

  updateCardVideoPath(cardId, videoPath) {
    const stmt = this.db.prepare('UPDATE timeline_cards SET video_path = ? WHERE id = ?');
    stmt.run(videoPath, cardId);
  }

  getTimelineCards(date) {
    // Get cards for a specific day (date is a Date object or timestamp)
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const stmt = this.db.prepare(`
      SELECT * FROM timeline_cards
      WHERE start_time >= ? AND start_time < ?
      ORDER BY start_time ASC
    `);

    return stmt.all(startOfDay.getTime(), endOfDay.getTime());
  }

  getDateRange() {
    const stmt = this.db.prepare(`
      SELECT
        MIN(start_time) as first_date,
        MAX(end_time) as last_date
      FROM timeline_cards
    `);

    return stmt.get();
  }

  getVideoPath(cardId) {
    const stmt = this.db.prepare('SELECT video_path FROM timeline_cards WHERE id = ?');
    const result = stmt.get(cardId);
    return result ? result.video_path : null;
  }

  // Category operations
  getCategories() {
    const stmt = this.db.prepare('SELECT * FROM categories ORDER BY name ASC');
    return stmt.all();
  }

  saveCategory(category) {
    const stmt = this.db.prepare(`
      INSERT INTO categories (name, color, created_at)
      VALUES (?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET color = excluded.color
    `);

    stmt.run(category.name, category.color, Date.now());
  }

  // Settings operations
  getSetting(key, defaultValue = null) {
    const stmt = this.db.prepare('SELECT value FROM settings WHERE key = ?');
    const result = stmt.get(key);
    return result ? result.value : defaultValue;
  }

  setSetting(key, value) {
    const stmt = this.db.prepare(`
      INSERT INTO settings (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);

    stmt.run(key, value);
  }

  getSettings() {
    const stmt = this.db.prepare('SELECT key, value FROM settings');
    const rows = stmt.all();

    const settings = {};
    rows.forEach(row => {
      settings[row.key] = row.value;
    });

    return settings;
  }

  saveSettings(settings) {
    const stmt = this.db.prepare(`
      INSERT INTO settings (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);

    Object.entries(settings).forEach(([key, value]) => {
      stmt.run(key, value);
    });
  }

  // LLM call logging
  logLLMCall(llmCall) {
    const stmt = this.db.prepare(`
      INSERT INTO llm_calls (batch_id, provider, model, prompt_tokens, completion_tokens, response, error, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      llmCall.batchId,
      llmCall.provider,
      llmCall.model || null,
      llmCall.promptTokens || 0,
      llmCall.completionTokens || 0,
      llmCall.response || null,
      llmCall.error || null,
      Date.now()
    );
  }

  // Cleanup old data
  deleteOldChunks(daysToKeep = 3) {
    const cutoffTime = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000);

    // Get file paths before deleting
    const stmt = this.db.prepare('SELECT file_path FROM chunks WHERE created_at < ?');
    const chunks = stmt.all(cutoffTime);

    // Delete files
    const fs = require('fs');
    chunks.forEach(chunk => {
      try {
        if (fs.existsSync(chunk.file_path)) {
          fs.unlinkSync(chunk.file_path);
        }
      } catch (error) {
        console.error('Failed to delete chunk file:', error);
      }
    });

    // Delete from database
    const deleteStmt = this.db.prepare('DELETE FROM chunks WHERE created_at < ?');
    deleteStmt.run(cutoffTime);
  }

  close() {
    if (this.db) {
      this.db.close();
    }
  }
}

module.exports = DatabaseManager;
