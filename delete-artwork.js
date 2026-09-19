import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const contentDir = path.join(__dirname, 'src/content/artworks');
const inputDir = path.join(__dirname, 'raw-images');
const outputDir = path.join(__dirname, 'public/uploads');

if (!fs.existsSync(contentDir)) {
  console.log(`\n❌ [错误] 没有找到 src/content/artworks 目录！请检查项目路径。\n`);
  process.exit(0);
}

const files = fs.readdirSync(contentDir).filter(file => !file.startsWith('.'));

if (files.length === 0) {
  console.log(`\n📂 [提示] 当前 artworks 集合中没有任何画作文件。\n`);
  process.exit(0);
}

let artworks = [];

files.forEach(file => {
  const filePath = path.join(contentDir, file);
  if (fs.statSync(filePath).isFile()) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      let data = {};
      
      if (file.endsWith('.json')) {
        data = JSON.parse(content);
      } else {
        const matchTitle = content.match(/title:\s*["']?([^"'\n]+)["']?/);
        const matchDate = content.match(/date:\s*["']?([^"'\n]+)["']?/);
        const matchImage = content.match(/image:\s*["']?([^"'\n]+)["']?/);
        const matchSource = content.match(/sourceFile:\s*["']?([^"'\n]+)["']?/);
        const matchMd5 = content.match(/md5:\s*["']?([^"'\n]+)["']?/);
        data = {
          title: matchTitle ? matchTitle[1] : file,
          date: matchDate ? matchDate[1] : '未知日期',
          image: matchImage ? matchImage[1] : '',
          sourceFile: matchSource ? matchSource[1] : '',
          md5: matchMd5 ? matchMd5[1] : ''
        };
      }

      // 提取转后的图片名称（如 art_xxx.webp）
      const webpName = data.image ? path.basename(data.image) : '（无）';

      artworks.push({
        fileName: file,
        filePath: filePath,
        webpName,
        ...data
      });
    } catch (e) {
      console.log(`⚠️ 解析文件 ${file} 失败: ${e.message}`);
    }
  }
});

if (artworks.length === 0) {
  console.log(`\n📂 [提示] 没有解析到有效的画作数据。\n`);
  process.exit(0);
}

// 检查并归纳相同 MD5 的重复图片
const md5Map = {};
artworks.forEach((art, idx) => {
  if (art.md5) {
    if (!md5Map[art.md5]) md5Map[art.md5] = [];
    md5Map[art.md5].push({ index: idx + 1, ...art });
  }
});

const duplicateGroups = Object.entries(md5Map).filter(([md5, list]) => list.length > 1);

console.log('\n🎨 当前 Content Collections 画作资产管理系统\n');

if (duplicateGroups.length > 0) {
  console.log('⚠️ 【警告】检测到以下原图 MD5 相同的重复画作：');
  console.log('────────────────────────────────────────────────────────────────────────');
  duplicateGroups.forEach(([md5, list], gIdx) => {
    console.log(` 📌 重复组 #${gIdx + 1} (完整 MD5: ${md5})`);
    list.forEach(item => {
      console.log(`    └─ [编号 ${item.index}] JSON: ${item.fileName} | 原文件名: ${item.sourceFile || '无'} | 标题: ${item.title || '无标题'}`);
    });
  });
  console.log('────────────────────────────────────────────────────────────────────────\n');
} else {
  console.log('✨ 极好！当前没有发现内容完全重复（MD5相同）的图片。\n');
}

console.log('📋 全部画作总览表格：\n');
console.log(' 编号 │ 日期       │ 转后图片名称        │ JSON文件名');
console.log('─────────────────────────────────────────────────────────────────────────────');

artworks.forEach((art, index) => {
  const numStr = `[${index + 1}]`.padEnd(5);
  const dateStr = (art.date || '未知').padEnd(10);
  const webpStr = (art.webpName || '无').padEnd(19);
  const jsonStr = (art.fileName || '无').padEnd(34);

  console.log(` ${numStr} │ ${dateStr} │ ${webpStr} │ ${jsonStr}`);
});

console.log('─────────────────────────────────────────────────────────────────────────────');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question('\n👉 请输入编号（如 1, 3）、文件名或关键词，或直接回车取消: ', (answer) => {
  const input = answer.trim();
  if (!input) {
    console.log('🚫 操作已取消。');
    rl.close();
    return;
  }

  const tokens = input.split(/[\s,]+/).filter(Boolean);
  const indices = [];

  for (const token of tokens) {
    if (/^\d+$/.test(token)) {
      const num = parseInt(token, 10);
      const idx = num - 1;
      if (idx >= 0 && idx < artworks.length) {
        indices.push(idx);
      }
    } else {
      const keyword = token.toLowerCase();
      artworks.forEach((art, idx) => {
        const fileName = art.fileName.toLowerCase();
        const title = (art.title || '').toLowerCase();
        const sourceFile = (art.sourceFile || '').toLowerCase();
        const webpName = (art.webpName || '').toLowerCase();
        const md5 = (art.md5 || '').toLowerCase();
        if (
          fileName.includes(keyword) || 
          title.includes(keyword) || 
          sourceFile.includes(keyword) || 
          webpName.includes(keyword) ||
          md5.includes(keyword)
        ) {
          indices.push(idx);
        }
      });
    }
  }

  const uniqueIndices = [...new Set(indices)];

  if (uniqueIndices.length === 0) {
    console.log('❌ 没有找到匹配的画作，已取消操作。');
    rl.close();
    return;
  }

  console.log('\n⚠️ 准备彻底删除以下匹配的画作及关联文件：');
  uniqueIndices.forEach(idx => {
    const art = artworks[idx];
    console.log(`  - [${idx + 1}] JSON: ${art.fileName}  ➔  「${art.title || '无标题'}」 (转后图片: ${art.webpName})`);
  });

  rl.question('\n❓ 确认要彻底删除这些选中的画作吗？(y/N): ', (confirm) => {
    if (confirm.trim().toLowerCase() === 'y') {
      uniqueIndices.forEach(idx => {
        const art = artworks[idx];

        if (fs.existsSync(art.filePath)) {
          fs.unlinkSync(art.filePath);
          console.log(`🗑️ 已删除数据文件: src/content/artworks/${art.fileName}`);
        }

        if (art.sourceFile) {
          const rawPath = path.join(inputDir, art.sourceFile);
          if (fs.existsSync(rawPath)) {
            fs.unlinkSync(rawPath);
            console.log(`🗑️ 已删除原图: ${art.sourceFile}`);
          }
        }

        if (art.image) {
          const webpFilename = path.basename(art.image);
          const webpPath = path.join(outputDir, webpFilename);
          if (fs.existsSync(webpPath)) {
            fs.unlinkSync(webpPath);
            console.log(`🗑️ 已删除图床文件: ${webpFilename}`);
          }
        }
      });

      console.log(`\n✨ 成功删除了选中的 ${uniqueIndices.length} 个画作记录及相关文件！\n`);
    } else {
      console.log('🚫 操作已取消。');
    }
    rl.close();
  });
});