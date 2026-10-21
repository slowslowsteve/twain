"""End-to-end offline export checks using synthetic saved clips and native bundles."""
import importlib.util
import json
import math
import os
from pathlib import Path
import struct
import tempfile
import unittest
import urllib.error
import urllib.request
import zipfile
import zlib
import threading
import time

spec=importlib.util.spec_from_file_location('twain_export',Path(__file__).resolve().parents[1]/'tools/twain-export/server.py')
export=importlib.util.module_from_spec(spec);spec.loader.exec_module(export)
ROOT=Path(__file__).resolve().parents[1]
RENDERER=Path(os.environ.get('TWAIN_EXPORT_RENDERER',str(ROOT/'build/twain-export-laptop/twain-render')))


def fixture(path,version=2,layers=8):
    data=bytearray(b'TWAIN01\n')
    data+=struct.pack('<7I',version,44100,4,layers,0,73,1)
    data+=struct.pack('<4I',5,1,1,1)
    data+=b'Export sketch\0'.ljust(128,b'\0')
    if version==2:data+=struct.pack('<6I',2,0,0,0,150,37)
    for s in range(4):
        for layer in range(layers):
            settings=export.DEFAULTS.copy();settings[0]=50;settings[9]=1
            # A short repeating source; saved loop origin is bar 2 (zero-based).
            if version==2:settings[18]=2
            frames=441 if s==0 and layer==0 else 0
            data+=struct.pack('<IId',frames,frames,88200)
            data+=struct.pack('<%dI'%(19 if version==2 else 10),*settings[:19 if version==2 else 10])
            for n in range(frames):data+=struct.pack('<hh',n*13-2000,2000-n*13)
    data+=struct.pack('<I',zlib.crc32(data))
    path.write_bytes(data)


def bundle(path,bpm=120,signature=None):
    with zipfile.ZipFile(path,'w') as z:z.writestr('Song.abl',json.dumps({'tempo':bpm,'timeSignature':signature or {'upper':4,'lower':4}}))


def pcm(data):
    assert data[:4]==b'RIFF' and data[8:12]==b'WAVE'
    offset=12
    while offset+8<=len(data):
        key,size=struct.unpack_from('<4sI',data,offset);offset+=8
        if key==b'data':return data[offset:offset+size]
        offset+=size+(size%2)
    raise AssertionError('missing WAV data')


class ExportTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        self.source=self.root/'project.twp';self.native=self.root/'native.ablbundle'
        fixture(self.source);bundle(self.native)
    def tearDown(self):self.temp.cleanup()
    def test_export_audio_backup_ranges_and_dry(self):
        out=self.root/'result.zip';messages=[]
        meta=export.build_export(self.source,self.native,out,RENDERER,True,messages.append)
        with zipfile.ZipFile(out) as z:
            names=z.namelist();root='Export sketch/'
            self.assertEqual(z.read(root+'Export sketch.ablbundle'),self.native.read_bytes())
            self.assertEqual(z.read(root+'Twain backup/project.twp'),self.source.read_bytes())
            dry=pcm(z.read(root+'Dry originals/Scene A/Layer 01.wav'))
            clip=export.inspect_twain(self.source)['clips'][0]
            self.assertEqual(dry,self.source.read_bytes()[clip['offset']:clip['offset']+clip['full']*4])
            wet=pcm(z.read(root+'With FX/Scene A/Layer 01.wav'))
            # Three scene bars, zero offset from saved origin, muted/master
            # mute ignored; default clip gain 50% printed exactly.
            self.assertEqual(len(wet),3*88200*8)
            first=struct.unpack_from('<2f',wet)
            self.assertAlmostEqual(first[0],-2000/32768*.5,places=6)
            self.assertAlmostEqual(first[1],2000/32768*.5,places=6)
            self.assertEqual(struct.unpack_from('<2f',wet,441*8),first)
            tail=pcm(z.read(root+'FX tails/Scene A/Layer 01 tail.wav'))
            self.assertEqual(len(tail),20*44100*8);self.assertFalse(any(tail))
            self.assertTrue(meta['clips'][0]['muted_in_twain'])
            self.assertEqual(meta['clips'][0]['start_frame'],0)
            self.assertEqual(len(meta['clips']),1)
        self.assertTrue(messages[-1].startswith('Ready'))
    def test_fx_are_printed_and_tails_are_separate(self):
        data=bytearray(self.source.read_bytes())
        # Version-2 first clip header: enable reverb and delay at full send.
        struct.pack_into('<I',data,204+16+6*4,100)
        struct.pack_into('<I',data,204+16+7*4,100)
        struct.pack_into('<I',data,len(data)-4,zlib.crc32(data[:-4]));self.source.write_bytes(data)
        out=self.root/'fx.zip'
        export.build_export(self.source,self.native,out,RENDERER)
        with zipfile.ZipFile(out) as z:
            self.assertFalse(any('Dry originals/' in n for n in z.namelist()))
            wet=pcm(z.read('Export sketch/With FX/Scene A/Layer 01.wav'))
            tail=pcm(z.read('Export sketch/FX tails/Scene A/Layer 01 tail.wav'))
            values=struct.unpack('<%df'%(len(tail)//4),tail)
            self.assertTrue(all(math.isfinite(v) for v in values))
            self.assertGreater(sum(v*v for v in values[:44100*2]),.001)
            self.assertLess(sum(v*v for v in values[-4410*2:]),sum(v*v for v in values[:4410*2]))
            self.assertNotAlmostEqual(struct.unpack_from('<f',wet,88200*8)[0],-2000/32768*.5,places=4)
    def test_range_origin_at_noninteger_bar_length(self):
        data=bytearray(self.source.read_bytes());struct.pack_into('<I',data,204+16+18*4,0)
        struct.pack_into('<I',data,len(data)-4,zlib.crc32(data[:-4]));self.source.write_bytes(data)
        bundle(self.native,bpm=119);out=self.root/'range.zip'
        meta=export.build_export(self.source,self.native,out,RENDERER)
        position=int((2*44100*240/119)%441)
        self.assertEqual(meta['clips'][0]['start_frame'],position)
        with zipfile.ZipFile(out) as z:
            wet=pcm(z.read('Export sketch/With FX/Scene A/Layer 01.wav'))
            self.assertAlmostEqual(struct.unpack_from('<f',wet)[0],(position*13-2000)/32768*.5,places=6)
    def test_invalid_clip_does_not_render(self):
        data=bytearray(self.source.read_bytes());struct.pack_into('<I',data,204+4,0xffffffff)
        struct.pack_into('<I',data,len(data)-4,zlib.crc32(data[:-4]));self.source.write_bytes(data)
        with self.assertRaisesRegex(ValueError,'clip length'):export.inspect_twain(self.source)
    def test_native_api_routes_and_uuid_matching(self):
        app=export.ExportApp(RENDERER)
        identity='7f2402f6-dc58-43e5-b7aa-d93e16e52ab6'
        routes=[]
        app.move=lambda route,**kwargs:(routes.append(route) or {'objects':[{'objectId':identity,'name':'Sketch'},{'objectId':'../wrong','name':'Unsafe'}]})
        app.ssh=lambda command:f'/data/UserData/schwung/twain-projects/{identity}.twp\n'
        try:
            self.assertEqual(app.projects(),[{'id':identity,'name':'Sketch','saved':True}])
            self.assertEqual(routes,['data/Sets'])
            def download(route,body=None,dest=None):
                routes.append(route)
                self.assertEqual(route,'data/Sets/'+identity)
                dest.write_bytes(self.native.read_bytes())
            def read_save(command,dest=None):
                self.assertEqual(command,'cat /data/UserData/schwung/twain-projects/'+identity+'.twp')
                dest.write_bytes(self.source.read_bytes())
            app.move=download;app.ssh=read_save
            app.start(identity)
            deadline=time.monotonic()+15
            while app.job['state']=='working' and time.monotonic()<deadline:time.sleep(.02)
            self.assertEqual(app.job['state'],'ready',app.job)
            self.assertTrue((app.root/app.job['download']/'export.zip').is_file())
        finally:app.temp.cleanup()
    def test_legacy_and_crc(self):
        for layers in (4,8):
            fixture(self.source,1,layers)
            result=export.inspect_twain(self.source)
            self.assertEqual(result['starts'],[0]*4)
            self.assertEqual(result['clips'][0]['settings'][12],35)
        b=bytearray(self.source.read_bytes());b[-1]^=1;self.source.write_bytes(b)
        with self.assertRaisesRegex(ValueError,'checksum'):export.inspect_twain(self.source)
    def test_bundle_checks(self):
        bundle(self.native,signature={'upper':3,'lower':4})
        with self.assertRaisesRegex(ValueError,'4/4'):export.inspect_bundle(self.native)
        bundle(self.native,bpm=float('nan'))
        with self.assertRaisesRegex(ValueError,'tempo'):export.inspect_bundle(self.native)
    def test_local_http_controls(self):
        app=export.ExportApp(RENDERER)
        http=export.serve(app);thread=threading.Thread(target=http.serve_forever,daemon=True);thread.start()
        address='http://127.0.0.1:%d'%http.server_port
        try:
            page=urllib.request.urlopen(address).read().decode();self.assertIn(app.token,page)
            self.assertNotIn('__TOKEN__',page)
            request=urllib.request.Request(address+'/api/export',b'{}',headers={'Content-Type':'application/json'})
            with self.assertRaises(urllib.error.HTTPError) as bad:urllib.request.urlopen(request)
            self.assertEqual(bad.exception.code,403)
            request=urllib.request.Request(address+'/api/export',b'{}',headers={'X-Twain-Token':app.token,'Content-Type':'application/json'})
            with self.assertRaises(urllib.error.HTTPError) as bad:urllib.request.urlopen(request)
            self.assertEqual(bad.exception.code,400)
            self.assertEqual(app.job['state'],'idle')
            # Exercise actual upload -> asynchronous render -> ZIP download,
            # rather than only calling the renderer through its Python helper.
            def post(route,body,content='application/octet-stream'):
                request=urllib.request.Request(address+route,body,headers={'X-Twain-Token':app.token,'Content-Type':content})
                return json.loads(urllib.request.urlopen(request).read())
            post('/api/upload?kind=twain',self.source.read_bytes())
            post('/api/upload?kind=move',self.native.read_bytes())
            post('/api/export',b'{"local":true,"dry":true}','application/json')
            deadline=time.monotonic()+15
            while time.monotonic()<deadline:
                status=json.loads(urllib.request.urlopen(address+'/api/status').read())
                if status['state']!='working':break
                time.sleep(.02)
            self.assertEqual(status['state'],'ready',status)
            downloaded=urllib.request.urlopen(address+'/download?token='+status['download']).read()
            self.assertEqual(downloaded[:4],b'PK\x03\x04')
            request=urllib.request.Request(address,headers={'Host':'example.com'})
            with self.assertRaises(urllib.error.HTTPError) as bad:urllib.request.urlopen(request)
            self.assertEqual(bad.exception.code,403)
        finally:http.shutdown();http.server_close();thread.join();app.temp.cleanup()


if __name__=='__main__':unittest.main()
