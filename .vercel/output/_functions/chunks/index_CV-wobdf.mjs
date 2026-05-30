import { c as createComponent } from './astro-component_C0jAHtL0.mjs';
import 'piccolore';
import { l as renderComponent, n as renderHead, h as addAttribute, r as renderTemplate } from './entrypoint_BPeRZUBX.mjs';
import { $ as $$BaseHead, a as $$Header, b as $$Footer } from './Header_Dm2yJMCF.mjs';
import { S as SITE_DESCRIPTION, a as SITE_TITLE } from './consts_BUCA18RE.mjs';
import { g as getPosts } from './notion_CcLiOKsl.mjs';

const $$Index = createComponent(async ($$result, $$props, $$slots) => {
  const posts = await getPosts();
  const formatDate = (dateStr) => {
    return new Date(dateStr).toLocaleDateString("ja-JP", {
      year: "numeric",
      month: "long",
      day: "numeric"
    });
  };
  const tagCounts = posts.reduce((acc, post) => {
    post.tags.forEach((tag) => {
      acc[tag] = (acc[tag] || 0) + 1;
    });
    return acc;
  }, {});
  const sortedTags = Object.entries(tagCounts).sort(([, a], [, b]) => b - a);
  const series = [
    { name: "AIと哲学", pattern: /AIと哲学/ },
    { name: "AIと生物学", pattern: /AIと生物学/ },
    { name: "AIと統計学", pattern: /AIと統計学/ }
  ];
  const postsBySeries = series.map((s) => ({
    name: s.name,
    posts: posts.filter((p) => s.pattern.test(p.title))
  }));
  const postsByMonth = posts.reduce((acc, post) => {
    const date = new Date(post.date);
    const month = `${date.getFullYear()}年${date.getMonth() + 1}月`;
    if (!acc[month]) acc[month] = [];
    acc[month].push(post);
    return acc;
  }, {});
  return renderTemplate`<html lang="ja" data-astro-cid-j7pv25f6> <head><meta name="google-site-verification" content="xAMHzqx75cGq6U6AeyghX7W6Z9Cuwp2l9pNO1DEjiaQ">${renderComponent($$result, "BaseHead", $$BaseHead, { "title": `アーカイブ | ${SITE_TITLE}`, "description": SITE_DESCRIPTION, "data-astro-cid-j7pv25f6": true })}${renderHead()}</head> <body data-astro-cid-j7pv25f6> ${renderComponent($$result, "Header", $$Header, { "data-astro-cid-j7pv25f6": true })} <main data-astro-cid-j7pv25f6> <h1 style="font-size: 2.2rem; margin-bottom: 2rem;" data-astro-cid-j7pv25f6>思索のアーカイブ</h1> <section data-astro-cid-j7pv25f6> <h2 data-astro-cid-j7pv25f6>キーワード集</h2> <p style="font-size: 0.9rem; color: #666;" data-astro-cid-j7pv25f6>よく触れられている思索のテーマ</p> <div class="tag-cloud" data-astro-cid-j7pv25f6> ${sortedTags.map(([tag, count]) => renderTemplate`<a${addAttribute(`/tags/${tag}`, "href")} class="tag-item" data-astro-cid-j7pv25f6>
#${tag} <span class="tag-count" data-astro-cid-j7pv25f6>(${count})</span> </a>`)} </div> </section> <section data-astro-cid-j7pv25f6> <h2 data-astro-cid-j7pv25f6>シリーズ別</h2> ${postsBySeries.map((s) => s.posts.length > 0 && renderTemplate`<div style="margin-bottom: 2rem;" data-astro-cid-j7pv25f6> <h3 style="font-size: 1.2rem; color: #444; margin-bottom: 1rem;" data-astro-cid-j7pv25f6>${s.name}</h3> <ul class="archive-list" data-astro-cid-j7pv25f6> ${s.posts.map((post) => renderTemplate`<li class="archive-item" data-astro-cid-j7pv25f6> <div class="archive-date" data-astro-cid-j7pv25f6>${formatDate(post.date)}</div> <a${addAttribute(`/posts/${post.id}`, "href")} class="archive-link" data-astro-cid-j7pv25f6>${post.title}</a> </li>`)} </ul> </div>`)} </section> <section data-astro-cid-j7pv25f6> <h2 data-astro-cid-j7pv25f6>月別</h2> ${Object.keys(postsByMonth).sort().reverse().map((month) => renderTemplate`<div style="margin-bottom: 1.5rem;" data-astro-cid-j7pv25f6> <h3 style="font-size: 1.1rem; color: #666; border-left: 4px solid #ccc; padding-left: 10px;" data-astro-cid-j7pv25f6>${month}</h3> <ul class="archive-list" data-astro-cid-j7pv25f6> ${postsByMonth[month].map((post) => renderTemplate`<li class="archive-item" data-astro-cid-j7pv25f6> <div class="archive-date" data-astro-cid-j7pv25f6>${formatDate(post.date)}</div> <a${addAttribute(`/posts/${post.id}`, "href")} class="archive-link" data-astro-cid-j7pv25f6>${post.title}</a> </li>`)} </ul> </div>`)} </section> </main> ${renderComponent($$result, "Footer", $$Footer, { "data-astro-cid-j7pv25f6": true })} </body></html>`;
}, "/home/yusuke-hosokawa/my-projects/philosophizing-with-ai/src/pages/index.astro", void 0);

const $$file = "/home/yusuke-hosokawa/my-projects/philosophizing-with-ai/src/pages/index.astro";
const $$url = "";

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  default: $$Index,
  file: $$file,
  url: $$url
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
