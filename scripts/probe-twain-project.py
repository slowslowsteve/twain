#!/usr/bin/env python3
"""Read Move project metadata over SSH, without installing or writing on Move.

The disk snapshot is evidence for manual tests, NOT permission to save audio:
it cannot prove that the running document has caught up with disk metadata.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

UUID = re.compile(r'^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$')


def read_index(root):
    data = json.loads((root / 'data/UserData/settings/Settings.json').read_text())
    index = data.get('currentSongIndex')
    if type(index) is not int or index < 0:
        raise ValueError('currentSongIndex is unavailable or invalid')
    return index


def snapshot(root=Path('/')):
    base = root / 'data/UserData'
    def marker():
        try:
            return (base / 'schwung/active_set.txt').read_text().splitlines()
        except OSError:
            return []
    started = time.time()
    index = read_index(root)
    active = marker()
    projects = []
    for folder in sorted((base / 'UserLibrary/Sets').iterdir()):
        if not UUID.fullmatch(folder.name) or folder.is_symlink() or not folder.is_dir():
            continue
        try:
            position = int(os.getxattr(folder, 'user.song-index').decode().strip('\x00 \n'))
        except (OSError, ValueError):
            position = None
        songs = []
        for child in sorted(folder.iterdir()):
            song = child / 'Song.abl'
            if child.is_symlink() or song.is_symlink() or not song.is_file():
                continue
            content = song.read_bytes()
            songs.append({'name': child.name, 'bytes': len(content),
                          'sha256': hashlib.sha256(content).hexdigest()})
        origin = base / 'schwung/set_state' / folder.name / 'copy_source.txt'
        try:
            source = origin.read_text().strip()
        except OSError:
            source = ''
        projects.append({'id': folder.name.lower(), 'position': position,
                         'songs': songs, 'copy_source': source if UUID.fullmatch(source) else None})
    stable = index == read_index(root) and active == marker()
    matches = [p['id'] for p in projects if p['position'] == index]
    published = active[0].strip().lower() if active else None
    return {'captured_at': started, 'current_index': index,
            'native_matches': matches, 'published_id': published,
            'published_name': active[1] if len(active) > 1 else None,
            'disk_sources_agree': stable and len(matches) == 1 and matches[0] == published,
            'live_document_alignment': 'not observed by this disk-only probe',
            'projects': projects}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host', default='ableton@move.local')
    parser.add_argument('--output', type=Path, help='write snapshot locally, never on Move')
    parser.add_argument('--device', action='store_true', help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.device:
        try:
            print(json.dumps(snapshot(), sort_keys=True))
        except (OSError, ValueError) as error:
            print(json.dumps({'error': str(error)}))
            return 1
        return 0
    if not re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_.@:-]*', args.host):
        parser.error('invalid SSH host')
    source = Path(__file__).read_text()
    result = subprocess.run(['ssh', '-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5',
                             args.host, 'python3 -B - --device'], input=source,
                            text=True, capture_output=True, timeout=30)
    if result.returncode:
        print(result.stderr or result.stdout, file=sys.stderr)
        return result.returncode
    data = json.loads(result.stdout)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(data, indent=2) + '\n')
    print(json.dumps(data, indent=2))
    return 0


if __name__ == '__main__':
    sys.exit(main())
