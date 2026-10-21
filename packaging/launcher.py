"""Startskript für das gebündelte Programm (PyInstaller)."""

import sys

from zotllm.desktop import entry

if __name__ == "__main__":
    sys.exit(entry())
