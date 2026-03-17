export interface RssArticle {
  readonly title: string;
  readonly link: string;
  readonly pubDate: string;
  readonly description: string;
}

function extractTag(xml: string, tag: string): string {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const match = xml.match(regex);
  return match ? match[1].trim() : '';
}

/**
 * Parses an RSS 2.0 XML feed string into an array of articles.
 * Lightweight implementation — no external XML parser dependency.
 */
export function parseRssFeed(xml: string): RssArticle[] {
  // Basic validity check
  if (!xml.includes('<rss') && !xml.includes('<channel')) {
    throw new Error('Invalid RSS feed: missing <rss> or <channel> element');
  }

  const items: RssArticle[] = [];
  const itemRegex = /<item[\s>]([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;

  while ((match = itemRegex.exec(xml)) !== null) {
    const itemXml = match[1];
    items.push({
      title: extractTag(itemXml, 'title'),
      link: extractTag(itemXml, 'link'),
      pubDate: extractTag(itemXml, 'pubDate'),
      description: extractTag(itemXml, 'description'),
    });
  }

  return items;
}
