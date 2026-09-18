/**
 * ==============================================================================
 * 数字儿童美术馆自动化流水线脚本 (sync-and-process.js)
 * ==============================================================================
 * 
 * 💡 脚本核心功能简介：
 * 1. 垃圾回收机制（自动清理）：若在 raw-images 文件夹中手动删除了某张原图，
 *    再次运行脚本时，会自动从 artworks.json 总账本中剔除该条目，并物理同步
 *    删除 public/uploads 目录中对应的 WebP 缓存图床文件。
 * 2. 智能资产自愈：若图床中的 .webp 文件因误删丢失，但 raw-images 原图还在，
 *    脚本会自动重新进行无损压缩恢复。
 * 3. 增量与内容去重：通过文件名与二进制文件的 MD5 哈希指纹双重校验，跳过已处理图片。
 * 4. 极致隐私保护：利用 Sharp 库自动剥离原图携带的所有 EXIF 摄影参数、相机型号与 GPS 定位。
 * 5. 多模型 AI 童趣赋能：支持 Gemini、DeepSeek、MiniMax，引导大模型抛弃枯燥的美术评论，
 *    转而捕捉宝宝天真烂漫的童话世界观。
 * ==============================================================================
 */

// ================= 1. 模块导入与运行环境初始化 =================
import fs from 'node:fs';          // Node.js 文件系统模块，用于读写文件和目录
import path from 'node:path';      // Node.js 路径处理模块，用于拼接跨平台路径
import crypto from 'node:crypto'; // Node.js 加密模块，用于生成随机哈希和计算 MD5
import { fileURLToPath } from 'node:url'; // 用于在 ES Module 环境下解析文件路径

import sharp from 'sharp';       // 高性能图片处理库，负责裁剪、缩放和转码 WebP

// 获取当前脚本所在目录的绝对路径（兼容 ES Module 规范）
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 定义核心项目目录与文件路径常量
const jsonPath = path.join(__dirname, 'src/data/artworks.json');       // 存放所有画作元数据的总账本
const inputDir = path.join(__dirname, 'raw-images');                 // 存放家长投递原始照片的文件夹
const outputDir = path.join(__dirname, 'public/uploads');             // 存放压缩后 WebP 图床的文件夹

// 自动初始化文件夹：若目录不存在则递归创建，防止因目录缺失导致程序崩溃
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}
if (!fs.existsSync(path.dirname(jsonPath))) {
  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
}


// ================= 2. 多模型 AI 智能视觉配置中心 =================
const AI_CONFIG = {
  enabled: true,        // 总开关：true 开启大模型童趣识图，false 关闭（降级为默认文件名和“暂无简介”）
  provider: 'minimax', // 当前使用的大模型服务商，可选: 'gemini', 'minimax', 'deepseek'

  // 各大主流 AI 厂商的配置映射表
  configs: {
    gemini: {
      apiKey: process.env.GEMINI_API_KEY || '你的_GEMINI_API_KEY',
      model: 'gemini-2.5-flash',
      url: (model, key) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`
    },
    deepseek: {
      apiKey: process.env.DEEPSEEK_API_KEY || '你的_DEEPSEEK_API_KEY',
      model: 'deepseek-chat', // 兼容多模态视觉的 DeepSeek 聊天模型
      url: () => 'https://api.deepseek.com/chat/completions'
    },
    minimax: {
      apiKey: process.env.MINIMAX_API_KEY || 'sk-cp-Swg2zHMiJpO569-Rnsj4SB3JaEGrxNi6cxJpqggHHg8qFwWDH5TwyUHmzwxeGLBKW-WEii5HTyLvvpCOc_DwYzbpoKtuYlQa--6d7I7MOARatbMlpLZMBbY',
      model: 'MiniMax-M3',     // MiniMax 多模态模型
      url: () => 'https://api.minimax.chat/v1/chat/completions'
    }
  }
};


// ================= 3. 底层密码学与辅助工具函数 =================

/**
 * 生成完全无规律、不可预测的密码学随机资产文件名
 * 避免直接使用时间戳或自增数字导致文件名被外人规律化猜解
 * @returns {string} 形如 art_a7f9b2c1 的安全文件名
 */
function generateRandomFilename() {
  const randomHex = crypto.randomBytes(6).toString('hex'); // 生成 12 位十六进制随机字符串
  return `art_${randomHex}`;
}

/**
 * 计算文件二进制缓冲区的 MD5 哈希指纹
 * 用于实现“内容级去重”（防止图片换了名字但内容完全一样时重复处理）
 * @param {Buffer} buffer - 图片文件的二进制数据
 * @returns {string} 32位 MD5 哈希串
 */
function calculateMd5(buffer) {
  return crypto.createHash('md5').update(buffer).digest('hex');
}

/**
 * 统一的通用 AI 视觉接口适配器
 * 自动适配 Google Gemini 官方 API 与兼容 OpenAI 规范的其他大模型（DeepSeek / MiniMax）
 * @param {string} mimeType - 图片的 MIME 类型 (image/jpeg 或 image/png)
 * @param {string} base64Image - 经过 Base64 编码的图片字符串
 * @param {string} prompt - 策展/童趣提示词
 * @returns {Promise<string>} 大模型返回的原始文本内容
 */
async function fetchAiVision(mimeType, base64Image, prompt) {
  const currentProvider = AI_CONFIG.provider;
  const cfg = AI_CONFIG.configs[currentProvider];

  // 安全前置检查：确认当前选中的模型已配置了合法的 API Key，而不是默认占位符
  if (!cfg || cfg.apiKey.startsWith('你的_')) {
    throw new Error(`未配置 ${currentProvider} 的有效 API Key`);
  }

  let requestUrl = '';
  let headers = { 'Content-Type': 'application/json' };
  let body = {};

  // 分支 A：针对 Google Gemini 构建官方特有的请求体结构
  if (currentProvider === 'gemini') {
    requestUrl = cfg.url(cfg.model, cfg.apiKey);
    body = {
      contents: [{
        parts: [
          { text: prompt },
          { inline_data: { mime_type: mimeType, data: base64Image } }
        ]
      }]
    };
  } 
  // 分支 Б：针对 DeepSeek、MiniMax 等兼容 OpenAI 标准多模态规范构建请求体
  else {
    requestUrl = cfg.url();
    headers['Authorization'] = `Bearer ${cfg.apiKey}`;
    body = {
      model: cfg.model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Image}` } }
          ]
        }
      ]
    };
  }

  // 发起标准 Fetch 异步网络请求
  const response = await fetch(requestUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });

  const data = await response.json();
  let textResult = '';

  // 根据不同的服务商从返回的 JSON 结构中精准提取文本
  if (currentProvider === 'gemini') {
    textResult = data.candidates?.[0]?.content?.parts?.[0]?.text;
  } else {
    textResult = data.choices?.[0]?.message?.content;
  }

  if (!textResult) {
    throw new Error('大模型未返回有效内容');
  }

  return textResult;
}

