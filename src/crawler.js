const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { sleep, parseLikes, ensureDir, formatDate } = require('./utils');
const { downloadImages } = require('./downloader');

class RedNoteCrawler {
  constructor(config, db) {
    this.config = config;
    this.db = db;
    this.browser = null;
    this.context = null;
    this.page = null;
  }

  async init() {
    ensureDir(this.config.browserDataDir);
    this.browser = await chromium.launch({
      headless: this.config.headless,
      channel: 'chrome',
    });
    this.context = await this.browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    });
    this.page = await this.context.newPage();
  }

  async ensureLogin() {
    console.log('Checking login state...');
    await this.page.goto(`${this.config.baseUrl}/explore`, { waitUntil: 'networkidle' });
    await sleep(2000);

    const isLoggedIn = await this.page.evaluate(() => {
      return !!document.querySelector('a[href*="/user/profile/"]');
    });

    if (isLoggedIn) {
      console.log('Already logged in.');
      return;
    }

    console.log('Not logged in. Opening QR code login page...');
    await this.page.goto(`${this.config.baseUrl}/login`, { waitUntil: 'networkidle' });
    await sleep(3000);

    console.log('Please scan the QR code with your Xiaohongshu app. Waiting...');
    let loggedIn = false;
    for (let i = 0; i < 120; i++) {
      await sleep(1000);
      const now = await this.page.evaluate(() => {
        return !!document.querySelector('a[href*="/user/profile/"]');
      });
      if (now) {
        loggedIn = true;
        break;
      }
    }

    if (!loggedIn) {
      throw new Error('QR code login timeout. Please try again.');
    }

    console.log('Login successful!');
    await sleep(2000);
  }

  async extractInitialState() {
    const state = await this.page.evaluate(() => {
      try {
        return window.__INITIAL_STATE__ || null;
      } catch (e) {
        return null;
      }
    });
    return state;
  }

  async searchKeyword(keyword) {
    const url = `${this.config.baseUrl}/search_result?keyword=${encodeURIComponent(keyword)}&sort=general`;
    console.log(`\n🔍 Searching: "${keyword}"`);
    await this.page.goto(url, { waitUntil: 'networkidle' });
    await sleep(2000);

    const sortBtn = await this.page.$('text=最新');
    if (sortBtn) {
      await sortBtn.click().catch(() => {});
      await sleep(2000);
    }

    for (let i = 0; i < this.config.scrollTimes; i++) {
      await this.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await sleep(1500);
    }

    const state = await this.extractInitialState();
    const feeds = state?.search?.feeds || state?.searchResult?.feeds || [];
    console.log(`  Found ${feeds.length} raw results`);

    const results = [];
    for (const feed of feeds) {
      const item = feed.items?.[0] || feed;
      const noteId = item.id || item.note_id;
      const title = item.title || item.display_title || '';
      const postType = item.type || 'normal';
      const likes = parseLikes(item.liked_count || item.interact_info?.liked_count);

      if (this.config.imageOnly && postType === 'video') continue;
      if (likes < this.config.minLikes) continue;
      if (this.db.exists(noteId)) {
        console.log(`  ⏭️ Skipping already saved post: ${noteId}`);
        continue;
      }

      results.push({
        noteId,
        title,
        postType,
        likes,
        xsecToken: item.xsec_token || '',
        author: item.user?.nickname || item.user || '',
        authorId: item.user?.user_id || item.user_id || '',
        raw: item,
      });

      if (results.length >= this.config.scanLimitPerKeyword) break;
    }

    console.log(`  → ${results.length} posts to process after filtering`);
    return results;
  }

  async fetchNoteDetail(noteId, xsecToken) {
    const detailUrl = `${this.config.baseUrl}/explore/${noteId}${xsecToken ? `?xsec_token=${xsecToken}` : ''}`;
    await this.page.goto(detailUrl, { waitUntil: 'networkidle' });
    await sleep(2000 + Math.random() * 1000);

    const state = await this.extractInitialState();
    const noteKey = Object.keys(state?.note?.noteDetailMap || {})[0];
    const detail = noteKey ? state.note.noteDetailMap[noteKey] : null;
    const note = detail?.note || detail?.value || detail || {};

    return {
      noteId,
      title: note.title || note.display_title || '',
      content: note.desc || '',
      authorName: note.user?.nickname || '',
      authorId: note.user?.user_id || '',
      likedCount: parseLikes(note.interact_info?.liked_count || note.liked_count),
      collectedCount: parseLikes(note.interact_info?.collected_count || note.collected_count),
      commentCount: parseLikes(note.interact_info?.comment_count || note.comment_count),
      postType: note.type || 'normal',
      imageList: note.image_list || [],
      detailUrl,
    };
  }

  async processKeyword(keyword) {
    const toProcess = await this.searchKeyword(keyword);
    const processed = [];

    for (const item of toProcess) {
      console.log(`  📄 Processing post: ${item.noteId} — ${item.title.slice(0, 40)}`);
      try {
        const detail = await this.fetchNoteDetail(item.noteId, item.xsecToken);

        const { noteDir, savedPaths } = await downloadImages(
          detail.noteId,
          detail.imageList,
          this.config.imageDir
        );

        this.db.insert({
          note_id: detail.noteId,
          title: detail.title,
          content: detail.content,
          author_name: detail.authorName,
          author_id: detail.authorId,
          liked_count: detail.likedCount,
          collected_count: detail.collectedCount,
          comment_count: detail.commentCount,
          post_type: detail.postType,
          keyword,
          image_count: savedPaths.length,
          image_dir: noteDir,
          crawled_at: formatDate(),
          detail_url: detail.detailUrl,
        });

        processed.push(detail);
        console.log(`    ✓ Saved ${savedPaths.length} images`);

        await sleep(this.config.delayBetweenRequestsMs + Math.random() * 1000);
      } catch (err) {
        console.warn(`    ✗ Failed to process ${item.noteId}: ${err.message}`);
      }
    }

    return processed;
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
    }
  }
}

module.exports = { RedNoteCrawler };
