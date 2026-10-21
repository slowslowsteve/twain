#!/usr/bin/env python3
"""Local-only Twain export page. No remote writes to audio, projects or modules."""
import argparse
import http.cookiejar
import http.server
import json
import math
import mmap
import os
from pathlib import Path
import re
import secrets
import shutil
import struct
import subprocess
import tempfile
import threading
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
import zipfile
import zlib

HERE = Path(__file__).resolve().parent
UUID = re.compile(r'^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$')
SR = 44100
MAX_PROJECT = 340_000_000
DEFAULTS = [50, 0, 0, 0, 0, 0, 0, 0, 5, 0, 0, 0, 35, 50, 28, 35, 50, 0, 0]


def safe_name(value):
    return re.sub(r'[^\w .()-]', '_', value, flags=re.UNICODE).strip(' .')[:80] or 'Twain project'


def inspect_twain(path):
    """Validate the complete saved snapshot before emitting any audio."""
    size = path.stat().st_size
    if not 184 <= size <= MAX_PROJECT:
        raise ValueError('Twain save has an invalid size.')
    crc = 0
    with path.open('rb') as f:
        remaining = size - 4
        while remaining:
            data = f.read(min(remaining, 1024*1024))
            if not data:
                raise ValueError('Incomplete Twain save.')
            crc = zlib.crc32(data, crc)
            remaining -= len(data)
        if struct.unpack('<I', f.read(4))[0] != crc:
            raise ValueError('Twain save checksum failed. Save Twain again before exporting.')
    with path.open('rb') as f, mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ) as data:
        if data[:8] != b'TWAIN01\n':
            raise ValueError('Not a Twain save.')
        version, rate, scenes, layers, active, master, mute = struct.unpack_from('<7I', data, 8)
        if version not in (1, 2) or rate != SR or scenes != 4 or layers not in (4, 8) or active > 3 or master > 200 or mute > 1:
            raise ValueError('Unsupported Twain save.')
        bars = list(struct.unpack_from('<4I', data, 36))
        name_bytes = data[52:180]
        if b'\0' not in name_bytes:
            raise ValueError('Invalid project name.')
        name = name_bytes.split(b'\0')[0].decode('utf-8', errors='replace')
        starts = [0]*4
        input_level = monitor_level = 100
        offset = 180
        if version == 2:
            starts = list(struct.unpack_from('<4I', data, 180))
            input_level, monitor_level = struct.unpack_from('<2I', data, 196)
            offset = 204
        if input_level > 400 or monitor_level > 200 or any(not 1 <= end <= 16 or not 0 <= start < end for start, end in zip(starts, bars)):
            raise ValueError('Invalid scene range or input setting.')
        clips = []
        for scene in range(4):
            for layer in range(layers):
                settings_count = 19 if version == 2 else 10
                header_size = 16 + settings_count*4
                if offset + header_size > size-4:
                    raise ValueError('Incomplete clip header.')
                length, full, grid = struct.unpack_from('<IId', data, offset)
                settings = DEFAULTS.copy()
                settings[:settings_count] = struct.unpack_from('<%dI' % settings_count, data, offset+16)
                for i, value in enumerate(settings):
                    maximum = 200 if i == 0 else 11 if i == 8 else 1 if i == 9 else 15 if i == 18 else 100
                    if value > maximum:
                        raise ValueError('Invalid clip setting.')
                offset += header_size
                if length > full or full > SR*60 or not math.isfinite(grid) or not 0 <= grid <= SR*60 or offset + full*4 > size-4:
                    raise ValueError('Invalid clip length or timing.')
                if length:
                    clips.append(dict(scene=scene, layer=layer, length=length, full=full,
                                      grid=grid, offset=offset, settings=settings))
                offset += full*4
        if offset != size-4:
            raise ValueError('Unexpected data after Twain clips.')
    return dict(version=version, name=name, bars=bars, starts=starts, clips=clips,
                input_gain=input_level, monitor_level=monitor_level,
                master_level=master, master_muted=bool(mute))


