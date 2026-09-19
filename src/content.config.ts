// src/content.config.ts
import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders'; // 引入 Astro v5 的 glob 加载器

const artworks = defineCollection({
  // 指定 JSON 文件存放的目录路径和匹配规则
  loader: glob({ pattern: '**/*.json', base: './src/content/artworks' }),
  schema: z.object({
    title: z.string(),
    date: z.string(),
    description: z.string(),
    image: z.string(),
    category: z.string().optional(),
    tags: z.array(z.string()).optional(),
  }),
});

export const collections = { artworks };
