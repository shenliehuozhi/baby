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

// 辅助函数：计算字符串在终端中的实际显示宽度（中文字符算 2 个宽度）
function getDisplayWidth(str) {
  let width = 0;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (
      (code >= 0x4e00 && code <= 0x9fa5) || 
      (code >= 0xff00 && code <= 0xffef) || 
      (code >= 0x3000 && code <= 0x303f)
    ) {
      width += 2;
    } else {
      width += 1;
    }
  }
  return width;
}

function padWidth(str, targetWidth) {
  const currentWidth = getDisplayWidth(str);
  if (currentWidth >= targetWidth) return str;
  return str + ' '.repeat(targetWidth - currentWidth);
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
        data = {
          title: matchTitle ? matchTitle[1] : file,
          date: matchDate ? matchDate[1] : '未知日期',
          image: matchImage ? matchImage[1] : '',
          sourceFile: matchSource ? matchSource[1] : ''
        };
      }

      artworks.push({
        fileName: file,
        filePath: filePath,
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

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log('\n🎨 当前 Content Collections 收录的画作列表：\n');
console.log(' 编号  │ 日期       │ 集合文件名');
console.log('───────┼────────────┼─────────────────────────────────────────────────────');

artworks.forEach((art, index) => {
  const numStr = padWidth(`[${index + 1}]`, 5);
  const dateStr = padWidth(art.date || '未知日期', 10);
  const fileStr = padWidth(art.fileName, 51);
  
  console.log(` ${numStr} │ ${dateStr} │ ${fileStr}`);
});

console.log('───────┴────────────┴─────────────────────────────────────────────────────');

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
        if (fileName.includes(keyword) || title.includes(keyword)) {
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
    console.log(`  - [${idx + 1}] 文件: ${art.fileName}  ➔  「${art.title || '无标题'}」`);
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