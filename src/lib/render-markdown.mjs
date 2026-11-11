// Renders Markdown to HTML with the exact same pipeline Astro uses for
// content collections (remark/rehype + heading ids + shiki defaults), so
// CMS-authored bodies look identical to file-authored ones.
import { createMarkdownProcessor, markdownConfigDefaults } from '@astrojs/markdown-remark';

let processorPromise = null;

async function getProcessor() {
  processorPromise ??= createMarkdownProcessor({ ...markdownConfigDefaults });
  return processorPromise;
}

export async function renderMarkdown(body) {
  const processor = await getProcessor();
  const { code } = await processor.render(String(body ?? ''));
  return code;
}
