/**
 * ==============================================================================
 * 数字儿童美术馆自动化流水线脚本 (sync-and-process.js)
 * 
 * 核心功能与技术特性：
 * 1. 增量去重：基于原始文件名 (sourceFile) 与文件内容二进制指纹 (MD5) 双重防重。
 * 2. 隐私保护：利用 Sharp 自动剥离所有 EXIF 摄影参数、相机型号与 GPS 定位数据。
 * 3. 极限瘦身：等比例自动缩放（最大宽度 1920px）并无损转码为高压缩率的 WebP 格式。
 * 4. 安全命名：使用 Node.js 加密模块生成不可预测的随机哈希文件名（如 art_a7f9b2c1）。
 * 5. 多模型童趣 AI：原生支持 Gemini、DeepSeek、MiniMax，并通过专属 Prompt 
 *    引导大模型抛弃枯燥的美术评论，转而捕捉宝宝异想天开的童话叙事。
 * 6. 智能自愈：自动审计物理图床完整性，丢失时自动由原图重建，并支持为旧条目
 *    进行 AI 智能文案补全。
 * 7. 容错保护：自动防御 JSON 格式异常引起的不可迭代中断错误。
 * ==============================================================================
 */

// 导入 Node.js 原生模块
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

// 导入高性能图片处理库
import sharp from 'sharp';

// 1. 兼容 ES Module (ESM) 环境下的 __dirname 和 __filename 路径解析
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 2. 定义核心目录与文件路径常量
const jsonPath = path.join(__dirname, 'src/data/artworks.json');       // 元数据总账本文件
const inputDir = path.join(__dirname, 'raw-images');                 // 原始图片暂存目录（投递箱）
const outputDir = path.join(__dirname, 'public/uploads');             // 最终生成的 WebP 图床目录

// 3. 初始化目录结构：若目标文件夹不存在，则自动递归创建，确保程序不会因路径报错
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}
if (!fs.existsSync(path.dirname(jsonPath))) {
  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
}

