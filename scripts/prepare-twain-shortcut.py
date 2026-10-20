#!/usr/bin/env python3
"""Prepare an offline Schwung UI patch. Does not connect to or modify Move."""
import argparse
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('source', type=Path, help='copy of installed shadow_ui.js')
parser.add_argument('output', type=Path, help='new local patched file')
args = parser.parse_args()
if args.source.resolve() == args.output.resolve():
    parser.error('output must differ from source')
source = args.source.read_text()
needle = '    if (!isDoubleTap && !shimHint) return false;'
replacement = '''    /* Twain: a single Tools shortcut returns to the parked performance. */
    const directTwain = lastSuspendedToolId === "twain" && suspendedOvertakes["twain"];
    if (!isDoubleTap && !shimHint && !directTwain) return false;'''
if source.count(needle) != 1:
    parser.error('unsupported host source: expected exactly one resume guard; no output written')
args.output.write_text(source.replace(needle, replacement))
print(f'Prepared {args.output}; nothing installed on Move.')