def inspect_bundle(path):
    """Read without extracting the native Set; keep its original bytes intact."""
    with zipfile.ZipFile(path) as z:
        songs = [n for n in z.namelist() if n == 'Song.abl' or n.endswith('/Song.abl')]
        if len(songs) != 1 or z.getinfo(songs[0]).file_size > 16*1024*1024:
            raise ValueError('The Move bundle must contain one Song.abl.')
        song = json.loads(z.read(songs[0]))
    tempo = song.get('tempo')
    if not isinstance(tempo, (int, float)) or not math.isfinite(tempo) or not 20 <= tempo <= 300:
        raise ValueError('Cannot read a supported tempo from the Move Set.')
    signature = song.get('timeSignature', {})
    if signature and signature not in ({'numerator': 4, 'denominator': 4}, {'upper': 4, 'lower': 4}, [4, 4], '4/4'):
        raise ValueError('This first exporter supports 4/4 Sets only.')
    return float(tempo)


def dry_wav(source, clip, dest):
    # Preserve the full original PCM, including any audio outside the active loop.
    frames = clip['full']
    with dest.open('wb') as out, source.open('rb') as original:
        out.write(struct.pack('<4sI4s4sIHHIIHH4sI', b'RIFF', 36+frames*4, b'WAVE',
                              b'fmt ', 16, 1, 2, SR, SR*4, 4, 16, b'data', frames*4))
        original.seek(clip['offset'])
        remaining = frames*4
        while remaining:
            block = original.read(min(remaining, 1024*1024))
            if not block:
                raise ValueError('Incomplete source audio.')
            out.write(block)
            remaining -= len(block)


