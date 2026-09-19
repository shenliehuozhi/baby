/**
 * ==============================================================================
 * 数字儿童美术馆自动化流水线脚本 (Astro Content Collections + 终端交互式开关)
 * ==============================================================================
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 目录与路径常量定义
const contentDir = path.join(__dirname, 'src/content/artworks'); // 独立内容集合文件夹
const legacyJsonPath = path.join(__dirname, 'src/data/artworks.json'); // 旧版总账本（用于自动迁移）
const inputDir = path.join(__dirname, 'raw-images');                 // 原始照片文件夹
const outputDir = path.join(__dirname, 'public/uploads');             // WebP 图床文件夹

// 自动初始化必要目录
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
if (!fs.existsSync(contentDir)) fs.mkdirSync(contentDir, { recursive: true });


// ================= 1. 多模型 AI 智能视觉配置中心 =================
const AI_CONFIG = {
  enabled: true,
  provider: 'minimax', // 可选: 'gemini', 'minimax', 'deepseek'
  configs: {
    gemini: {
      apiKey: process.env.GEMINI_API_KEY || '你的_GEMINI_API_KEY',
      model: 'gemini-2.5-flash',
      url: (model, key) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`
    },
    deepseek: {
      apiKey: process.env.DEEPSEEK_API_KEY || '你的_DEEPSEEK_API_KEY',
      model: 'deepseek-chat',
      url: () => 'https://api.deepseek.com/chat/completions'
    },
    minimax: {
      apiKey: process.env.MINIMAX_API_KEY || 'sk-cp-Swg2zHMiJpO569-Rnsj4SB3JaEGrxNi6cxJpqggHHg8qFwWDH5TwyUHmzwxeGLBKW-WEii5HTyLvvpCOc_DwYzbpoKtuYlQa--6d7I7MOARatbMlpLZMBbY',
      model: 'MiniMax-M3',
      url: () => 'https://api.minimax.chat/v1/chat/completions'
    }
  }
};


// ================= 2. 底层工具函数 =================
function generateRandomFilename() {
  return `art_${crypto.randomBytes(6).toString('hex')}`;
}

function calculateMd5(buffer) {
  return crypto.createHash('md5').update(buffer).digest('hex');
}

/**
 * 💡 根据 ID 和标题生成安全的 JSON 文件名（格式：id_title.json）
 */
function getArtFilename(id, title) {
  const safeTitle = (title || '未命名画作').replace(/[\\/:*?"<>|\s]/g, '_').trim();
  return `${id}_${safeTitle}.json`;
}

/**
 * 💡 终端交互询问辅助函数
 */
function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise(resolve => rl.question(query, answer => {
    rl.close();
    resolve(answer.trim());
  }));
}

async function fetchAiVision(mimeType, base64Image, prompt) {
  const currentProvider = AI_CONFIG.provider;
  const cfg = AI_CONFIG.configs[currentProvider];

  if (!cfg || cfg.apiKey.startsWith('你的_')) {
    throw new Error(`未配置 ${currentProvider} 的有效 API Key`);
  }

  let requestUrl = '';
  let headers = { 'Content-Type': 'application/json' };
  let body = {};

  if (currentProvider === 'gemini') {
    requestUrl = cfg.url(cfg.model, cfg.apiKey);
    body = { contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: base64Image } }] }] };
  } else {
    requestUrl = cfg.url();
    headers['Authorization'] = `Bearer ${cfg.apiKey}`;
    body = {
      model: cfg.model,
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Image}` } }] }]
    };
  }

  const response = await fetch(requestUrl, { method: 'POST', headers, body: JSON.stringify(body) });
  
  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`API 请求失败 [HTTP ${response.status}]:${errorBody}`);
  }

  const data = await response.json();
  let textResult = currentProvider === 'gemini' ? data.candidates?.[0]?.content?.parts?.[0]?.text : data.choices?.[0]?.message?.content;

  if (!textResult) throw new Error('大模型响应结构异常，未返回有效内容');
  return textResult;
}

// 针对新图片：生成完整元数据（标题、童趣描述、标签）
async function getAiMetadata(mimeType, base64Image) {
  if (!AI_CONFIG.enabled) return null;
  try {
    console.log(`🤖 [AI (${AI_CONFIG.provider})] 正在聆听宝宝画里的奇思妙想...`);
    const prompt = `请作为一个充满童心、懂得欣赏儿童画的伙伴，来观察这幅画。
    要求：
    1. 绝对不要写枯燥的美术评论、构图分析或色彩技法评价。
    2. 要像宝宝在跟你讲故事一样，充满异想天开、天真烂漫的童趣。
    3. 描述可以带上“宝宝说……”或者直接用充满童话色彩的视角来写。
    4. 请为这幅画提炼 3 到 5 个生动好玩的短标签（例如：太空奇遇、神奇动物、五彩森林等）。
    
    请严格以纯 JSON 格式返回（不要包含任何 markdown 符号如 \`\`\`json）：
    {
      "title": "一个充满童趣、生动好玩的简短标题",
      "description": "一段充满幻想与童真的描述（50-100字左右，展现宝宝眼中的奇妙世界）",
      "tags": ["标签1", "标签2", "标签3"]
    }`;

    const rawText = await fetchAiVision(mimeType, base64Image, prompt);
    const noThinkText = rawText.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    const cleanJsonStr = noThinkText.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(cleanJsonStr);
  } catch (error) {
    console.warn(`⚠️ [AI] 童趣文案生成失败: ${error.message}`);
    return null;
  }
}

