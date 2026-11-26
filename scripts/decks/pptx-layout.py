#!/usr/bin/env python3
"""pptx-layout.py <deck.pptx> <deckdir>

Writes <deckdir>/layout.tsv (same lines as the Keynote script) and copies each
animated GIF to <deckdir>/media/. Positions stay in EMU; build-deck.py turns
them into % of the slide. Static GIFs are skipped (the slide image has them).
"""
import json, os, posixpath, subprocess, sys, zipfile
import xml.etree.ElementTree as ET

src, deck = sys.argv[1], sys.argv[2]
NS = {
    'p': 'http://schemas.openxmlformats.org/presentationml/2006/main',
    'a': 'http://schemas.openxmlformats.org/drawingml/2006/main',
    'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
    'rel': 'http://schemas.openxmlformats.org/package/2006/relationships',
}
RID = '{%s}id' % NS['r']
EMBED = '{%s}embed' % NS['r']
z = zipfile.ZipFile(src)
os.makedirs(os.path.join(deck, 'media'), exist_ok=True)


def rels(part):
    d, b = posixpath.split(part)
    path = posixpath.join(d, '_rels', b + '.rels')
    out = {}
    for r in ET.fromstring(z.read(path)).findall('rel:Relationship', NS):
        out[r.get('Id')] = posixpath.normpath(posixpath.join(d, r.get('Target')))
    return out


pres = ET.fromstring(z.read('ppt/presentation.xml'))
size = pres.find('p:sldSz', NS)
W, H = int(size.get('cx')), int(size.get('cy'))
prels = rels('ppt/presentation.xml')
slides = [prels[s.get(RID)] for s in pres.find('p:sldIdLst', NS)]


def frames(path):
    r = subprocess.run(['ffprobe', '-v', 'error', '-count_frames', '-select_streams', 'v:0',
                        '-show_entries', 'stream=nb_read_frames', '-of', 'json', path],
                       capture_output=True, text=True)
    try:
        return int(json.loads(r.stdout)['streams'][0]['nb_read_frames'])
    except Exception:
        return 1


lines = [f'DOC\t{W}\t{H}']
warn = []
for n, part in enumerate(slides, 1):
    lines.append(f'SLIDE\t{n}\t{n}')
    srels = rels(part)
    root = ET.fromstring(z.read(part))

    def walk(node, tf):
        for el in node:
            tag = el.tag.split('}')[1]
            if tag == 'grpSp':
                x = el.find('p:grpSpPr/a:xfrm', NS)
                off, ext = x.find('a:off', NS), x.find('a:ext', NS)
                coff, cext = x.find('a:chOff', NS), x.find('a:chExt', NS)
                sx = int(ext.get('cx')) / max(1, int(cext.get('cx')))
                sy = int(ext.get('cy')) / max(1, int(cext.get('cy')))
                ox = int(off.get('x')) - int(coff.get('x')) * sx
                oy = int(off.get('y')) - int(coff.get('y')) * sy
                # compose with the parent mapping
                walk(el, (tf[0] + ox * tf[2], tf[1] + oy * tf[3], tf[2] * sx, tf[3] * sy))
            elif tag == 'pic':
                blip = el.find('p:blipFill/a:blip', NS)
                if blip is None or blip.get(EMBED) not in srels:
                    continue
                target = srels[blip.get(EMBED)]
                if not target.lower().endswith('.gif'):
                    continue
                name = f'{n:03d}-{posixpath.basename(target)}'
                dst = os.path.join(deck, 'media', name)
                if not os.path.exists(dst):
                    with open(dst, 'wb') as o:
                        o.write(z.read(target))
                if frames(dst) < 2:
                    os.remove(dst)
                    continue
                sr = el.find('p:blipFill/a:srcRect', NS)
                crop = [int(sr.get(k, 0)) / 100000 if sr is not None else 0 for k in 'ltrb']
                if any(crop):
                    warn.append(f'slide {n}: {name} cropped l,t,r,b = {crop}')
                x = el.find('p:spPr/a:xfrm', NS)
                off, ext = x.find('a:off', NS), x.find('a:ext', NS)
                px = tf[0] + int(off.get('x')) * tf[2]
                py = tf[1] + int(off.get('y')) * tf[3]
                pw = int(ext.get('cx')) * tf[2]
                ph = int(ext.get('cy')) * tf[3]
                rot = int(x.get('rot', 0)) / 60000
                lines.append(f'MOVIE\t{n}\t{name}\t{px:.0f}\t{py:.0f}\t{pw:.0f}\t{ph:.0f}\t{rot:.0f}\t100\tloop\t100\t' + ','.join(f'{c:.5f}' for c in crop))

    walk(root.find('p:cSld/p:spTree', NS), (0, 0, 1, 1))

open(os.path.join(deck, 'layout.tsv'), 'w').write('\n'.join(lines) + '\n')
print('\n'.join(l for l in lines if l.startswith('MOVIE')))
print('\n'.join(warn) or 'no cropped GIFs')
print(f'{len(slides)} slides')
