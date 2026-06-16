import rss from '@astrojs/rss';
import { getPosts } from '../lib/notion';
import { SITE_DESCRIPTION, SITE_TITLE } from '../consts';

export async function GET(context) {
	const posts = await getPosts();
	return rss({
		title: SITE_TITLE,
		description: SITE_DESCRIPTION,
		site: context.site,
		items: posts.map((post) => ({
			title: post.title,
			pubDate: post.date ? new Date(post.date) : new Date(),
			description: post.description,
			link: `/posts/${post.slug || post.id}/`,
		})),
	});
}