// 针对旧图片：仅安全补齐缺失的标签
async function getAiTagsOnly(mimeType, base64Image) {
  if (!AI_CONFIG.enabled) return ["童趣时光"];
  try {
    const prompt = `请观察这幅儿童画，为它提炼 3 到 5 个生动好玩的短标签（例如：太空奇遇、神奇动物、五彩森林等）。
    请严格以纯 JSON 格式返回（不要包含任何 markdown 符号如 \`\`\`json）：
    {
      "tags": ["标签1", "标签2", "标签3"]
    }`;

    const rawText = await fetchAiVision(mimeType, base64Image, prompt);
    const noThinkText = rawText.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    const cleanJsonStr = noThinkText.replace(/```json/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleanJsonStr);
    return parsed.tags && parsed.tags.length > 0 ? parsed.tags : ["童趣时光"];
  } catch (error) {
    console.error(`❌ [AI 标签补标失败详情]:`, error.message);
    return ["童趣时光"];
  }
}


// ================= 3. 主执行业务管道 (Pipeline) =================
async function runPipeline() {
  try {
    console.log(`\n🎨 欢迎使用儿童美术馆自动化同步工具`);
    
    // 💡 在终端实时询问是否开启垃圾回收（直接回车或输入 n 则默认关闭，安全保护线上作品）
    const answer = await askQuestion(`❓ 是否开启【垃圾回收机制】？\n   (开启后: 若本地 raw-images 原图被删除，线上画作也会自动同步清理)\n   👉 请选择是否开启垃圾回收？(y/N，直接回车默认关闭): `);
    const pruneDeletedArtworks = answer.toLowerCase() === 'y';

    if (pruneDeletedArtworks) {
      console.log(`⚠️ 【已开启】垃圾回收：本地删除原图将同步清理线上画作。\n`);
    } else {
      console.log(`🛡️ 【已关闭】垃圾回收：本地删除原图不影响线上，画作安全保留。\n`);
    }

    // -------------------------------------------------------------
    // 步骤 0：平滑迁移旧版 artworks.json 到 Content Collections 目录
    // -------------------------------------------------------------
    if (fs.existsSync(legacyJsonPath) && fs.readdirSync(contentDir).length === 0) {
      console.log(`📦 检测到旧版 artworks.json，正在自动迁移为 Content Collections 独立文件...`);
      try {
        const legacyData = JSON.parse(fs.readFileSync(legacyJsonPath, 'utf-8'));
        if (Array.isArray(legacyData)) {
          for (const item of legacyData) {
            if (!item.id) item.id = generateRandomFilename();
            if (!item.tags) item.tags = ["童趣时光"];
            
            const filename = getArtFilename(item.id, item.title);
            const filePath = path.join(contentDir, filename);
            fs.writeFileSync(filePath, JSON.stringify(item, null, 2), 'utf-8');
          }
          console.log(`✨ 成功迁移 ${legacyData.length} 个历史画作条目到 ${contentDir}`);
          fs.renameSync(legacyJsonPath, `${legacyJsonPath}.bak`);
        }
      } catch (e) {
        console.warn(`⚠️ 旧版 artworks.json 迁移失败: ${e.message}`);
      }
    }

    // -------------------------------------------------------------
    // 步骤 1：从 src/content/artworks/ 读取所有独立的画作条目
    // -------------------------------------------------------------
    let artworksMap = new Map();
    const contentFiles = fs.existsSync(contentDir) ? fs.readdirSync(contentDir).filter(f => f.endsWith('.json')) : [];

    for (const file of contentFiles) {
      const filePath = path.join(contentDir, file);
      try {
        const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        if (content.id) {
          artworksMap.set(content.id, { data: content, filePath });
        }
      } catch (e) {
        console.warn(`⚠️ 解析文件失败跳过: ${file}`);
      }
    }

    console.log(`🔍 开始执行资产体检与自愈审计（共托管条目: ${artworksMap.size}）...`);

    // -------------------------------------------------------------
    // 步骤 2：垃圾回收机制（根据用户刚刚在终端的选择执行）
    // -------------------------------------------------------------
    let prunedCount = 0;

    if (pruneDeletedArtworks) {
      const rawFilesNow = fs.existsSync(inputDir) ? fs.readdirSync(inputDir) : [];

      for (const [id, entry] of artworksMap.entries()) {
        const item = entry.data;
        if (item.sourceFile && !rawFilesNow.includes(item.sourceFile)) {
          if (item.image) {
            const targetWebpPath = path.join(__dirname, 'public', item.image);
            if (fs.existsSync(targetWebpPath)) fs.unlinkSync(targetWebpPath);
          }
          if (fs.existsSync(entry.filePath)) fs.unlinkSync(entry.filePath);

          artworksMap.delete(id);
          prunedCount++;
          console.log(`🗑️ [自动清理] 原图已删除，已同步移除条目与图床文件: "${item.title}"`);
        }
      }

      if (prunedCount > 0) console.log(`🧹 成功清理失效孤儿资产 ${prunedCount} 个。\n`);
    } else {
      console.log(`🛡️ [跳过垃圾回收] 即使部分原图在 raw-images 中不存在，线上画作也将保持完好。\n`);
    }

    let healedCount = 0;
    let tagSupplementCount = 0;

    // -------------------------------------------------------------
    // 步骤 3：物理资产自愈 & 现有数据安全补标（文件名自动同步更新）
    // -------------------------------------------------------------
    for (const [id, entry] of artworksMap.entries()) {
      const item = entry.data;
      if (!item.image) continue;
      const targetWebpPath = path.join(__dirname, 'public', item.image);
      const sourcePath = item.sourceFile ? path.join(inputDir, item.sourceFile) : null;

      let imageBuffer = null;
      let isModified = false;

      // 任务 A：物理自愈
      if (!fs.existsSync(targetWebpPath) && sourcePath && fs.existsSync(sourcePath)) {
        imageBuffer = fs.readFileSync(sourcePath);
        await sharp(imageBuffer)
          .rotate()
          .resize({ width: 1920, withoutEnlargement: true })
          .webp({ quality: 80 })
          .toFile(targetWebpPath);
        healedCount++;
        console.log(`✨ [自愈] 成功从原图重新压缩生成 WebP: ${path.basename(item.image)}`);
      }

      // 任务 B：对已有旧数据安全补齐标签
      if (!item.tags || !Array.isArray(item.tags) || item.tags.length === 0 || (item.tags.length === 1 && item.tags[0] === '童趣时光')) {
        if (!imageBuffer && sourcePath && fs.existsSync(sourcePath)) imageBuffer = fs.readFileSync(sourcePath);
        if (imageBuffer) {
          const mimeType = item.sourceFile?.endsWith('.png') ? 'image/png' : 'image/jpeg';
          const base64Image = imageBuffer.toString('base64');
          console.log(`🏷️ [安全补标] 发现旧画作 "${item.title}" 标签缺失或单一，正在通过 AI 重新提炼...`);
          const tags = await getAiTagsOnly(mimeType, base64Image);
          item.tags = tags;
          isModified = true;
          tagSupplementCount++;
          console.log(`   ✨ 标签补齐成功 -> ${item.tags.join(', ')}`);
        }
      }

      // 💡 检查并确保存储的文件名符合 `id_title.json` 最新规范
      const expectedFilename = getArtFilename(item.id, item.title);
      const expectedFilePath = path.join(contentDir, expectedFilename);

      if (isModified || entry.filePath !== expectedFilePath) {
        if (fs.existsSync(entry.filePath) && entry.filePath !== expectedFilePath) {
          fs.unlinkSync(entry.filePath);
        }
        fs.writeFileSync(expectedFilePath, JSON.stringify(item, null, 2), 'utf-8');
        entry.filePath = expectedFilePath;
      }
    }

    // -------------------------------------------------------------
    // 步骤 4：增量扫描与新图转码流水线
    // -------------------------------------------------------------
    const processedSourceFiles = new Set([...artworksMap.values()].map(e => e.data.sourceFile).filter(Boolean));
    const processedMd5s = new Set([...artworksMap.values()].map(e => e.data.md5).filter(Boolean));

    const rawFiles = fs.existsSync(inputDir) ? fs.readdirSync(inputDir).filter(file => /\.(jpg|jpeg|png|webp)$/i.test(file)) : [];
    const totalFiles = rawFiles.length;

    if (totalFiles === 0) {
      console.log(`📂 raw-images 文件夹下没有发现任何图片。`);
      return;
    }

    console.log(`📦 共扫描到 ${totalFiles} 张原图，开始检查增量更新...\n`);

    let processedCount = 0;
    let skippedCount = 0;
    let currentIndex = 0;

    for (const filename of rawFiles) {
      currentIndex++;
      const progress = `(${currentIndex}/${totalFiles})`;
      const inputPath = path.join(inputDir, filename);

      const imageBuffer = fs.readFileSync(inputPath);
      const fileMd5 = calculateMd5(imageBuffer);

      if (processedSourceFiles.has(filename) || processedMd5s.has(fileMd5)) {
        skippedCount++;
        console.log(`⏩ ${progress} 跳过重复: ${filename}`);
        continue;
      }

      processedCount++;
      console.log(`✨ ${progress} 发现新原图，正在捕捉童真幻想: ${filename}`);

      const randomId = `art_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      const outputWebpName = `${generateRandomFilename()}.webp`;
      const outputPath = path.join(outputDir, outputWebpName);
      const imagePathForJson = `/uploads/${outputWebpName}`;

      const base64Image = imageBuffer.toString('base64');
      const mimeType = filename.endsWith('.png') ? 'image/png' : 'image/jpeg';

      await sharp(inputPath)
        .rotate()
        .resize({ width: 1920, withoutEnlargement: true })
        .webp({ quality: 80 })
        .toFile(outputPath);

      console.log(`   🔒 EXIF 隐私已清除，生成图床缓存 -> ${outputWebpName}`);

      let title = path.parse(filename).name;
      let description = "暂无简介";
      let tags = ["童趣时光"];

      if (AI_CONFIG.enabled) {
        const aiData = await getAiMetadata(mimeType, base64Image);
        if (aiData) {
          title = aiData.title || title;
          description = aiData.description || description;
          tags = aiData.tags || tags;
          console.log(`   🎨 童趣文案与标签生成成功 -> 标题: ${title} | 标签: ${tags.join(', ')}`);
        }
      }

      const newArtItem = {
        id: randomId,
        title,
        image: imagePathForJson,
        sourceFile: filename,
        md5: fileMd5,
        date: new Date().toISOString().split('T')[0],
        description,
        tags
      };

      const newFilename = getArtFilename(randomId, title);
      const newFilePath = path.join(contentDir, newFilename);
      fs.writeFileSync(newFilePath, JSON.stringify(newArtItem, null, 2), 'utf-8');

      processedSourceFiles.add(filename);
      processedMd5s.add(fileMd5);
    }

    console.log(`\n========================================`);
    console.log(`🎉 任务全部圆满完成！`);
    console.log(`📊 总计扫描: ${totalFiles} 张`);
    console.log(`✨ 成功新增: ${processedCount} 张独立文件`);
    console.log(`⏩ 跳过重复: ${skippedCount} 张`);
    if (healedCount > 0) console.log(`🔄 自愈修复: ${healedCount} 张`);
    if (tagSupplementCount > 0) console.log(`🏷️ 安全补标: ${tagSupplementCount} 个旧条目`);
    console.log(`========================================\n`);

  } catch (error) {
    console.error('❌ 流水线执行出错:', error);
  }
}

runPipeline();