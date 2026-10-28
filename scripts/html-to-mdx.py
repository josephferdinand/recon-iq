#!/usr/bin/env python3
"""Convert FVI support-docs-site HTML pages to Docusaurus MDX.

Extracts the <article> content from each HTML file and converts it to MDX
with YAML frontmatter, suitable for the new docs-docusaurus site.
"""

import os
import re
import sys
import yaml
from html.parser import HTMLParser
from pathlib import Path

FVI = Path("./LOCAL_USER/OneDrive - 8gsp1y/Documents/ChatGPT/ReconIQ")
SRC = FVI / "support-docs-site"
DST = FVI / "docs-docusaurus" / "docs"

# Frontmatter template (title + description + sidebar_position)
def frontmatter(title: str, description: str, position: int) -> str:
    safe_title = title.replace('"', '\\"')
    safe_desc = description.replace('"', '\\"')
    return (
        f'---\n'
        f'title: "{safe_title}"\n'
        f'description: "{safe_desc}"\n'
        f'sidebar_position: {position}\n'
        f'---\n\n'
    )


class ArticleExtractor(HTMLParser):
    """Extract content from inside <article>...</article>."""

    def __init__(self):
        super().__init__()
        self.depth_article = 0
        self.depth_main = 0
        self.in_article = False
        self.depth = 0
        self.depth_skip = 0  # skip inside <nav>, <footer>, <header>, <aside>, <form>
        self.skip_tags = {'nav', 'footer', 'header', 'aside', 'form', 'script', 'style'}
        self.skip_stack = []
        self.parts = []
        self.text_buffer = []
        # Stack to manage inline tag depth
        self.tag_stack = []
        self.skip_now = False

    def handle_starttag(self, tag, attrs):
        attrs_d = dict(attrs)
        # Enter article
        if tag == 'article':
            self.depth_article += 1
            self.in_article = True
            return
        if not self.in_article:
            return
        if tag in self.skip_tags or self.depth_skip > 0:
            self.depth_skip += 1
            return
        if tag == 'h1':
            self._flush_text()
            self.parts.append(('# ', 'h1'))
            self.tag_stack.append('h1')
            return
        if tag == 'h2':
            self._flush_text()
            self.parts.append(('\n## ', 'h2'))
            self.tag_stack.append('h2')
            return
        if tag == 'h3':
            self._flush_text()
            self.parts.append(('\n### ', 'h3'))
            self.tag_stack.append('h3')
            return
        if tag == 'h4':
            self._flush_text()
            self.parts.append(('\n#### ', 'h4'))
            self.tag_stack.append('h4')
            return
        if tag == 'p':
            self._flush_text()
            self.parts.append(('\n\n', 'p'))
            self.tag_stack.append('p')
            return
        if tag == 'br':
            self.text_buffer.append('  \n')
            return
        if tag == 'strong' or tag == 'b':
            self.text_buffer.append('**')
            self.tag_stack.append('strong')
            return
        if tag == 'em' or tag == 'i':
            self.text_buffer.append('*')
            self.tag_stack.append('em')
            return
        if tag == 'code' and not self._inside_pre():
            self.text_buffer.append('`')
            self.tag_stack.append('inline-code')
            return
        if tag == 'a':
            href = attrs_d.get('href', '')
            self.text_buffer.append('[')
            self.tag_stack.append(('a', href))
            return
        if tag == 'pre':
            self._flush_text()
            cls = attrs_d.get('class', '')
            lang = ''
            if 'mermaid' in cls:
                lang = 'mermaid'
            elif 'language-' in cls:
                lang = cls.split('language-', 1)[1].split()[0]
            elif cls:
                lang = cls.split()[0]
            self.parts.append((f'\n```{lang}\n', 'pre-start'))
            self.tag_stack.append('pre')
            self.in_pre = True
            self.pre_lang = lang
            return
        if tag == 'ul':
            self._flush_text()
            self.parts.append(('\n', 'ul'))
            self.tag_stack.append('ul')
            return
        if tag == 'ol':
            self._flush_text()
            self.parts.append(('\n', 'ol'))
            self.tag_stack.append('ol')
            return
        if tag == 'li':
            self._flush_text()
            self.parts.append(('\n- ', 'li'))
            self.tag_stack.append('li')
            return
        if tag == 'table':
            self._flush_text()
            self.parts.append(('\n<table>', 'table-start'))
            self.tag_stack.append('table')
            return
        if tag == 'thead':
            self.tag_stack.append('thead')
            return
        if tag == 'tbody':
            self.tag_stack.append('tbody')
            return
        if tag == 'tr':
            self._flush_text()
            self.parts.append(('\n<tr>', 'tr'))
            self.tag_stack.append('tr')
            return
        if tag == 'th':
            self.parts.append(('<th>', 'th'))
            self.tag_stack.append('th')
            return
        if tag == 'td':
            self.parts.append(('<td>', 'td'))
            self.tag_stack.append('td')
            return
        if tag == 'blockquote':
            self._flush_text()
            self.parts.append(('\n> ', 'blockquote'))
            self.tag_stack.append('blockquote')
            return
        if tag == 'hr':
            self._flush_text()
            self.parts.append(('\n\n---\n', 'hr'))
            return
        if tag == 'img':
            src = attrs_d.get('src', '')
            alt = attrs_d.get('alt', '')
            self._flush_text()
            self.parts.append((f'\n![{alt}]({src})\n', 'img'))
            return
        # Other tags: pass through (start tag), or ignore
        self.tag_stack.append(tag)

    def handle_endtag(self, tag):
        if tag == 'article':
            if self.depth_article > 0:
                self.depth_article -= 1
            if self.depth_article == 0:
                self.in_article = False
            return
        if not self.in_article:
            return
        if self.depth_skip > 0:
            self.depth_skip -= 1
            return
        if tag in ('h1', 'h2', 'h3', 'h4'):
            self._flush_text()
            self.parts.append(('\n', tag + '-end'))
            self._pop_tag(tag)
            return
        if tag == 'p':
            self._flush_text()
            self.parts.append(('\n', 'p-end'))
            self._pop_tag('p')
            return
        if tag in ('strong', 'b'):
            self.text_buffer.append('**')
            self._pop_tag('strong')
            return
        if tag in ('em', 'i'):
            self.text_buffer.append('*')
            self._pop_tag('em')
            return
        if tag == 'code':
            # Only close inline code (not the one inside pre)
            if self.tag_stack and self.tag_stack[-1] == 'inline-code':
                self.text_buffer.append('`')
                self.tag_stack.pop()
            return
        if tag == 'a':
            href = ''
            if self.tag_stack and isinstance(self.tag_stack[-1], tuple) and self.tag_stack[-1][0] == 'a':
                href = self.tag_stack[-1][1]
                self.tag_stack.pop()
            self.text_buffer.append(f']({href})')
            return
        if tag == 'pre':
            self._flush_text()
            self.parts.append(('\n```\n', 'pre-end'))
            self._pop_tag('pre')
            return
        if tag in ('ul', 'ol', 'li', 'blockquote'):
            self._flush_text()
            self.parts.append(('\n', tag + '-end'))
            self._pop_tag(tag)
            return
        if tag == 'table':
            self._flush_text()
            self.parts.append(('\n</table>\n', 'table-end'))
            self._pop_tag('table')
            return
        if tag == 'thead':
            self._pop_tag('thead')
            return
        if tag == 'tbody':
            self._pop_tag('tbody')
            return
        if tag == 'tr':
            self._flush_text()
            self.parts.append(('</tr>', 'tr-end'))
            self._pop_tag('tr')
            return
        if tag == 'th':
            self.parts.append(('</th>', 'th-end'))
            self._pop_tag('th')
            return
        if tag == 'td':
            self.parts.append(('</td>', 'td-end'))
            self._pop_tag('td')
            return
        # Pop generic tag
        if self.tag_stack and self.tag_stack[-1] == tag:
            self.tag_stack.pop()

    def handle_data(self, data):
        if not self.in_article:
            return
        if self.depth_skip > 0:
            return
        # Collapse whitespace inside <pre>
        if self.tag_stack and self.tag_stack[-1] == 'pre':
            self.text_buffer.append(data)
            return
        self.text_buffer.append(data)

    def _flush_text(self):
        if self.text_buffer:
            text = ''.join(self.text_buffer)
            self.text_buffer = []
            # Collapse whitespace but preserve code-internal whitespace
            text = re.sub(r'[ \t]+', ' ', text)
            text = re.sub(r'\n{3,}', '\n\n', text)
            if text:
                self.parts.append((text, 'text'))

    def _inside_pre(self):
        return self.tag_stack and self.tag_stack[-1] == 'pre'

    def _pop_tag(self, tag):
        if self.tag_stack and self.tag_stack[-1] == tag:
            self.tag_stack.pop()

    def get_md(self) -> str:
        self._flush_text()
        out = []
        for part, kind in self.parts:
            out.append(part)
        text = ''.join(out)
        # Final cleanup
        text = re.sub(r'\n{3,}', '\n\n', text)
        return text.strip() + '\n'