/**
 * 核心包装函数：调用视觉模型获取充满童趣的艺术品标题与描述
 * 内部已集成深度思考标签过滤与 JSON 解析清洗容错
 * @param {string} mimeType - 图片类型
 * @param {string} base64Image - 图片 Base64 数据
 * @returns {Promise<Object|null>} 解析后的艺术品元数据对象
 */
async function getAiMetadata(mimeType, base64Image) {
  if (!AI_CONFIG.enabled) return null;

  try {
    console.log(`🤖 [AI (${AI_CONFIG.provider})] 正在聆听宝宝画里的奇思妙想...`);
    
    // 🌟 定制化的童趣 Prompt：严禁枯燥的美术评论，专门引导大模型输出童话视角的解读
    const prompt = `请作为一个充满童心、懂得欣赏儿童画的伙伴，来观察这幅画。
    要求：
    1. 绝对不要写枯燥的美术评论、构图分析或色彩技法评价。
    2. 要像宝宝在跟你讲故事一样，充满异想天开、天真烂漫的童趣。
    3. 描述可以带上“宝宝说……”或者直接用充满童话色彩的视角来写。
    
    请严格以纯 JSON 格式返回（不要包含任何 markdown 符号如 \`\`\`json）：
    {
      "title": "一个充满童趣、生动好玩的简短标题",
      "description": "一段充满幻想与童真的描述（50-100字左右，展现宝宝眼中的奇妙世界）"
    }`;

    // 获取大模型原始回复文本
    const rawText = await fetchAiVision(mimeType, base64Image, prompt);

    // 🛡️ 兼容处理：自动剔除某些推理模型（如 DeepSeek-R1）自带的 <think>...</think> 内部思考过程
    const noThinkText = rawText.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

    // 清理可能附带的 markdown 标记，并将其反序列化为安全的 JSON 对象
    const cleanJsonStr = noThinkText.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(cleanJsonStr);

  } catch (error) {
    console.warn(`⚠️ [AI] 童趣文案生成失败 (${error.message})，已平稳降级为默认文件名。`);
    return null;
  }
}


