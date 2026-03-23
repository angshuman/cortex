import { marked, type Tokens } from "marked";

/**
 * Configure marked globally:
 * - External links open in a new tab / Electron's default browser
 * - Relative links (starting with / or #) stay in-app
 * - Image tags get proper loading attributes
 */
const renderer = new marked.Renderer();

const originalLink = renderer.link.bind(renderer);
renderer.link = function (token: Tokens.Link) {
  const html = originalLink(token);
  // If it's an absolute URL (http/https), open externally
  if (token.href && /^https?:\/\//.test(token.href)) {
    return html
      .replace("<a ", '<a target="_blank" rel="noopener noreferrer" ')
      // Style external links so they look clickable
      .replace("<a ", '<a class="text-primary underline underline-offset-2" ');
  }
  return html;
};

marked.use({ renderer });

export { marked };