def extract_title_and_desc(html: str) -> tuple[str, str]:
    """Extract <title> and <meta name='description'> from the HTML head."""
    title = ''
    desc = ''
    m = re.search(r'<title>(.*?)</title>', html, re.DOTALL)
    if m:
        title = m.group(1).strip()
        # Strip the " · ReconIQ" suffix
        title = re.sub(r'\s*[·•|]\s*ReconIQ.*$', '', title).strip()
    m = re.search(r'<meta\s+name=["\']description["\']\s+content=["\']([^"\']*)["\']', html)
    if not m:
        m = re.search(r'<meta\s+content=["\']([^"\']*)["\']\s+name=["\']description["\']', html)
    if m:
        desc = m.group(1).strip()
    return title, desc


def extract_article(html: str) -> str:
    """Extract content inside the <article>...</article> tag."""
    m = re.search(r'<article[^>]*>(.*?)</article>', html, re.DOTALL)
    if not m:
        return ''
    article_html = m.group(1)
    parser = ArticleExtractor()
    parser.in_article = True  # Already stripped the wrapping article tag
    parser.feed(article_html)
    return parser.get_md()


def convert_one(src_path: Path, dst_root: Path) -> bool:
    """Convert one HTML file to MDX. Returns True on success."""
    html = src_path.read_text(encoding='utf-8')
    title, desc = extract_title_and_desc(html)
    if not title:
        title = src_path.stem.replace('-', ' ').title()
    md = extract_article(html)
    if not md.strip():
        return False

    # Build destination path
    rel = src_path.relative_to(SRC)
    # rel is like 'dist/getting-started/quickstart.html' or 'dist/api/authentication.html'
    parts = rel.parts
    if parts[0] == 'dist':
        parts = parts[1:]
    # Drop the .html extension
    parts = list(parts[:-1]) + [parts[-1][:-5] + '.md']
    dst_path = dst_root.joinpath(*parts)

    # Compute sidebar_position: numeric order within the section
    section = parts[0] if parts else ''
    # Use alphabetical position
    section_dir = src_path.parent
    existing = sorted(p.stem for p in section_dir.glob('*.html'))
    try:
        position = existing.index(src_path.stem) + 1
    except ValueError:
        position = 0

    dst_path.parent.mkdir(parents=True, exist_ok=True)
    fm = frontmatter(title, desc, position)
    dst_path.write_text(fm + md, encoding='utf-8')
    return True


def main():
    if not SRC.exists():
        print(f"ERROR: source not found: {SRC}", file=sys.stderr)
        sys.exit(1)

    DST.mkdir(parents=True, exist_ok=True)

    # Find all HTML files in dist (excluding index/search/404)
    html_files = sorted(SRC.glob('dist/**/*.html'))
    html_files = [p for p in html_files if p.name not in ('index.html', 'search.html', '404.html', 'README.html')]

    converted = 0
    skipped = 0
    for p in html_files:
        try:
            if convert_one(p, DST):
                converted += 1
                print(f"  + {p.relative_to(SRC)}")
            else:
                skipped += 1
                print(f"  - {p.relative_to(SRC)} (no article content)")
        except Exception as e:
            skipped += 1
            print(f"  ! {p.relative_to(SRC)}: {e}")

    print(f"\nConverted: {converted}, Skipped: {skipped}, Total: {len(html_files)}")


if __name__ == '__main__':
    main()
