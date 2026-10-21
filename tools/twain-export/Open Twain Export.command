#!/bin/zsh
cd -- "${0:A:h}" || exit 1
printf 'Twain Export — keep this window open while exporting.\n'
/usr/bin/python3 -B server.py --open
