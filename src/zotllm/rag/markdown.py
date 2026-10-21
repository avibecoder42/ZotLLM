"""Minimaler Markdown→HTML-Wandler für Zotero-Notizen (Überschriften, Absätze, Listen, Hervorhebung, Links)."""

from __future__ import annotations

import html
import re

_LINK = re.compile(r"\[([^\]]+)\]\(([^)\s]+)\)")
_BOLD = re.compile(r"\*\*(.+?)\*\*")
_ITAL = re.compile(r"(?<![*\w])\*(?!\s)(.+?)(?<!\s)\*(?![*\w])")
_SAFE_SCHEMES = ("http://", "https://", "zotero://")


def _inline(text: str) -> str:
    text = html.escape(text, quote=False)

    def link(m: re.Match) -> str:
        url = html.unescape(m.group(2))
        if not url.startswith(_SAFE_SCHEMES):
            return m.group(1)
        return f'<a href="{html.escape(url)}">{m.group(1)}</a>'

    text = _LINK.sub(link, text)
    text = _BOLD.sub(r"<strong>\1</strong>", text)
    text = _ITAL.sub(r"<em>\1</em>", text)
    return text


def md_to_html(md: str) -> str:
    out: list[str] = []
    para: list[str] = []
    list_type: str | None = None

    def flush_para():
        nonlocal para
        if para:
            out.append("<p>" + _inline(" ".join(para)) + "</p>")
            para = []

    def close_list():
        nonlocal list_type
        if list_type:
            out.append(f"</{list_type}>")
            list_type = None

    for raw in md.splitlines():
        line = raw.rstrip()
        if not line.strip():
            flush_para()
            close_list()
            continue
        m = re.match(r"^(#{1,6})\s+(.*)$", line)
        if m:
            flush_para()
            close_list()
            level = min(len(m.group(1)), 6)
            out.append(f"<h{level}>{_inline(m.group(2))}</h{level}>")
            continue
        m = re.match(r"^\s*([-*+]|\d+[.)])\s+(.*)$", line)
        if m:
            flush_para()
            kind = "ol" if m.group(1)[0].isdigit() else "ul"
            if list_type != kind:
                close_list()
                out.append(f"<{kind}>")
                list_type = kind
            out.append(f"<li>{_inline(m.group(2))}</li>")
            continue
        if line.startswith(">"):
            flush_para()
            close_list()
            out.append(f"<blockquote><p>{_inline(line.lstrip('> '))}</p></blockquote>")
            continue
        close_list()
        para.append(line.strip())
    flush_para()
    close_list()
    return "\n".join(out)
