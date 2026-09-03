import rss from '@astrojs/rss';
import { getPosts } from '../lib/notion';
import { SITE_DESCRIPTION, SITE_TITLE } from '../consts';

export async function GET(context) {
	const posts = await getPosts();
	return rss({
		title: SITE_TITLE,
		description: SITE_DESCRIPTION,
		site: context.site,
		// @astrojs/rss の既定は trailingSlash: true で、link に末尾スラッシュを
		// 付け足してしまう（実測）。canonical / sitemap / 内部リンクと揃える
		trailingSlash: false,
		items: posts.map((post) => ({
			title: post.title,
			pubDate: post.date ? new Date(post.date) : new Date(),
			description: post.description,
			// 末尾スラッシュを付けない。canonical / sitemap / 内部リンクはすべて
			// スラッシュ無しで、ここだけ食い違っていた（trailingSlash: 'never' と揃える）
			link: `/posts/${post.slug || post.id}`,
		})),
	});
}