// ================= 4. 主执行业务管道 (Pipeline) =================
async function runPipeline() {
  try {
    // -------------------------------------------------------------
    // 步骤 1：安全读取并解析 artworks.json 总账本数据（加入防爆类型校验）
    // -------------------------------------------------------------
    let artworks = [];
    if (fs.existsSync(jsonPath)) {
      try {
        const fileContent = fs.readFileSync(jsonPath, 'utf-8').trim();
        if (fileContent) {
          const parsed = JSON.parse(fileContent);
          // 必须确保解析出来的是数组，否则强行重置，防止后续 .filter / .map 报错崩溃
          if (Array.isArray(parsed)) {
            artworks = parsed;
          } else {
            console.warn(`⚠️ [警告] artworks.json 格式异常（不是数组），已自动重置为空数组。`);
          }
        }
      } catch (e) {
        console.warn(`⚠️ [警告] artworks.json 解析失败，已自动重置为空数组。`);
      }
    }

    console.log(`\n🔍 开始执行资产体检与自愈审计...`);

    // -------------------------------------------------------------
    // 步骤 2：阶段零 - 孤儿资产自动清理（垃圾回收机制）
    // 检查 raw-images 目录下的所有原文件名。若总账本中有记录，
    // 但 raw-images 中对应的原图已被用户手动删除，则同步进行联动清理
    // -------------------------------------------------------------
    const rawFilesNow = fs.existsSync(inputDir) ? fs.readdirSync(inputDir) : [];
    const initialCount = artworks.length;
    
    artworks = artworks.filter(item => {
      // 如果该条目有记录源文件，但在 raw-images 中已经找不到了
      if (item.sourceFile && !rawFilesNow.includes(item.sourceFile)) {
        const targetWebpPath = path.join(outputDir, path.basename(item.image));
        
        // 顺便把 public/uploads 里的对应 WebP 缓存文件也物理删除
        if (fs.existsSync(targetWebpPath)) {
          fs.unlinkSync(targetWebpPath);
          console.log(`🗑️ [自动清理] 发现原图已删除，已同步移除图床文件: ${path.basename(item.image)}`);
        }
        console.log(`🗑️ [自动清理] 已从总账本中剔除失效条目: "${item.title}"`);
        return false; // 从数组中过滤掉该条目
      }
      return true; // 保留正常条目
    });

    const prunedCount = initialCount - artworks.length;
    if (prunedCount > 0) {
      console.log(`🧹 成功清理失效孤儿资产 ${prunedCount} 个。\n`);
    }

    let healedCount = 0;       // 统计物理文件自愈恢复的数量
    let aiEnrichedCount = 0;   // 统计 AI 智能重塑文案的数量

    // -------------------------------------------------------------
    // 步骤 3：阶段一 - 物理资产自愈检查 & 旧文案 AI 智能升级
    // -------------------------------------------------------------
    for (const item of artworks) {
      if (!item.image) continue;
      const webpFileName = path.basename(item.image);
      const targetWebpPath = path.join(outputDir, webpFileName);

      let imageBuffer = null;
      let sourcePath = item.sourceFile ? path.join(inputDir, item.sourceFile) : null;

      // 任务 A：物理自愈 —— 如果图床目录中的 .webp 文件丢失，但原始照片还在，自动重新压制生成
      if (!fs.existsSync(targetWebpPath)) {
        console.warn(`⚠️ [自愈] 发现文件丢失: ${webpFileName}`);
        if (sourcePath && fs.existsSync(sourcePath)) {
          imageBuffer = fs.readFileSync(sourcePath);
          await sharp(imageBuffer)
            .rotate()                                               // 根据手机拍摄的 EXIF 自动旋转正方向
            .resize({ width: 1920, withoutEnlargement: true })     // 限制最大宽度为 1920px，防止过大
            .webp({ quality: 80 })                                  // 转换为高压缩率的 WebP 格式
            .toFile(targetWebpPath);
          healedCount++;
          console.log(`✨ [自愈] 成功从原图重新压缩生成 WebP。`);
        }
      }

      // 任务 B：AI 文案重塑 —— 若发现旧条目仍然是老旧占位符，顺手升级为最新的童趣故事文案
      if (AI_CONFIG.enabled && (item.description === "暂无简介" || item.description.includes("混合媒材") || item.description.includes("水彩晕染"))) {
        if (!imageBuffer && sourcePath && fs.existsSync(sourcePath)) {
          imageBuffer = fs.readFileSync(sourcePath);
        }
        if (imageBuffer) {
          const mimeType = item.sourceFile?.endsWith('.png') ? 'image/png' : 'image/jpeg';
          const base64Image = imageBuffer.toString('base64');
          console.log(`🤖 [AI 童趣重塑] 正在为条目 "${item.title}" 赋予童话视角...`);
          const aiData = await getAiMetadata(mimeType, base64Image);
          if (aiData) {
            item.title = aiData.title || item.title;
            item.description = aiData.description || item.description;
            aiEnrichedCount++;
            console.log(`✨ [童趣重塑成功] 新标题: ${item.title}`);
          }
        }
      }
    }

    if (healedCount > 0 || aiEnrichedCount > 0) {
      console.log(`🎉 审计修复完成：自愈文件 ${healedCount} 个，童趣文案重塑 ${aiEnrichedCount} 个。\n`);
    } else {
      console.log(`✅ 资产状态健康。\n`);
    }

    // -------------------------------------------------------------
    // 步骤 4：阶段二 - 带实时进度的增量扫描与转码流水线
    // -------------------------------------------------------------
    // 提取已处理过的原文件名集合与 MD5 集合，用于极速去重
    const processedSourceFiles = new Set(artworks.map(item => item.sourceFile).filter(Boolean));
    const processedMd5s = new Set(artworks.map(item => item.md5).filter(Boolean));

    // 读取 raw-images 文件夹下所有的图片格式文件
    const rawFiles = fs.readdirSync(inputDir).filter(file => /\.(jpg|jpeg|png|webp)$/i.test(file));
    const totalFiles = rawFiles.length;

    if (totalFiles === 0) {
      console.log(`📂 raw-images 文件夹下没有发现任何图片。`);
      return;
    }

    console.log(`📦 共扫描到 ${totalFiles} 张原图，开始检查增量更新...\n`);

    let processedCount = 0; 
    let skippedCount = 0;   
    let currentIndex = 0;   

    // 循环遍历每一张原始照片
    for (const filename of rawFiles) {
      currentIndex++;
      const progress = `(${currentIndex}/${totalFiles})`; 
      const inputPath = path.join(inputDir, filename);
      
      const imageBuffer = fs.readFileSync(inputPath);
      const fileMd5 = calculateMd5(imageBuffer);

      // 去重检查：如果文件名或文件内容 MD5 已经存在于总账本中，直接跳过
      if (processedSourceFiles.has(filename) || processedMd5s.has(fileMd5)) {
        skippedCount++;
        console.log(`⏩ ${progress} 跳过重复: ${filename}`);
        continue;
      }

      processedCount++;
      console.log(`✨ ${progress} 发现新原图，正在捕捉童真幻想: ${filename}`);

      // 生成安全的随机文件名和目标路径
      const randomBaseName = generateRandomFilename();
      const outputWebpName = `${randomBaseName}.webp`;
      const outputPath = path.join(outputDir, outputWebpName);
      const imagePathForJson = `/uploads/${outputWebpName}`;

      const base64Image = imageBuffer.toString('base64');
      const mimeType = filename.endsWith('.png') ? 'image/png' : 'image/jpeg';

      // 使用 Sharp 进行图片处理：清除 EXIF 隐私、等比缩放、转码为 WebP
      await sharp(inputPath)
        .rotate()                                               // 自动纠正手机拍摄时的旋转角度
        .resize({ width: 1920, withoutEnlargement: true })     // 限制最大宽度 1920px，保护画质同时大幅瘦身
        .webp({ quality: 80 })                                  // 压缩为 80% 画质的 WebP
        .toFile(outputPath);

      console.log(`   🔒 EXIF 隐私已清除，生成随机文件名 -> ${outputWebpName}`);

      let title = path.parse(filename).name; // 默认标题为原文件名
      let description = "暂无简介";             // 默认描述

      // 如果开启了 AI，调用视觉模型生成专属童趣标题和描述
      if (AI_CONFIG.enabled) {
        const aiData = await getAiMetadata(mimeType, base64Image);
        if (aiData) {
          title = aiData.title || title;
          description = aiData.description || description;
          console.log(`   🎨 童趣文案生成成功 -> 标题: ${title}`);
        }
      }

      // 将新画作的元数据结构压入 artworks 数组
      artworks.push({
        id: `art_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        title,
        image: imagePathForJson,
        sourceFile: filename, 
        md5: fileMd5,         
        date: new Date().toISOString().split('T')[0], // 自动记录当前日期 (YYYY-MM-DD)
        description
      });

      // 动态将新文件加入已处理集合中
      processedSourceFiles.add(filename);
      processedMd5s.add(fileMd5);
    }

    // -------------------------------------------------------------
    // 步骤 5：将最新的完整画作数组持久化写回到 artworks.json 总账本中
    // -------------------------------------------------------------
    fs.writeFileSync(jsonPath, JSON.stringify(artworks, null, 2), 'utf-8');

    // 打印流水线大功告成的统计报表
    console.log(`\n========================================`);
    console.log(`🎉 任务全部圆满完成！`);
    console.log(`📊 总计扫描: ${totalFiles} 张`);
    console.log(`✨ 成功新增: ${processedCount} 张`);
    console.log(`⏩ 跳过重复: ${skippedCount} 张`);
    if (healedCount > 0) console.log(`🔄 自愈修复: ${healedCount} 张`);
    if (aiEnrichedCount > 0) console.log(`🎨 童趣文案重塑: ${aiEnrichedCount} 个`);
    console.log(`========================================\n`);

  } catch (error) {
    console.error('❌ 流水线执行出错:', error);
  }
}

// 立即执行自动化流水线
runPipeline();