"""covered.py <zorder.tsv>: items drawn above a movie and overlapping it, per slide."""
import sys, collections
slides = collections.defaultdict(list)
for line in open(sys.argv[1], encoding='utf-8'):
    f = line.rstrip('\n').split('\t')
    if f[0] != 'Z': continue
    slides[int(f[1])].append((int(f[2]), f[3], *map(float, f[4:8]), f[8] if len(f) > 8 else ''))
def hit(a, b):
    return a[0] < b[0] + b[2] and b[0] < a[0] + a[2] and a[1] < b[1] + b[3] and b[1] < a[1] + a[3]
for n, items in sorted(slides.items()):
    movies = []
    for i, cls, x, y, w, h, fn in items:
        r = (x, y, w, h)
        if cls == 'movie':
            movies.append(r); continue
        if w and h and any(hit(r, m) for m in movies):
            print(f'{n}\t{i}\t{cls}\t{x:.0f},{y:.0f},{w:.0f},{h:.0f}')
