import { c as createComponent } from './astro-component_C0jAHtL0.mjs';
import 'piccolore';
import { l as renderComponent, n as renderHead, h as addAttribute, r as renderTemplate } from './entrypoint_BPeRZUBX.mjs';
import { $ as $$BaseHead, a as $$Header, b as $$Footer } from './Header_Dm2yJMCF.mjs';
import { S as SITE_DESCRIPTION, a as SITE_TITLE } from './consts_BUCA18RE.mjs';
import { g as getPosts } from './notion_CcLiOKsl.mjs';

const $$tag = createComponent(async ($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$props, $$slots);
  Astro2.self = $$tag;
  const { tag } = Astro2.params;
  const allPosts = await getPosts();
  const posts = allPosts.filter((post) => post.tags.includes(tag));
  return renderTemplate`<html lang="ja"> <head>${renderComponent($$result, "BaseHead", $$BaseHead, { "title": `${tag} の記事一覧 | ${SITE_TITLE}`, "description": SITE_DESCRIPTION })}${renderHead()}</head> <body> ${renderComponent($$result, "Header", $$Header, {})} <main> <section style="max-width: 720px; margin: auto; padding: 1em;"> <h1>#${tag} の記事一覧</h1> <a href="/">← 全ての記事に戻る</a> <hr> ${posts.length > 0 ? renderTemplate`<ul style="padding: 0;"> ${posts.map((post) => renderTemplate`<li style="margin-bottom: 2rem; list-style: none; border-bottom: 1px solid #f4f4f4; padding-bottom: 1rem;"> <div style="font-size: 0.9rem; color: #888;">${post.date}</div> <a${addAttribute(`/posts/${post.id}`, "href")} style="text-decoration: none;"> <h2 style="margin: 0; font-size: 1.4rem; color: #0070f3;">${post.title}</h2> </a> </li>`)} </ul>` : renderTemplate`<p>このキーワードに該当する記事はありません。</p>`} </section> </main> ${renderComponent($$result, "Footer", $$Footer, {})} </body></html>`;
}, "/home/yusuke-hosokawa/my-projects/philosophizing-with-ai/src/pages/tags/[tag].astro", void 0);

const $$file = "/home/yusuke-hosokawa/my-projects/philosophizing-with-ai/src/pages/tags/[tag].astro";
const $$url = "/tags/[tag]";

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  default: $$tag,
  file: $$file,
  url: $$url
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
