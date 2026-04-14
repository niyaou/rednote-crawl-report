const fs = require('fs');
const path = require('path');
const { ensureDir, formatDate } = require('./utils');

function generateReport(db, reportDir) {
  ensureDir(reportDir);
  const keywords = db.getAllKeywords();
  const timestamp = formatDate().replace(/[: ]/g, '-');
  const reportPath = path.join(reportDir, `report-${timestamp}.md`);

  let md = `# RedNote Crawl Report\n\n`;
  md += `**Generated:** ${formatDate()}\n\n`;
  md += `---\n\n`;

  let grandTotalPosts = 0;
  let grandTotalLikes = 0;

  for (const keyword of keywords) {
    const posts = db.getByKeyword(keyword);
    const stats = db.getStats(keyword);
    grandTotalPosts += stats.totalPosts;
    grandTotalLikes += stats.totalLikes;

    md += `## Keyword: "${keyword}"\n\n`;
    md += `- **Total posts:** ${stats.totalPosts}\n`;
    md += `- **Total likes:** ${stats.totalLikes}\n`;
    md += `- **New posts this run:** ${posts.filter(p => p.crawled_at.startsWith(formatDate().split(' ')[0])).length}\n\n`;

    md += `| # | Title | Author | Likes | Images | Date |\n`;
    md += `|---|-------|--------|-------|--------|------|\n`;

    posts.forEach((p, idx) => {
      const title = (p.title || 'Untitled').replace(/\|/g, '｜').slice(0, 30);
      const author = (p.author_name || 'Unknown').replace(/\|/g, '｜');
      const date = p.crawled_at?.split(' ')[0] || '-';
      md += `| ${idx + 1} | ${title} | ${author} | ${p.liked_count} | ${p.image_count} | ${date} |\n`;
    });

    md += `\n---\n\n`;
  }

  md += `## Summary\n\n`;
  md += `- **Total keywords scanned:** ${keywords.length}\n`;
  md += `- **Total posts saved:** ${grandTotalPosts}\n`;
  md += `- **Total likes across all posts:** ${grandTotalLikes}\n`;

  fs.writeFileSync(reportPath, md, 'utf-8');
  console.log(`\n📊 Report saved: ${reportPath}`);
  return reportPath;
}

module.exports = { generateReport };