def build_export(source, bundle, output, renderer, include_dry=False, progress=lambda message: None):
    project = inspect_twain(source)
    bpm = inspect_bundle(bundle)
    bar_frames = SR*240/bpm
    tail_frames = SR*20
    root = safe_name(project['name'])
    clips = project['clips']
    # At most about 2.5 GiB at the supported slowest tempo, 32 clips and tails.
    estimate = sum(round((project['bars'][c['scene']]-project['starts'][c['scene']])*bar_frames)*8 + tail_frames*8 + (c['full']*4 if include_dry else 0) for c in clips)
    if shutil.disk_usage(output.parent).free < estimate*2 + source.stat().st_size + bundle.stat().st_size + 64*1024*1024:
        raise ValueError('Not enough free laptop disk space for this export.')
    manifest = {k: v for k, v in project.items() if k != 'clips'}
    manifest.update(export_format=1, bpm=bpm, sample_rate=SR, dry_included=include_dry,
                    effects_version='Twain 0.9.0', tail_seconds=20, clips=[])
    with tempfile.TemporaryDirectory(prefix='twain-render-', dir=output.parent) as temporary:
        work = Path(temporary)
        with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=3, allowZip64=True) as archive:
            archive.write(bundle, f'{root}/{safe_name(project["name"])}.ablbundle')
            archive.write(source, f'{root}/Twain backup/project.twp')
            for number, clip in enumerate(clips):
                scene = clip['scene']
                label = f'Scene {chr(65+scene)}/Layer {clip["layer"]+1:02d}'
                progress(f'Rendering {number+1}/{len(clips)}: {label}')
                frames = round((project['bars'][scene]-project['starts'][scene])*bar_frames)
                position = int(((project['starts'][scene]-clip['settings'][18])*bar_frames) % clip['length'])
                wet, tail, dry = work/'clip.wav', work/'tail.wav', work/'dry.wav'
                args = [str(renderer), str(source), str(clip['offset']), str(clip['length']),
                        str(clip['full']), str(frames), str(round(bar_frames)), str(position),
                        str(tail_frames), str(wet), str(tail)] + list(map(str, clip['settings']))
                subprocess.run(args, check=True, timeout=600, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
                archive.write(wet, f'{root}/With FX/{label}.wav')
                # Tail starts exactly at the scene end, fades over its last 100 ms.
                archive.write(tail, f'{root}/FX tails/{label} tail.wav')
                wet.unlink(); tail.unlink()
                if include_dry:
                    dry_wav(source, clip, dry)
                    archive.write(dry, f'{root}/Dry originals/{label}.wav'); dry.unlink()
                manifest['clips'].append({**clip, 'scene_label': chr(65+scene),
                    'export_frames': frames, 'start_frame': position,
                    'muted_in_twain': bool(clip['settings'][9])})
            archive.writestr(f'{root}/Twain manifest.json', json.dumps(manifest, indent=2))
            archive.writestr(f'{root}/Read me.txt', f'''Twain + Move export — {project['name']}
Tempo: {bpm:g} BPM, 4/4, 44.1 kHz stereo.

Open the .ablbundle in Ableton Live for your four native tracks.
Add the With FX WAVs on separate audio tracks. Scene A–D folders correspond
 to Twain scenes; Layer 01–08 files belong on the same eight tracks across
 scenes. Set Live's tempo to {bpm:g} BPM and disable automatic warping if it
 changes playback speed. These WAVs are audio, not an automatically built
 Live Set. Each WAV spans exactly one selected Twain scene range, repeating
 shorter source loops and starting at the saved clip origin/range position.

With FX: 32-bit float, clip volume printed, muted clips included audibly.
Twain master volume/mute and monitoring are not printed. Float audio retains
 headroom; if a clip exceeds 0 dBFS, lower its track volume in Live.
FX tails: separate 20-second WAVs beginning at the scene end. Place them
 immediately after the corresponding loop when ending a scene. Tails fade
 over their last 100 ms; sustained self-oscillation and very long feedback
 are bounded by this limit. Effects start from cleared tail memory for each
 clip; this is one pass from silence, not a capture of a live performance.
Dry originals (if selected): original 16-bit captured PCM, no playback FX
 or clip volume applied, full recording length, not repeated/aligned to scene.
Recorded input gain and the baked-in recording character cannot be removed.
Twain backup/project.twp: unchanged save, retained for restoring Twain.
The manifest preserves settings, scene ranges, lengths and mute information.

This exports the last saved state of both projects. Save Move AND Twain
 before exporting. Changes made while exporting are not a synchronized save.
Twain's backup uses version-2 settings with Release in the old attack slot.
''')
    progress('Ready to download')
    return manifest


class ExportApp:
    def __init__(self, renderer, host='move.local'):
        self.renderer = Path(renderer).resolve()
        self.host = host
        self.token = secrets.token_urlsafe(24)
        self.temp = tempfile.TemporaryDirectory(prefix='twain-export-')
        self.root = Path(self.temp.name)
        self.cookies = http.cookiejar.CookieJar()
        self.http = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cookies), urllib.request.ProxyHandler({}))
        self.objects = {}
        self.job = dict(state='idle', message='')
        self.lock = threading.Lock()
        self.uploads = {}

    def move(self, route, body=None, dest=None):
        request = urllib.request.Request(f'http://{self.host}/api/v1/{route}',
            data=None if body is None else json.dumps(body).encode(),
            headers={'Content-Type': 'application/json'})
        try:
            with self.http.open(request, timeout=60) as response:
                if dest:
                    with dest.open('wb') as f:
                        total = 0
                        while True:
                            block = response.read(1024*1024)
                            if not block: break
                            total += len(block)
                            if total > 1024*1024*1024: raise ValueError('Move bundle exceeds the 1 GiB export limit.')
                            f.write(block)
                    return None
                data = response.read(8*1024*1024)
                return json.loads(data) if data else {}
        except urllib.error.HTTPError as error:
            if error.code == 401: raise ValueError('Pair with Move using the code shown on its screen.') from None
            if error.code == 429: raise ValueError('Move requests a pause before another pairing attempt. Wait a minute.') from None
            raise ValueError(f'Move Manager returned HTTP {error.code}.') from None

    def ssh(self, command, dest=None):
        args = ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', '-o', 'ServerAliveInterval=10', '-o', 'ServerAliveCountMax=2',
                f'ableton@{self.host}', command]
        try:
            if dest:
                # Limit reads without copying a possibly huge save into memory.
                with dest.open('wb') as out:
                    child = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
                    try:
                        total = 0
                        while True:
                            block = child.stdout.read(1024*1024)
                            if not block: break
                            total += len(block)
                            if total > MAX_PROJECT: raise ValueError('Twain save exceeds its size limit.')
                            out.write(block)
                        if child.wait(timeout=15): raise ValueError('Cannot read the saved Twain project. Check the Move SSH connection.')
                    finally:
                        child.stdout.close()
                        if child.poll() is None: child.kill(); child.wait()
                return None
            result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30, check=True)
            return result.stdout.decode('utf-8', errors='replace')
        except (subprocess.SubprocessError, OSError):
            raise ValueError('Cannot read Twain over SSH. This prototype needs the existing Move SSH connection; use the file-upload option instead.') from None

    def projects(self):
        payload = self.move('data/Sets')
        if not isinstance(payload, dict) or not isinstance(payload.get('objects'), list):
            raise ValueError('This Move Manager returned an unsupported project list.')
        objects = payload['objects']
        saved = self.ssh("if [ -d /data/UserData/schwung/twain-projects ]; then find /data/UserData/schwung/twain-projects -maxdepth 1 -type f -name '*.twp'; fi")
        ids = {Path(line).stem for line in saved.splitlines() if UUID.fullmatch(Path(line).stem)}
        self.objects = {}
        for obj in objects:
            identifier = str(obj.get('objectId', '')).lower()
            if UUID.fullmatch(identifier):
                self.objects[identifier] = obj
        return [dict(id=k, name=v.get('name') or k, saved=k in ids) for k, v in self.objects.items()]

    def start(self, identifier, dry=False, local=False):
        with self.lock:
            if self.job['state'] == 'working': raise ValueError('An export is already running.')
            if local:
                if not all(k in self.uploads for k in ('twain', 'move')): raise ValueError('Choose both the Twain save and Move bundle first.')
                local_source, local_bundle = self.uploads['twain'], self.uploads['move']
            elif identifier not in self.objects or not UUID.fullmatch(identifier):
                raise ValueError('Refresh the project list and select a Move project.')
            download = secrets.token_urlsafe(20)
            jobroot = self.root/download
            jobroot.mkdir()
            self.job = dict(state='working', message='Reading the last saved project…', download=download)
        def progress(message):
            with self.lock: self.job['message'] = message
        def work():
            try:
                if local:
                    source, bundle = local_source, local_bundle
                else:
                    source, bundle = jobroot/'source.twp', jobroot/'native.ablbundle'
                    self.move('data/Sets/'+urllib.parse.quote(identifier, safe=''), dest=bundle)
                    self.ssh('cat /data/UserData/schwung/twain-projects/'+identifier+'.twp', dest=source)
                output = jobroot/'export.zip'
                manifest = build_export(source, bundle, output, self.renderer, dry, progress)
                with self.lock: self.job.update(state='ready', filename=safe_name(manifest['name'])+' - Move and Twain.zip')
            except Exception as error:
                with self.lock: self.job.update(state='error', message=str(error) or 'Export failed. Your saves were not changed.')
        threading.Thread(target=work, daemon=True).start()
        return self.job.copy()


