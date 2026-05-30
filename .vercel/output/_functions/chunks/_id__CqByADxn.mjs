import { c as createComponent } from './astro-component_C0jAHtL0.mjs';
import 'piccolore';
import { l as renderComponent, n as renderHead, h as addAttribute, r as renderTemplate, u as unescapeHTML } from './entrypoint_BPeRZUBX.mjs';
import { g as getPosts, a as getPostPage } from './notion_CcLiOKsl.mjs';
import { marked } from 'marked';
import { $ as $$BaseHead, a as $$Header, b as $$Footer } from './Header_Dm2yJMCF.mjs';

async function getStaticPaths() {
  const posts = await getPosts();
  return posts.map((post) => ({
    params: { id: post.id },
    props: { post }
  }));
}
const $$id = createComponent(async ($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$props, $$slots);
  Astro2.self = $$id;
  const { id } = Astro2.params;
  const { post } = Astro2.props;
  const pageData = await getPostPage(id);
  const contentRichText = pageData?.properties?.Content?.rich_text || [];
  const markdownContent = contentRichText.map((t) => t.plain_text).join("") || "本文がありません。";
  const htmlContent = marked(markdownContent);
  const title = post?.title || pageData?.data?.title || "無題";
  const tags = post?.tags || pageData?.data?.tags || [];
  const heroImage = post?.heroImage || pageData?.data?.heroImage;
  return renderTemplate`<html lang="ja"> <head>${renderComponent($$result, "BaseHead", $$BaseHead, { "title": title, "description": "" })}${renderHead()}</head> <body> ${renderComponent($$result, "Header", $$Header, {})} <main> <article> <h1 style="margin-bottom: 0.5rem;">${title}</h1>  ${heroImage && renderTemplate`<img${addAttribute(heroImage, "src")}${addAttribute(title, "alt")} class="hero-image">`}  ${tags.length > 0 && renderTemplate`<div class="tags-container"> ${tags.map((tag) => renderTemplate`<a${addAttribute(`/tags/${tag}`, "href")} class="tag-badge">#${tag}</a>`)} </div>`} <hr> <div class="notion-content">${unescapeHTML(htmlContent)}</div> </article> </main> ${renderComponent($$result, "Footer", $$Footer, {})} </body></html>`;
}, "/home/yusuke-hosokawa/my-projects/philosophizing-with-ai/src/pages/posts/[id].astro", void 0);

const $$file = "/home/yusuke-hosokawa/my-projects/philosophizing-with-ai/src/pages/posts/[id].astro";
const $$url = "/posts/[id]";

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
      __proto__: null,
      default: $$id,
      file: $$file,
      getStaticPaths,
      url: $$url
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
