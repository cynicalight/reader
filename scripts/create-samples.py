"""Original, tiny EPUB3 and PDF fixtures. No external copyrighted content."""
from pathlib import Path
from zipfile import ZipFile, ZIP_STORED, ZIP_DEFLATED
out=Path('apps/web/public/samples');out.mkdir(parents=True,exist_ok=True)
chapters=[('从问题开始','阅读的结构',[
'阅读之前，先写下你希望理解的问题。问题不必复杂，它可以是一个概念、一种方法，或者一个结论成立的条件。明确问题，可以帮助你选择阅读的顺序。',
'对于一本书，目录提供了作者安排内容的方式。先看章标题，再看章节之间的关系。不要把目录当作内容本身。标题能告诉你主题，却不能替代论证。',
'对于一篇论文，可以先读摘要、引言与结论。记录作者声称解决的问题，再到方法和实验中核对证据。阅读顺序可以改变，但对证据的要求应当保持一致。',
'第一次阅读不需要理解每一个细节。把暂时不明白的术语标记下来，同时记录它出现的位置。第二次阅读时，带着更具体的问题返回原文。',
'一个有用的问题包含对象和条件。例如：这个算法在什么输入规模下有效？实验结果是否依赖特定的数据分布？这些条件常常比结论本身更值得记录。',
'读到这里，可以选中一段文字，添加高亮或笔记。也可以把两段原文引用到 AI 对话中，比较它们的含义。AI 的回答需要回到原文核对。']),('区分主张与证据','理解作者的论证',[
'作者提出了什么主张？为这个主张提供了什么证据？从证据到结论，中间还需要哪些假设？把这三个问题分开，能让阅读记录更清楚。',
'实验中的相关性不自动意味着因果关系。观察到两个变量同时变化时，还需要考虑共同原因、样本选择和测量方式。论文的讨论部分通常会说明部分限制。',
'阅读公式时，先给每一个符号写下含义。然后确认输入、输出和单位。尝试一个简单的数值例子，检查公式在边界情况下的行为。',
'对于代码或算法，不必同时追踪所有分支。选择一组具体输入，沿真实执行顺序观察状态的变化。理解一条路径之后，再检查例外情况。',
'记录笔记时，分清原文摘录、自己的理解和仍待验证的推测。原文摘录保留位置，自己的理解用自己的语言表达，推测则写出下一步需要的证据。']),('让笔记可以复用','完成一次阅读',[
'读完一章后，暂时离开原文，尝试回答开始时的问题。如果无法回答，先找出缺少的信息，而不是简单地把整章再读一遍。',
'一条可复用的笔记至少说明主题、理由和适用条件。笔记的长度并不重要。重要的是，几周之后重新看到它时，你仍然知道它回答了什么问题。',
'保留原文位置能够降低核对成本。PDF 的页码与 EPUB 的章节位置不同。调整电子书的字号会改变排版，因此阅读位置应当独立于屏幕上显示的页数。',
'最后，把本次阅读没有解决的问题单独列出。它们可以成为下一次阅读的起点。保存进度、整理少量关键笔记，然后结束这一轮阅读。'])]
with ZipFile(out/'the-art-of-reading.epub','w',ZIP_DEFLATED) as z:
 z.writestr('mimetype','application/epub+zip',compress_type=ZIP_STORED)
 z.writestr('META-INF/container.xml','<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
 items=''.join(f'<item id="c{i}" href="chapter{i}.xhtml" media-type="application/xhtml+xml"/>' for i in range(1,4))
 spine=''.join(f'<itemref idref="c{i}"/>' for i in range(1,4))
 z.writestr('EPUB/package.opf',f'''<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:reader:sample:reading</dc:identifier><dc:title>阅读的结构</dc:title><dc:creator>Reader · 原创示例</dc:creator><dc:language>zh-CN</dc:language><meta property="dcterms:modified">2026-10-02T00:00:00Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>{items}</manifest><spine>{spine}</spine></package>''')
 nav=''.join(f'<li><a href="chapter{i}.xhtml">{i:02d} · {title}</a></li>' for i,(title,_,_) in enumerate(chapters,1))
 z.writestr('EPUB/nav.xhtml',f'<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>目录</title></head><body><nav epub:type="toc"><h1>目录</h1><ol>{nav}</ol></nav></body></html>')
 for i,(title,subtitle,paras) in enumerate(chapters,1):
  body=''.join(f'<p>{p}</p>' for p in paras)
  z.writestr(f'EPUB/chapter{i}.xhtml',f'''<html xmlns="http://www.w3.org/1999/xhtml" lang="zh-CN"><head><title>{title}</title><style>body{{font-family:serif;line-height:1.9;padding:2em;max-width:38em;margin:auto}}h1{{font-size:1.8em;font-weight:500;margin:1em 0}}p{{margin:1.2em 0}}.chapter{{font-family:sans-serif;font-size:.7em;letter-spacing:.15em;color:#888}}h2{{font-size:1em;font-weight:400;color:#777;margin-bottom:2em}}</style></head><body><div class="chapter">THE ART OF READING / CHAPTER {i:02d}</div><h1>{title}</h1><h2>{subtitle}</h2>{body}</body></html>''')
# Minimal PDF with a real outline, two text-selectable pages and standard fonts.
objects=[]
def add(s):objects.append(s.encode('ascii') if isinstance(s,str) else s);return len(objects)
add('<< /Type /Catalog /Pages 2 0 R /Outlines 8 0 R >>');add('<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>')
for page,title,lines in [(1,'Reading with a question',['A short sample paper for Reader','1. Start with a question','Before reading, describe the question you want to answer.','Use the outline to inspect the structure of the argument.','Select a sentence to save a highlight or ask for an explanation.','','A claim is not the same as evidence.','Record the assumptions that connect evidence to conclusions.','Return to the original text when an interpretation is uncertain.']), (2,'Evidence and interpretation',['2. Keep useful notes','Separate quotations, interpretations, and open questions.','Preserve the source location so each note can be checked.','A bookmark records where you want to return.','','This sample contains selectable text and a PDF outline.','It is original test content, not a published research paper.'])]:
 pnum=3 if page==1 else 5;cnum=pnum+1
 add(f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 7 0 R >> >> /Contents {cnum} 0 R >>')
 content='BT /F1 23 Tf 60 755 Td ('+title+') Tj /F1 11 Tf 0 -42 Td '
 for line in lines:content+='('+line+') Tj 0 -27 Td '
 content+=f'0 -65 Td (Reader / Sample document / {page}) Tj ET'
 add(f'<< /Length {len(content)} >>\nstream\n{content}\nendstream')
add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');add('<< /Type /Outlines /First 9 0 R /Last 10 0 R /Count 2 >>');add('<< /Title (1. Start with a question) /Parent 8 0 R /Next 10 0 R /Dest [3 0 R /Fit] >>');add('<< /Title (2. Keep useful notes) /Parent 8 0 R /Prev 9 0 R /Dest [5 0 R /Fit] >>')
pdf=b'%PDF-1.4\n';offsets=[0]
for i,obj in enumerate(objects,1):offsets.append(len(pdf));pdf+=f'{i} 0 obj\n'.encode()+obj+b'\nendobj\n'
xref=len(pdf);pdf+=f'xref\n0 {len(objects)+1}\n0000000000 65535 f \n'.encode()+b''.join(f'{o:010} 00000 n \n'.encode() for o in offsets[1:]);pdf+=f'trailer\n<< /Size {len(objects)+1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF'.encode();(out/'reading-notes.pdf').write_bytes(pdf)
