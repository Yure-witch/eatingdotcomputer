#!/usr/bin/env python3
"""top-layer.py <deckdir> <n,n,...>

For slides where Keynote drew something above a movie (a label, an image),
the viewer's video would cover it. png-under/ holds those slides exported
with the top items deleted, in the same order as the list given. The pixels
that differ from the normal export are the top items; they become a
transparent WebP (out/s/NNN-top.webp) that the viewer draws over the videos.
Only the area inside the slide's movie frames is kept, since elsewhere the
slide image already shows them. Adds "top" to those slides in deck.json.
"""
import json, os, subprocess, sys
import numpy as np
from PIL import Image

deck, nums = sys.argv[1], [int(n) for n in sys.argv[2].split(',')]
out = os.path.join(deck, 'out')
manifest = json.load(open(os.path.join(out, 'deck.json')))
full = sorted(p for p in os.listdir(os.path.join(deck, 'png')) if p.endswith('.png'))
under = sorted(p for p in os.listdir(os.path.join(deck, 'png-under')) if p.endswith('.png'))
assert len(under) == len(nums), f'{len(under)} images for {len(nums)} slides'

for n, u in zip(nums, under):
    a = np.asarray(Image.open(os.path.join(deck, 'png', full[n - 1])).convert('RGB')).astype(np.int16)
    b = np.asarray(Image.open(os.path.join(deck, 'png-under', u)).convert('RGB')).astype(np.int16)
    h, w, _ = a.shape
    diff = np.abs(a - b).max(axis=2)
    alpha = np.clip(diff * 6, 0, 255).astype(np.uint8)  # soft edge for antialiased type
    keep = np.zeros((h, w), bool)
    for m in manifest['slides'][n - 1].get('media', []):
        x0, y0 = int(m['x'] / 100 * w), int(m['y'] / 100 * h)
        x1, y1 = int((m['x'] + m['w']) / 100 * w) + 1, int((m['y'] + m['h']) / 100 * h) + 1
        keep[max(0, y0):max(0, y1), max(0, x0):max(0, x1)] = True
    alpha[~keep] = 0
    if not alpha.any():
        manifest['slides'][n - 1].pop('top', None)
        print(f'slide {n}: nothing visible on top, skipped')
        continue
    rgba = np.dstack([a.astype(np.uint8), alpha])
    tmp = os.path.join(deck, f'top-{n:03d}.png')
    Image.fromarray(rgba).save(tmp)
    name = f's/{n:03d}-top.webp'
    subprocess.run(['cwebp', '-quiet', '-q', '90', '-resize', '1920', '0', tmp, '-o', os.path.join(out, name)], check=True)
    os.remove(tmp)
    manifest['slides'][n - 1]['top'] = name
    print(f'slide {n}: {int((alpha > 0).sum())} px on top -> {name}')

json.dump(manifest, open(os.path.join(out, 'deck.json'), 'w'), indent=1)
