import { defineCollection, z } from 'astro:content';

const blog = defineCollection({
    // Notionから取得する場合、loader行を削除またはコメントアウトします
    schema: z.object({
        title: z.string(),
        description: z.string().optional().default(""),
        pubDate: z.coerce.date(),
        updatedDate: z.coerce.date().optional(),
        // 画像はNotionのURL(文字列)として扱うように変更
        heroImage: z.string().optional(),
        // Tagsを追加
        tags: z.array(z.string()).optional().default([]),
    }),
});

export const collections = { blog };