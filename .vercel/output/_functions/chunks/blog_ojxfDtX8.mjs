import { c as createComponent } from './astro-component_C0jAHtL0.mjs';
import 'piccolore';
import { l as renderComponent, n as renderHead, h as addAttribute, r as renderTemplate } from './entrypoint_BPeRZUBX.mjs';
import { $ as $$BaseHead, a as $$Header, b as $$Footer } from './Header_Dm2yJMCF.mjs';
import { S as SITE_DESCRIPTION, a as SITE_TITLE } from './consts_BUCA18RE.mjs';
import { g as getPosts } from './notion_CcLiOKsl.mjs';

const $$Blog = createComponent(async ($$result, $$props, $$slots) => {
  const posts = await getPosts();
  return renderTemplate`<html lang="ja"> <head>${renderComponent($$result, "BaseHead", $$BaseHead, { "title": `Blog | ${SITE_TITLE}`, "description": SITE_DESCRIPTION })}${renderHead()}</head> <body> ${renderComponent($$result, "Header", $$Header, {})} <main> <section style="max-width: 720px; margin: auto; padding: 1em;"> <h1>思索の全記録</h1> <p>これまでの対話を古い順に掲載しています。</p> <hr> ${posts.length > 0 ? renderTemplate`<ul style="padding: 0;"> ${posts.map((post) => {
    const titleText = post.title || "無題の記事";
    const publishDate = post.date;
    const tags = post.tags || [];
    const formattedDate = publishDate ? new Date(publishDate).toLocaleDateString("ja-JP", {
      year: "numeric",
      month: "long",
      day: "numeric"
    }) : "公開日未設定";
    return renderTemplate`<li style="margin-bottom: 2rem; list-style: none; border-bottom: 1px solid #f4f4f4; padding-bottom: 1rem;"> <article> <div style="font-size: 0.9rem; color: #888; margin-bottom: 0.2rem;"> <time${addAttribute(publishDate, "datetime")}>${formattedDate}</time> </div> <a${addAttribute(`/posts/${post.id}`, "href")} style="text-decoration: none;"> <h2 style="margin: 0; font-size: 1.4rem; color: #0070f3; cursor: pointer;"> ${titleText} </h2> </a>  ${tags.length > 0 && renderTemplate`<div style="display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.8rem;"> ${tags.map((tag) => renderTemplate`<a${addAttribute(`/tags/${tag}`, "href")} style="text-decoration: none;"> <span style="background: #f0f0f0; padding: 3px 10px; border-radius: 12px; font-size: 0.75rem; color: #555; border: 1px solid #e0e0e0;">
#${tag} </span> </a>`)} </div>`} </article> </li>`;
  })} </ul>` : renderTemplate`<p>記事が見つかりませんでした。</p>`} </section> </main> ${renderComponent($$result, "Footer", $$Footer, {})} </body></html>`;
}, "/home/yusuke-hosokawa/my-projects/philosophizing-with-ai/src/pages/blog.astro", void 0);

const $$file = "/home/yusuke-hosokawa/my-projects/philosophizing-with-ai/src/pages/blog.astro";
const $$url = "/blog";

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  default: $$Blog,
  file: $$file,
  url: $$url
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
