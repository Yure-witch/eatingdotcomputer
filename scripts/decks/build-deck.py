#!/usr/bin/env python3
"""build-deck.py <deckdir> <title> [--pdf-slides]

Turns an exported deck into the eating.computer viewer format, in <deckdir>/out:
  deck.json       slide list + media placed as % of the slide
  s/NNN.webp      slide images (1920 wide)
  t/NNN.webp      thumbnails (480 wide)
  m/NN.mp4|.mp3   videos re-encoded to H.264/AAC, GIFs to silent looping MP4

Input in <deckdir>:
  layout.tsv      DOC/SLIDE/MOVIE/AUDIO lines (Keynote AppleScript), or the
                  same lines written by the PPTX/Slides parser
  png/            one image per slide, sorted = slide order
  src.key         Keynote package (zip) holding Data/<stem>-<id>.<ext>, or
  media/          loose media files named as in layout.tsv
"""
import json, math, os, re, subprocess, sys, unicodedata, zipfile, shutil

deck, title = sys.argv[1], sys.argv[2]
out = os.path.join(deck, 'out')
for d in ('s', 't', 'm'):
    os.makedirs(os.path.join(out, d), exist_ok=True)

W = H = None
slides = []
for line in open(os.path.join(deck, 'layout.tsv'), encoding='utf-8'):
    f = line.rstrip('\n').split('\t')
    if f[0] == 'DOC':
        W, H = float(f[1]), float(f[2])
    elif f[0] == 'SLIDE':
        slides.append({'media': [], 'audio': []})
    elif f[0] in ('MOVIE', 'GMOVIE', 'GIF', 'GGIF'):
        n = int(f[1])
        x, y, w, h, rot, op = map(float, f[3:9])
        rep = f[9] if len(f) > 9 else 'none'
        vol = float(f[10]) if len(f) > 10 and f[10] else 100
        crop = [float(c) for c in f[11].split(',')] if len(f) > 11 and f[11] else [0, 0, 0, 0]
        slides[n - 1]['media'].append({'file': f[2], 'x': x, 'y': y, 'w': w, 'h': h, 'rot': rot,
                                       'opacity': op, 'loop': rep != 'none', 'volume': vol, 'crop': crop})
    elif f[0] == 'AUDIO':
        n = int(f[1])
        slides[n - 1]['audio'].append({'file': f[2], 'loop': f[3] != 'none',
                                       'volume': float(f[4]) if len(f) > 4 else 100})

pngs = sorted(p for p in os.listdir(os.path.join(deck, 'png')) if p.lower().endswith(('.png', '.jpg')))
assert len(pngs) == len(slides), f'{len(pngs)} images but {len(slides)} slides'

key = os.path.join(deck, 'src.key')
zf = zipfile.ZipFile(key) if os.path.exists(key) else None
names = []
real = {}  # decoded name -> zip member (Keynote zips lack the UTF-8 flag)
for info in (zf.infolist() if zf else []):
    n = info.filename
    if not info.flag_bits & 0x800:
        try:
            n = n.encode('cp437').decode('utf-8')
        except UnicodeError:
            pass
    names.append(n)
    real[n] = info.filename
tmp = os.path.join(deck, 'media-src')
os.makedirs(tmp, exist_ok=True)


def norm(s):
    return re.sub(r'[\s\u202f\u00a0]+', ' ', unicodedata.normalize('NFC', s)).strip().lower()


def extract(member):
    dst = os.path.join(tmp, os.path.basename(member))
    if not os.path.exists(dst):
        with zf.open(real[member]) as src, open(dst, 'wb') as o:
            shutil.copyfileobj(src, o)
    return dst


def dims(p):
    v = next(s for s in probe(p) if s['codec_type'] == 'video')
    w, h = int(v['width']), int(v['height'])
    rot = 0
    for sd in v.get('side_data_list', []):
        rot = int(sd.get('rotation', 0) or 0)
    if abs(rot) % 180 == 90:
        w, h = h, w
    return w, h


def source(fn, place=None):
    """Path to the original media file for a layout file name. Same-named
    files (Keynote calls every pasted GIF "pasted-movie.gif") are told apart
    by which one's shape matches the frame it sits in."""
    loose = os.path.join(deck, 'media', fn)
    if os.path.exists(loose):
        return loose
    stem, ext = os.path.splitext(norm(fn))
    pat = re.compile('^' + re.escape(stem) + r'(-\d+)?' + re.escape(ext) + '$')
    data = [n for n in names if n.startswith('Data/') and '-small-' not in n]
    hits = [n for n in data if pat.match(norm(os.path.basename(n)))]
    if not hits:
        pat = re.compile('^' + re.escape(stem) + r'(-\d+)?\.(mov|mp4|m4v|gif)$')
        hits = [n for n in data if pat.match(norm(os.path.basename(n)))]
    if not hits:
        raise SystemExit(f'no media in package for {fn!r}')
    if len(hits) == 1 or place is None:
        return extract(max(hits, key=lambda n: zf.getinfo(real[n]).file_size))
    want = place['w'] / place['h']
    if abs(place['rot']) % 180 == 90:
        want = 1 / want
    def miss(n):
        w, h = dims(extract(n))
        return abs(math.log((w / h) / want))
    best = min(hits, key=miss)
    print(f'    {fn}: {len(hits)} candidates, picked {os.path.basename(best)}', flush=True)
    return extract(best)


