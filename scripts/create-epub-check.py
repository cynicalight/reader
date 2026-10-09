"""Generate an original EPUB for manual annotation checks; uses only stdlib."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_STORED, ZIP_DEFLATED
import sys

output = Path(sys.argv[1] if len(sys.argv) > 1 else ".reader/epub-check.epub")
output.parent.mkdir(parents=True, exist_ok=True)
chapters = [
    ("重复文字与跨节点选择", '''
<h1>重复文字与跨节点选择</h1>
<p>请给第二处重复句子添加笔记，然后改变字号、切换章节、关闭并重新打开，再从笔记跳回。</p>
<h2>第一处</h2><p>这是一段需要准确定位的重复文字。</p>
<p>中间内容用于区分两个位置。</p>
<h2>第二处</h2><p>这是一段需要准确定位的重复文字。</p>
<p>可以从<strong>粗体中文</strong>一直选择到<a href="chapter2.xhtml">下一章链接</a>之后，也可以跨越两个段落。</p>
<p>字符测试：中文、emoji 😀、组合字符 é，以及<ruby>阅读<rt>yuè dú</rt></ruby>。</p>
<p>搜索 Reader 应当得到不同的命中位置：Reader reader READER。</p>
<p>脚注入口<a href="#note" epub:type="noteref">[1]</a>。</p>
<aside id="note" epub:type="footnote"><p>这是同一章节中的脚注内容。</p></aside>
'''),
    ("长段落与分页", '<h1>长段落与分页</h1><p>在本段靠后的部分划词保存，检查返回时是否落在对应页。</p><p>' +
     "同一段落中的重复句子，用于验证字符位置。 " * 180 + '</p>'),
    ("重开与删除", '''<h1>重开与删除</h1>
<p>给这一句添加下划线和笔记。返回第一章，再重新打开本书，检查批注是否仍在。</p>
<p>点击已有批注可以编辑笔记、引用到 AI 或删除；AI 操作需要自行配置提供方。</p>
<p>删除记录后，切换章节再返回，正文中不应重新出现这条批注。</p>'''),
]
with ZipFile(output, "w") as archive:
    def write(name, content, compression=ZIP_DEFLATED):
        info = ZipInfo(name, (2026, 10, 5, 0, 0, 0))
        info.compress_type = compression
        archive.writestr(info, content.encode("utf-8"))

    write("mimetype", "application/epub+zip", ZIP_STORED)
    write("META-INF/container.xml", '''<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>''')
    items = ''.join(f'<item id="c{i}" href="chapter{i}.xhtml" media-type="application/xhtml+xml"/>' for i in range(1, 4))
    spine = ''.join(f'<itemref idref="c{i}"/>' for i in range(1, 4))
    write("EPUB/package.opf", f'''<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">reader-epub-annotation-check</dc:identifier><dc:title>EPUB 批注验收样本</dc:title><dc:creator>Reader</dc:creator><dc:language>zh-CN</dc:language><meta property="dcterms:modified">2026-10-05T00:00:00Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>{items}</manifest><spine>{spine}</spine></package>''')
    links = ''.join(f'<li><a href="chapter{i}.xhtml">{title}</a></li>' for i, (title, _) in enumerate(chapters, 1))
    write("EPUB/nav.xhtml", f'''<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>目录</title></head><body><nav epub:type="toc"><ol>{links}</ol></nav></body></html>''')
    for i, (title, body) in enumerate(chapters, 1):
        write(f"EPUB/chapter{i}.xhtml", f'''<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="zh-CN"><head><title>{title}</title><style>body{{font-family:serif;line-height:1.8}}p{{margin:1em 0}}</style></head><body>{body}</body></html>''')
print(output)
