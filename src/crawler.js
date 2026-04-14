const { chromium } = require('playwright');
const { sleep, parseLikes, ensureDir, formatDate } = require('./utils');
const { downloadImages } = require('./downloader');

class RedNoteCrawler {
  constructor(config, db) {
    this.config = config;
    this.db = db;
    this.browser = null;
    this.page = null;
  }

  async init() {
    ensureDir(this.config.browserDataDir);
    this.browser = await chromium.launchPersistentContext(this.config.browserDataDir, {
      headless: this.config.headless,
      channel: 'chrome',
      viewport: { width: 1280, height: 800 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    });
    this.browser.on('disconnected', () => {
      console.error('\n❌ Browser was closed or crashed. If you closed it manually, please leave it open during the scan.');
      this.browser = null;
    });
    const pages = this.browser.pages();
    this.page = pages.length > 0 ? pages[0] : await this.browser.newPage();
  }

  async checkLoggedIn() {
    try {
      const meVisible = await this.page.locator(
        'xpath=//a[contains(@href, "/user/profile/")]//span[text()="我"]'
      ).isVisible({ timeout: 2000 });
      if (meVisible) return true;
    } catch {}

    const cookies = await this.browser.cookies();
    const webSession = cookies.find(c => c.name === 'web_session');
    if (webSession && webSession.value && webSession.value !== '0') {
      return true;
    }

    return false;
  }

  async ensureLogin() {
    console.log('Checking login state...');

    await this.browser.addCookies([{
      name: 'webId',
      value: 'xhs_' + Date.now(),
      domain: '.xiaohongshu.com',
      path: '/',
    }]);

    await this.page.goto(`${this.config.baseUrl}/explore`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(3000);

    let isLoggedIn = await this.checkLoggedIn();

    if (!isLoggedIn) {
      console.log('Not logged in. Opening QR code login page...');
      await this.page.goto(`${this.config.baseUrl}/login`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await sleep(3000);

      await this.page.evaluate(() => {
        window.addEventListener('beforeunload', (e) => {
          e.preventDefault();
          e.returnValue = '';
        });
      });

      const qrcode = await this.page.$('img.qrcode-img') || await this.page.$('canvas') || await this.page.$('img[src*="qrcode"]');
      if (qrcode) {
        console.log('QR code is displayed. Please scan it with your Xiaohongshu app.');
        console.log('Do NOT close this browser window until login is complete.');
      } else {
        console.log('Waiting for QR code to appear...');
      }

      for (let i = 0; i < 180; i++) {
        await sleep(1000);
        try {
          isLoggedIn = await this.checkLoggedIn();
        } catch {
          continue;
        }
        if (isLoggedIn) {
          console.log('Login detected!');
          break;
        }
        if (i % 30 === 0 && i > 0) {
          console.log(`  Still waiting for login... (${i}s elapsed)`);
        }
      }
    }

    if (!isLoggedIn) {
      throw new Error('Login timeout. Please scan the QR code and try again.');
    }

    console.log('✅ Login confirmed.');
    await sleep(2000);
  }

  async extractInitialState() {
    const raw = await this.page.evaluate(() => {
      try {
        return JSON.stringify(window.__INITIAL_STATE__ || null);
      } catch {
        return 'null';
      }
    });
    return JSON.parse(raw);
  }

  async collectApiResponses(urlPattern, actionFn, durationMs = 8000) {
    const responses = [];
    const handler = async (response) => {
      if (response.url().includes(urlPattern) && response.status() === 200) {
        try {
          const data = await response.json();
          responses.push(data);
        } catch {}
      }
    };
    this.page.on('response', handler);
    await actionFn();
    await sleep(durationMs);
    this.page.off('response', handler);
    return responses;
  }

  async searchKeyword(keyword) {
    const url = `${this.config.baseUrl}/search_result?keyword=${encodeURIComponent(keyword)}&sort=general`;
    console.log(`\n🔍 Searching: "${keyword}"`);

    await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(3000);

    const input = await this.page.$('input[placeholder*="搜索"]') || await this.page.$('input[type="search"]') || await this.page.$('.search-input input') || await this.page.$('input');
    if (input) {
      await input.fill(keyword);
      try {
        await Promise.all([
          this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }),
          input.press('Enter'),
        ]);
      } catch {
        await input.press('Enter');
        await sleep(4000);
      }
      await sleep(3000);
    }

    const apiResponses = await this.collectApiResponses(
      '/search/notes',
      async () => {
        const sortBtn = await this.page.$('text=最新');
        if (sortBtn) {
          await sortBtn.click().catch(() => {});
          await sleep(2000);
        }

        for (let i = 0; i < this.config.scrollTimes; i++) {
          await this.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
          await sleep(1500);
        }
      },
      5000
    );

    let feeds = [];

    for (const data of apiResponses) {
      const items = data?.data?.notes || data?.data?.items || data?.notes || data?.items || [];
      if (items.length) {
        feeds = feeds.concat(items);
      }
    }

    if (!feeds.length) {
      const state = await this.extractInitialState();
      const stateFeeds = state?.search?.feeds || state?.searchResult?.feeds || state?.searchPage?.feeds || [];
      if (stateFeeds.length) {
        feeds = stateFeeds;
      }
    }

    if (!feeds.length) {
      feeds = await this.page.evaluate(() => {
        const cards = document.querySelectorAll('section.note-item, .feeds-page section, .search-note-item, .note-card, [class*="note"]');
        return Array.from(cards).map(card => {
          const link = card.querySelector('a[href*="/explore/"]');
          const href = link?.getAttribute('href') || '';
          const noteId = href.split('/explore/')[1]?.split('?')[0] || '';
          const titleEl = card.querySelector('.title, .desc span');
          const likeEl = card.querySelector('.like-wrapper span, .count');
          const videoIcon = card.querySelector('.play-icon, .video-icon');
          return {
            id: noteId,
            title: titleEl?.textContent || '',
            liked_count: likeEl?.textContent || '0',
            type: videoIcon ? 'video' : 'normal',
          };
        }).filter(x => x.id);
      });
    }

    console.log(`  Found ${feeds.length} raw results`);

    const results = [];
    for (const feed of feeds) {
      const item = feed.note || feed.note_card || feed.items?.[0] || feed;
      const noteId = item.note_id || item.id;
      if (!noteId) continue;

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
        xsecToken: feed.xsec_token || item.xsec_token || '',
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

    const apiResponses = await this.collectApiResponses(
      '/feed',
      async () => {
        await this.page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await sleep(2000 + Math.random() * 1000);
      },
      4000
    );

    let note = {};

    for (const data of apiResponses) {
      const items = data?.data?.items || data?.items || [];
      if (items[0]?.note_card) {
        note = items[0].note_card;
        break;
      }
    }

    if (!note || !note.note_id) {
      const state = await this.extractInitialState();
      const noteKey = Object.keys(state?.note?.noteDetailMap || {})[0];
      const detail = noteKey ? state.note.noteDetailMap[noteKey] : null;
      note = detail?.note || detail?.value || detail || {};
    }

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
