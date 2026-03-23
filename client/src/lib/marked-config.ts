import { marked, type Tokens } from "marked";

/**
 * Configure marked globally:
 * - External links (http/https) open in a new tab with styling
 * - Relative links stay in-app
 */
marked.use({
  renderer: {
    link({ href, title, tokens }: Tokens.Link) {
      // Render inner text from tokens
      const text = this.parser.parseInline(tokens);
      const titleAttr = title ? ` title="${title}"` : "";

      if (href && /^https?:\/\//.test(href)) {
        // External link — open in new tab with accent styling
        return `<a href="${href}"${titleAttr} target="_blank" rel="noopener noreferrer" class="text-primary underline underline-offset-2">${text}</a>`;
      }
      // Internal / relative link
      return `<a href="${href}"${titleAttr}>${text}</a>`;
    },
  },
});

export { marked };