// ================= 🤖 多模型 AI 智能配置 =================
const AI_CONFIG = {
  enabled: true,        // 👈 总开关：true 开启童趣 AI 识图，false 关闭（降级为默认文件名与“暂无简介”）
  provider: 'minimax', // 👈 当前激活的大模型，可选: 'gemini', 'minimax', 'deepseek'

  // 各大主流厂商的 API 参数与请求端点映射配置
  configs: {
    gemini: {
      apiKey: process.env.GEMINI_API_KEY || '你的_GEMINI_API_KEY',
      model: 'gemini-2.5-flash',
      url: (model, key) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`
    },
    deepseek: {
      apiKey: process.env.DEEPSEEK_API_KEY || '你的_DEEPSEEK_API_KEY',
      model: 'deepseek-chat', // 支持多模态视觉的聊天/推理模型
      url: () => 'https://api.deepseek.com/chat/completions'
    },
    minimax: {
      apiKey: process.env.MINIMAX_API_KEY || 'sk-cp-Swg2zHMiJpO569-Rnsj4SB3JaEGrxNi6cxJpqggHHg8qFwWDH5TwyUHmzwxeGLBKW-WEii5HTyLvvpCOc_DwYzbpoKtuYlQa--6d7I7MOARatbMlpLZMBbY',
      model: 'MiniMax-M3',     // MiniMax 多模态模型
      url: () => 'https://api.minimax.chat/v1/chat/completions'
    }
  }
};
// ====================================================

/**
 * 辅助函数：生成完全无规律的密码学随机资产文件名
 * 避免时间戳或数字递增带来的隐私泄露和文件名规律化猜测
 * @returns {string} 形如 art_a7f9b2c1 的随机前缀
 */
function generateRandomFilename() {
  const randomHex = crypto.randomBytes(6).toString('hex'); // 生成 12 位十六进制随机字符串
  return `art_${randomHex}`;
}

/**
 * 辅助函数：计算文件二进制缓冲区的 MD5 哈希指纹
 * 用于实现“内容级去重”（防止图片换了名字但内容一样时重复处理）
 * @param {Buffer} buffer - 图片文件的二进制数据
 * @returns {string} 32位 MD5 哈希值
 */
function calculateMd5(buffer) {
  return crypto.createHash('md5').update(buffer).digest('hex');
}

/**
 * 统一的通用 AI 视觉接口适配器
 * 自动适配 Google Gemini 官方 API 与兼容 OpenAI 格式的其他大模型（DeepSeek / MiniMax）
 * @param {string} mimeType - 图片 MIME 类型 (image/jpeg 或 image/png)
 * @param {string} base64Image - Base64 编码的图片字符串
 * @param {string} prompt - 策展/童趣提示词
 * @returns {Promise<string>} 大模型返回的原始文本内容
 */
async function fetchAiVision(mimeType, base64Image, prompt) {
  const currentProvider = AI_CONFIG.provider;
  const cfg = AI_CONFIG.configs[currentProvider];

  // 安全检查：确认当前选中的模型已配置了合法的 API Key
  if (!cfg || cfg.apiKey.startsWith('你的_')) {
    throw new Error(`未配置 ${currentProvider} 的有效 API Key`);
  }

  let requestUrl = '';
  let headers = { 'Content-Type': 'application/json' };
  let body = {};

  // 分支 A：针对 Google Gemini 独立构建官方请求体结构
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
  // 分支 B：针对 DeepSeek、MiniMax 等兼容 OpenAI 标准多模态规范构建请求体
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

  // 发起标准 Fetch 网络请求
  const response = await fetch(requestUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });

  const data = await response.json();
  let textResult = '';

  // 根据不同服务商从返回体中精准提取文本内容
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
 * 核心函数：调用视觉模型获取充满童趣的艺术品标题与描述
 * 内部已集成深度思考标签过滤与 JSON 解析清洗容错
 * @param {string} mimeType - 图片类型
 * @param {string} base64Image - 图片 Base64 数据
 * @returns {Promise<Object|null>} 解析后的艺术品元数据对象
 */
async function getAiMetadata(mimeType, base64Image) {
  if (!AI_CONFIG.enabled) return null;

  try {
    console.log(`🤖 [AI (${AI_CONFIG.provider})] 正在聆听宝宝画里的奇思妙想...`);
    
    // 🌟 定制化的童趣 Prompt：严禁美术评论，专门引导大模型输出儿童视角的异想天开故事
    const prompt = `请作为一个充满童心、懂得欣赏儿童画的伙伴，来观察这幅画。
    要求：
    1. 绝对不要写枯燥的美术评论、构图分析或色彩技法评价。
    2. 要像宝宝在跟你讲故事一样，充满异想天开、天真烂漫的童趣。
    3. 描述可以带上“宝宝说……”或者直接用充满童话色彩的视角来写。
    
    请严格以纯 JSON 格式返回（不要包含任何 markdown 符号如 \`\`\`json）：
    {
      "title": "一个充满童趣、生动好玩的简短标题",
      "description": "@@一段充满幻想与童真的描述（50-100字左右，展现宝宝眼中的奇妙世界）"
    }`.replace('@@', ''); // 避免特殊字符干扰

    // 获取大模型原始回复
    const rawText = await fetchAiVision(mimeType, base64Image, prompt);

    // 🛡️ 兼容处理：自动剔除推理模型（如 DeepSeek-R1 等）自带的 <think>...</think> 思考过程文本
    const noThinkText = rawText.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

    // 清理可能附带的 markdown 标记并将其反序列化为 JSON 对象
    const cleanJsonStr = noThinkText.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(cleanJsonStr);

  } catch (error) {
    console.warn(`⚠️ [AI] 童趣文案生成失败 (${error.message})，已平稳降级为默认文件名。`);
    return null;
  }
}

/**
 * 主执行管道：串联资产自愈、AI 智能回填、增量转码与 JSON 总账本更新
 */
async function runPipeline() {
  try {
    // 1. 安全读取并解析 artworks.json 总账本数据（加入防爆类型校验）
    let artworks = [];
    if (fs.existsSync(jsonPath)) {
      try {
        const fileContent = fs.readFileSync(jsonPath, 'utf-8').trim();
        if (fileContent) {
          const parsed = JSON.parse(fileContent);
          // 🛡️ 关键防爆：确保持久化内容必须是数组，若非数组则自动修正，杜绝 is not iterable 报错
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

    let healedCount = 0;       // 统计物理文件自愈恢复的数量
    let aiEnrichedCount = 0;   // 统计 AI 智能补全文案的数量

    // ================= 🛡️ 阶段一：资产自愈 + AI 智能文案补全 =================
    for (const item of artworks) {
      if (!item.image) continue;
      const webpFileName = path.basename(item.image);
      const targetWebpPath = path.join(outputDir, webpFileName);

      let imageBuffer = null;
      let sourcePath = item.sourceFile ? path.join(inputDir, item.sourceFile) : null;

      // 任务 A：物理自愈检查 —— 如果图床目录中的 .webp 文件丢失，但原始图片还在，则自动重新压制生成
      if (!fs.existsSync(targetWebpPath)) {
        console.warn(`⚠️ [自愈] 发现文件丢失: ${webpFileName}`);
        if (sourcePath && fs.existsSync(sourcePath)) {
          imageBuffer = fs.readFileSync(sourcePath);
          await sharp(imageBuffer)
            .rotate()
            .resize({ width: 1920, withoutEnlargement: true })
            .webp({ quality: 80 })
            .toFile(targetWebpPath);
          healedCount++;
          console.log(`✨ [自愈] 成功从原图重新压缩生成 WebP。`);
        }
      }

      // 任务 B：AI 智能回填检查 —— 若开启了 AI，且发现旧条目仍是默认占位或老旧评述，顺手重塑为童趣文案
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

    // ================= 🚀 阶段二：带实时进度的增量扫描与转码 =================
    // 建立双重内存白名单：已处理过的【原文件名】集合 与 【图片内容 MD5 指纹】集合
    const processedSourceFiles = new Set(artworks.map(item => item.sourceFile).filter(Boolean));
    const processedMd5s = new Set(artworks.map(item => item.md5).filter(Boolean));

    // 读取 raw-images 目录下的所有候选图片文件
    const rawFiles = fs.readdirSync(inputDir).filter(file => /\.(jpg|jpeg|png|webp)$/i.test(file));
    const totalFiles = rawFiles.length;

    // 若投递箱为空，直接提示并安全退出
    if (totalFiles === 0) {
      console.log(`📂 raw-images 文件夹下没有发现任何图片。`);
      return;
    }

    console.log(`📦 共扫描到 ${totalFiles} 张原图，开始检查增量更新...\n`);

    let processedCount = 0; // 统计本次新处理的图片数
    let skippedCount = 0;   // 统计本次跳过的重复图片数
    let currentIndex = 0;   // 进度计数器索引

    // 循环遍历每一张原始图片
    for (const filename of rawFiles) {
      currentIndex++;
      const progress = `(${currentIndex}/${totalFiles})`; // 实时进度指示器 (如 3/12)
      const inputPath = path.join(inputDir, filename);
      
      const imageBuffer = fs.readFileSync(inputPath);
      const fileMd5 = calculateMd5(imageBuffer);

      // 双重防重校验：若原文件名或内容 MD5 已经登记过，则直接跳过处理
      if (processedSourceFiles.has(filename) || processedMd5s.has(fileMd5)) {
        skippedCount++;
        console.log(`⏩ ${progress} 跳过重复: ${filename}`);
        continue;
      }

      processedCount++;
      console.log(`✨ ${progress} 发现新原图，正在捕捉童真幻想: ${filename}`);

      // 生成完全无规律的安全随机资产文件名
      const randomBaseName = generateRandomFilename();
      const outputWebpName = `${randomBaseName}.webp`;
      const outputPath = path.join(outputDir, outputWebpName);
      const imagePathForJson = `/uploads/${outputWebpName}`;

      const base64Image = imageBuffer.toString('base64');
      const mimeType = filename.endsWith('.png') ? 'image/png' : 'image/jpeg';

      // 核心图像处理流水线：自动根据方向旋转、等比例缩放（最大宽度1920px）、剥离所有 EXIF 隐私并高质量转码为 WebP
      await sharp(inputPath)
        .rotate()
        .resize({ width: 1920, withoutEnlargement: true })
        .webp({ quality: 80 })
        .toFile(outputPath);

      console.log(`   🔒 EXIF 隐私已清除，生成随机文件名 -> ${outputWebpName}`);

      // 初始化默认的降级文案（以原文件名去掉后缀作为临时标题）
      let title = path.parse(filename).name;
      let description = "暂无简介";

      // 若开启了 AI，调用大模型生成充满童趣的艺术品文案
      if (AI_CONFIG.enabled) {
        const aiData = await getAiMetadata(mimeType, base64Image);
        if (aiData) {
          title = aiData.title || title;
          description = aiData.description || description;
          console.log(`   🎨 童趣文案生成成功 -> 标题: ${title}`);
        }
      }

      // 将新作品条目压入总账本数组
      artworks.push({
        id: `art_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        title,
        image: imagePathForJson,
        sourceFile: filename, // 记录源文件名，用于后续溯源和防重
        md5: fileMd5,         // 记录内容 MD5，防止换名重复导入
        date: new Date().toISOString().split('T')[0],
        description
      });

      // 同步更新内存集合，防止单次运行中出现重复冲突
      processedSourceFiles.add(filename);
      processedMd5s.add(fileMd5);
    }

    // 将最新的艺术品元数据写回 src/data/artworks.json 总账本（格式化缩进 2 格）
    fs.writeFileSync(jsonPath, JSON.stringify(artworks, null, 2), 'utf-8');

    // 打印最终任务执行统计报表
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

// 立即触发执行流水线
runPipeline();