def probe(p):
    r = subprocess.run(['ffprobe', '-v', 'error', '-show_streams', '-of', 'json', p],
                       capture_output=True, text=True, check=True)
    return json.loads(r.stdout)['streams']


SCALE = "scale=w='min(1920,iw)':h='min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2"


def encode_video(src, dst, gif, mute=False):
    if os.path.exists(dst):  # resuming an earlier run
        return any(x['codec_type'] == 'audio' for x in probe(dst))
    streams = probe(src)
    v = next((s for s in streams if s['codec_type'] == 'video'), None)
    a = next((s for s in streams if s['codec_type'] == 'audio'), None)
    if v is None:
        raise SystemExit(f'{src}: no video stream')
    fits = int(v.get('width', 9999)) <= 1920 and int(v.get('height', 9999)) <= 1080
    lean = int(v.get('bit_rate') or 0) <= 8_000_000  # streams on a phone
    if (not gif and v['codec_name'] == 'h264' and v.get('pix_fmt') == 'yuv420p' and fits and lean
            and (a is None or (a['codec_name'] == 'aac' and not mute))):
        cmd = ['-c', 'copy']
    else:
        cmd = ['-vf', SCALE, '-c:v', 'libx264', '-preset', 'medium', '-crf', '20' if gif else '23',
               '-maxrate', '8M', '-bufsize', '16M', '-pix_fmt', 'yuv420p', '-profile:v', 'high']
        cmd += ['-an'] if gif or mute or a is None else ['-c:a', 'aac', '-b:a', '160k', '-ac', '2']
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', src, *cmd, '-movflags', '+faststart', dst], check=True)
    return a is not None and not gif and not mute


def encode_audio(src, dst):
    if src.lower().endswith('.mp3'):
        shutil.copyfile(src, dst)
    else:
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', src, '-vn', '-c:a', 'libmp3lame', '-q:a', '2', dst],
                       check=True)


pct = lambda v, total: round(v / total * 100, 3)
done = {}  # original file -> (published name, has sound)
count = 0
out_slides = []
for i, (s, png) in enumerate(zip(slides, pngs), 1):
    n = f'{i:03d}'
    src_img = os.path.join(deck, 'png', png)
    subprocess.run(['cwebp', '-quiet', '-q', '82', '-resize', '1920', '0', src_img, '-o', f'{out}/s/{n}.webp'], check=True)
    subprocess.run(['cwebp', '-quiet', '-q', '70', '-resize', '480', '0', src_img, '-o', f'{out}/t/{n}.webp'], check=True)
    slide = {'img': f's/{n}.webp', 'thumb': f't/{n}.webp'}
    media = []
    for m in s['media']:
        src = source(m['file'], m)
        gif = m['file'].lower().endswith('.gif')
        if src not in done:
            count += 1
            name = f'm/{count:02d}.mp4'
            print(f'  slide {i}: {m["file"]} -> {name}', flush=True)
            done[src] = (name, encode_video(src, f'{out}/{name}', gif, m['volume'] == 0))
        name, sound = done[src]
        x, y, rot = m['x'], m['y'], m['rot']
        if rot and zf:
            # Keynote: rotation is counter-clockwise and the position is the
            # rotated outline's corner. CSS wants the unrotated box + clockwise.
            r = math.radians(rot)
            bw = abs(m['w'] * math.cos(r)) + abs(m['h'] * math.sin(r))
            bh = abs(m['w'] * math.sin(r)) + abs(m['h'] * math.cos(r))
            x, y, rot = x + bw / 2 - m['w'] / 2, y + bh / 2 - m['h'] / 2, -rot
        m['rot'] = rot
        item = {'src': name, 'x': pct(x, W), 'y': pct(y, H), 'w': pct(m['w'], W), 'h': pct(m['h'], H)}
        if gif:
            item['gif'] = True
        elif not zf:
            item['fit'] = 'contain'  # Slides letterboxes a video in its frame; Keynote frames fit the video
        if m['loop'] or gif:
            item['loop'] = True
        if sound and m['volume'] < 100:
            item['volume'] = m['volume'] / 100
        if not sound:
            item['silent'] = True
        if m['rot']:
            item['rot'] = m['rot']
        if any(m['crop']):
            item['crop'] = [round(c * 100, 3) for c in m['crop']]  # % of the source: l, t, r, b
        if m['opacity'] < 100:
            item['opacity'] = m['opacity'] / 100
        media.append(item)
    if media:
        slide['media'] = media
    audio = []
    for a in s['audio']:
        src = source(a['file'])
        if src not in done:
            count += 1
            name = f'm/{count:02d}.mp3'
            print(f'  slide {i}: {a["file"]} -> {name}', flush=True)
            encode_audio(src, f'{out}/{name}')
            done[src] = (name, True)
        item = {'src': done[src][0]}
        if a['loop']:
            item['loop'] = True
        if a['volume'] < 100:
            item['volume'] = a['volume'] / 100
        audio.append(item)
    if audio:
        slide['audio'] = audio
    out_slides.append(slide)

json.dump({'v': 1, 'title': title, 'aspect': round(W / H, 5), 'slides': out_slides},
          open(f'{out}/deck.json', 'w'), indent=1)
print(f'{len(out_slides)} slides, {count} media files')