def serve(app, port=0, open_browser=False):
    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *_): pass
        def json(self, data, status=200):
            body=json.dumps(data).encode();self.send_response(status)
            self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(body)))
            self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(body)
        def allowed(self):
            return self.headers.get('Host') in (f'127.0.0.1:{self.server.server_port}',f'localhost:{self.server.server_port}')
        def do_GET(self):
            if not self.allowed(): self.send_error(403);return
            route=urllib.parse.urlsplit(self.path)
            if route.path=='/':
                body=(HERE/'index.html').read_text().replace('__TOKEN__',app.token).encode()
                self.send_response(200);self.send_header('Content-Type','text/html; charset=utf-8')
                self.send_header('Content-Length',str(len(body)));self.send_header('Cache-Control','no-store')
                self.send_header('Content-Security-Policy',"default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'")
                self.end_headers();self.wfile.write(body)
            elif route.path=='/api/status':
                with app.lock: self.json(app.job.copy())
            elif route.path=='/download':
                with app.lock: job=app.job.copy()
                if urllib.parse.parse_qs(route.query).get('token')!=[job.get('download')] or job['state']!='ready':
                    self.send_error(404);return
                path=app.root/job['download']/'export.zip';self.send_response(200);self.send_header('Content-Type','application/zip')
                self.send_header('Content-Length',str(path.stat().st_size))
                self.send_header('Content-Disposition',"attachment; filename*=UTF-8''"+urllib.parse.quote(job['filename']))
                self.end_headers()
                with path.open('rb') as f: shutil.copyfileobj(f,self.wfile)
            else: self.send_error(404)
        def do_POST(self):
            if not self.allowed() or self.headers.get('X-Twain-Token')!=app.token:
                self.send_error(403);return
            route=urllib.parse.urlsplit(self.path)
            try:
                size=int(self.headers.get('Content-Length','0'))
                if route.path=='/api/upload':
                    kind=urllib.parse.parse_qs(route.query).get('kind',[''])[0]
                    if kind not in ('move','twain') or not 0<size<=1024*1024*1024: raise ValueError('Invalid upload.')
                    with app.lock:
                        if app.job['state']=='working': raise ValueError('Wait for the current export to finish.')
                        path=app.root/('uploaded.'+('twp' if kind=='twain' else 'ablbundle'))
                        with path.open('wb') as out:
                            remaining=size
                            while remaining:
                                data=self.rfile.read(min(remaining,1024*1024))
                                if not data: raise ValueError('Upload interrupted.')
                                out.write(data);remaining-=len(data)
                        if kind=='twain': inspect_twain(path)
                        else: inspect_bundle(path)
                        app.uploads[kind]=path
                    self.json({'ok':True});return
                if not 0<=size<=4096: raise ValueError('Invalid request.')
                body=json.loads(self.rfile.read(size) or b'{}')
                if route.path=='/api/connect': app.move('challenge',{});self.json({'ok':True})
                elif route.path=='/api/pair': app.move('challenge-response',{'secret':str(body.get('code',''))});self.json({'ok':True})
                elif route.path=='/api/projects': self.json({'projects':app.projects()})
                elif route.path=='/api/export': self.json(app.start(str(body.get('id','')),body.get('dry') is True,body.get('local') is True))
                else: self.send_error(404)
            except Exception as error: self.json({'error':str(error)},400)
    httpd=http.server.ThreadingHTTPServer(('127.0.0.1',port),Handler)
    url=f'http://127.0.0.1:{httpd.server_port}/'
    print(url,flush=True)
    if open_browser: webbrowser.open(url)
    return httpd


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--renderer',default=str(HERE/'twain-render'))
    parser.add_argument('--port',type=int,default=0)
    parser.add_argument('--open',action='store_true')
    parser.add_argument('--move-host',default='move.local')
    args=parser.parse_args()
    if not re.fullmatch(r'[A-Za-z0-9.-]+',args.move_host): parser.error('Invalid Move hostname.')
    if not Path(args.renderer).is_file(): parser.error('Offline renderer is missing. Run scripts/build-twain-export.sh first.')
    app=ExportApp(args.renderer,args.move_host)
    server=serve(app,args.port,args.open)
    try: server.serve_forever()
    except KeyboardInterrupt: pass
    finally: server.server_close();app.temp.cleanup()

if __name__=='__main__': main()
