import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const jsonPath = path.join(__dirname, 'src/data/artworks.json');
const inputDir = path.join(__dirname, 'raw-images');
const outputDir = path.join(__dirname, 'public/uploads');

if (!fs.existsSync(jsonPath)) {
  console.log(`\n❌ [错误] 没有找到 artworks.json 文件！请先运行 "npm run sync"。\n`);
  process.exit(0);
}

let fileContent = '';
try {
  fileContent = fs.readFileSync(jsonPath, 'utf-8').trim();
} catch (e) {
  console.log(`\n❌ [错误] 读取 artworks.json 失败: ${e.message}\n`);
  process.exit(0);
}

if (!fileContent) {
  console.log(`\n❌ [错误] artworks.json 文件内容为空！\n`);
  process.exit(0);
}

let artworks = [];
try {
  artworks = JSON.parse(fileContent);
} catch (e) {
  console.log(`\n❌ [错误] artworks.json 格式损坏: ${e.message}\n`);
  process.exit(0);
}

if (!Array.isArray(artworks) || artworks.length === 0) {
  console.log(`\n📂 [提示] 当前美术馆里没有任何画作记录。\n`);
  process.exit(0);
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log('\n🎨 当前美术馆收录的画作列表（表格对齐视图）：\n');
console.log(' 编号  │ 文件名                  │ 日期       │ 画作标题');
console.log('───────┼─────────────────────────┼────────────┼────────────────────────────────────────');

artworks.forEach((art, index) => {
  const numStr = `[${index + 1}]`.padEnd(5, ' ');
  const webpFilename = art.image ? path.basename(art.image).padEnd(23, ' ') : '未知文件'.padEnd(23, ' ');
  const dateStr = (art.date || '未知日期').padEnd(10, ' ');
  const titleStr = art.title ? `「${art.title}」` : '无标题';
  console.log(` ${numStr} │ ${webpFilename} │ ${dateStr} │ ${titleStr}`);
});

console.log('───────┴─────────────────────────┴────────────┴────────────────────────────────────────');

rl.question('\n👉 请输入编号（如 1, 3）、文件名（如 art_c5978）或关键词，或直接回车取消: ', (answer) => {
  const input = answer.trim();
  if (!input) {
    console.log('🚫 操作已取消。');
    rl.close();
    return;
  }

  const tokens = input.split(/[\s,]+/).filter(Boolean);
  const indices = [];

  for (const token of tokens) {
    // 1. 如果输入的是纯数字，按编号处理（索引 = 编号 - 1）
    if (/^\d+$/.test(token)) {
      const num = parseInt(token, 10);
      const idx = num - 1;
      if (idx >= 0 && idx < artworks.length) {
        indices.push(idx);
      }
    } else {
      // 2. 如果输入的是文本，模糊匹配文件名或标题
      const keyword = token.toLowerCase();
      artworks.forEach((art, idx) => {
        const webpFilename = art.image ? path.basename(art.image).toLowerCase() : '';
        const title = (art.title || '').toLowerCase();
        if (webpFilename.includes(keyword) || title.includes(keyword)) {
          indices.push(idx);
        }
      });
    }
  }

  // 数组去重
  const uniqueIndices = [...new Set(indices)];

  if (uniqueIndices.length === 0) {
    console.log('❌ 没有找到匹配的画作，已取消操作。');
    rl.close();
    return;
  }

  console.log('\n⚠️ 准备批量删除以下匹配的画作：');
  uniqueIndices.forEach(idx => {
    const webpFilename = artworks[idx].image ? path.basename(artworks[idx].image) : '';
    console.log(`  - [${idx + 1}] ${webpFilename}  ➔  「${artworks[idx].title}」`);
  });

  rl.question('\n❓ 确认要彻底删除这些选中的画作吗？(y/N): ', (confirm) => {
    if (confirm.trim().toLowerCase() === 'y') {
      const indexSet = new Set(uniqueIndices);

      artworks.forEach((target, idx) => {
        if (indexSet.has(idx)) {
          if (target.sourceFile) {
            const rawPath = path.join(inputDir, target.sourceFile);
            if (fs.existsSync(rawPath)) {
              fs.unlinkSync(rawPath);
              console.log(`🗑️ 已删除原图: ${target.sourceFile}`);
            }
          }

          if (target.image) {
            const webpFilename = path.basename(target.image);
            const webpPath = path.join(outputDir, webpFilename);
            if (fs.existsSync(webpPath)) {
              fs.unlinkSync(webpPath);
              console.log(`🗑️ 已删除图床文件: ${webpFilename}`);
            }
          }
        }
      });

      const newArtworks = artworks.filter((_, idx) => !indexSet.has(idx));
      fs.writeFileSync(jsonPath, JSON.stringify(newArtworks, null, 2), 'utf-8');
      
      console.log(`\n✨ 成功从总账本中移除了选中的 ${uniqueIndices.length} 个画作记录！\n`);
    } else {
      console.log('🚫 操作已取消。');
    }
    rl.close();
  });
});