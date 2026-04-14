const Database = require('better-sqlite3');
const path = require('path');
const { ensureDir } = require('./utils');

class PostDatabase {
  constructor(dbPath) {
    ensureDir(path.dirname(dbPath));
    this.db = new Database(dbPath);
    this.init();
  }

  init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS posts (
        note_id TEXT PRIMARY KEY,
        title TEXT,
        content TEXT,
        author_name TEXT,
        author_id TEXT,
        liked_count INTEGER,
        collected_count INTEGER,
        comment_count INTEGER,
        post_type TEXT,
        keyword TEXT,
        image_count INTEGER,
        image_dir TEXT,
        crawled_at TEXT,
        detail_url TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_posts_keyword ON posts(keyword);
      CREATE INDEX IF NOT EXISTS idx_posts_crawled_at ON posts(crawled_at);
    `);
  }

  exists(noteId) {
    const row = this.db.prepare('SELECT 1 FROM posts WHERE note_id = ?').get(noteId);
    return !!row;
  }

  insert(post) {
    const stmt = this.db.prepare(`
      INSERT INTO posts (
        note_id, title, content, author_name, author_id,
        liked_count, collected_count, comment_count, post_type,
        keyword, image_count, image_dir, crawled_at, detail_url
      ) VALUES (
        @note_id, @title, @content, @author_name, @author_id,
        @liked_count, @collected_count, @comment_count, @post_type,
        @keyword, @image_count, @image_dir, @crawled_at, @detail_url
      )
    `);
    stmt.run(post);
  }

  getStats(keyword) {
    const total = this.db.prepare('SELECT COUNT(*) as count FROM posts WHERE keyword = ?').get(keyword);
    const likes = this.db.prepare('SELECT SUM(liked_count) as sum FROM posts WHERE keyword = ?').get(keyword);
    return {
      totalPosts: total?.count || 0,
      totalLikes: likes?.sum || 0,
    };
  }

  getByKeyword(keyword) {
    return this.db.prepare('SELECT * FROM posts WHERE keyword = ? ORDER BY crawled_at DESC').all(keyword);
  }

  getAllKeywords() {
    return this.db.prepare('SELECT DISTINCT keyword FROM posts ORDER BY keyword').all().map(r => r.keyword);
  }

  close() {
    this.db.close();
  }
}

module.exports = { PostDatabase };
