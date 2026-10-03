"""Import the five English iTCG scan galleries into an optional local catalog."""
import argparse
import hashlib
import json
import re
import time
import urllib.request
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin, urlsplit

SOURCE = 'https://maplestoryitcg.weebly.com'
SETS = {1: 'Set 1', 2: 'OMG Bosses!', 3: 'P3ts', 4: 'NPC Heroes', 5: 'Behold Zakum'}
MAX_BYTES = 8 * 1024 * 1024

def source_url(url):
    parsed = urlsplit(url)
    return parsed.scheme == 'https' and parsed.netloc == 'maplestoryitcg.weebly.com' and not parsed.query and not parsed.fragment

class SourceRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        if not source_url(newurl):
            raise ValueError('Unexpected download redirect')
        return super().redirect_request(request, fp, code, msg, headers, newurl)

class Gallery(HTMLParser):
    def __init__(self):
        super().__init__()
        self.images = []

    def handle_starttag(self, tag, attrs):
        row = dict(attrs)
        if tag == 'a' and row.get('rel', '').startswith('lightbox[gallery'):
            url = urljoin(SOURCE, row.get('href', ''))
            parsed = urlsplit(url)
            if not source_url(url) or not re.fullmatch(r'/uploads/[0-9/]+/[a-zA-Z0-9_-]+\.(?:jpg|jpeg|png)', parsed.path):
                raise ValueError('Unexpected scan location in source gallery')
            if url not in self.images:
                self.images.append(url)

def fetch(url):
    if not source_url(url):
        raise ValueError('Unexpected source URL')
    request = urllib.request.Request(url, headers={'User-Agent': 'MapleStoryV83CardBridge/0.1 (optional card import)'})
    with urllib.request.build_opener(SourceRedirect()).open(request, timeout=30) as response:
        if not source_url(response.url):
            raise ValueError('Unexpected download redirect')
        data = response.read(MAX_BYTES + 1)
        if len(data) > MAX_BYTES:
            raise ValueError('Source file exceeds download limit')
        return data

def image_extension(data):
    if data.startswith(b'\xff\xd8\xff'):
        return '.jpg'
    if data.startswith(b'\x89PNG\r\n\x1a\n'):
        return '.png'
    raise ValueError('Downloaded scan is not a JPEG or PNG')

def build_catalog(base, galleries, price, version, download=False):
    catalog = json.loads(json.dumps(base))
    catalog.update(version=version, name='MapleStory iTCG scan collection', lines=[], cards=[], variants=[], products=[])
    catalog['rarities'] = [{'id': 'scan', 'name': 'Scanned card', 'rank': 0}]
    for number, images in galleries.items():
        line = 'itcg-set-' + str(number)
        catalog['lines'].append({'id': line, 'name': SETS[number]})
        pool = []
        for index, url in enumerate(images, 1):
            card_id = f'{line}-{index:03d}'
            catalog['cards'].append({'id': card_id, 'lineId': line, 'name': f'{SETS[number]} · Card {index:02d}', 'metadata': {'source': url, 'image': f'/assets/library/{line}/{index:03d}.jpg' if download else url, 'description': 'A card scan from the MapleStory Card Game Guide. Card names and historical rarities can be supplied by the server owner.'}})
            catalog['variants'].append({'id': card_id + '.scan', 'cardId': card_id, 'rarityId': 'scan'})
            pool.append({'variantId': card_id + '.scan', 'weight': 1})
        catalog['products'].append({'id': line, 'lineId': line, 'name': SETS[number], 'revision': 1, 'maxQuantity': 5, 'price': {'currencyId': 'nx', 'amount': price}, 'slots': [{'id': 'cards', 'count': 8, 'pool': pool}]})
    return catalog

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=Path('external/itcg'))
    parser.add_argument('--sets', default='1,2,3,4,5')
    parser.add_argument('--price', type=int, default=1000)
    parser.add_argument('--catalog-version', type=int, default=3)
    parser.add_argument('--inspect', action='store_true', help='List source galleries without downloading scans or writing files')
    parser.add_argument('--download', action='store_true', help='Download local copies instead of referencing source images directly')
    args = parser.parse_args()
    numbers = list(dict.fromkeys(int(n) for n in args.sets.split(',')))
    if not numbers or any(n not in SETS for n in numbers) or args.price < 1 or args.catalog_version < 1:
        parser.error('Choose sets 1–5 and positive price/catalog version')
    output = args.output.resolve()
    if not args.inspect and output.exists():
        parser.error('Output already exists. Choose a new directory; existing catalogs and scans are never overwritten.')
    galleries = {}
    pages = []
    for number in numbers:
        page = Gallery()
        page_url = f'{SOURCE}/set-{number}.html'
        html = fetch(page_url)
        page.feed(html.decode('utf-8'))
        if not 1 <= len(page.images) <= 500:
            raise ValueError(f'Set {number} has no recognizable gallery or exceeds the card limit')
        galleries[number] = page.images
        pages.append({'set': number, 'url': page_url, 'count': len(page.images), 'pageSha256': hashlib.sha256(html).hexdigest()})
        print(f'{SETS[number]}: {len(page.images)} scans', flush=True)
        time.sleep(0.3)
    if args.inspect:
        return
    base = json.loads((Path(__file__).resolve().parents[1] / 'data/catalog.example.json').read_text(encoding='utf-8'))
    catalog = build_catalog(base, galleries, args.price, args.catalog_version, args.download)
    output.mkdir(parents=True, exist_ok=False)
    receipts = []
    try:
        for number, images in galleries.items():
            line = 'itcg-set-' + str(number)
            if not args.download:
                receipts.extend({'set': number, 'card': index, 'source': url} for index, url in enumerate(images, 1))
                continue
            target = output / 'assets' / line
            target.mkdir(parents=True)
            for index, url in enumerate(images, 1):
                data = fetch(url)
                extension = image_extension(data)
                name = f'{index:03d}' + extension
                (target / name).write_bytes(data)
                card = next(c for c in catalog['cards'] if c['id'] == f'{line}-{index:03d}')
                card['metadata']['image'] = f'/assets/library/{line}/{name}'
                receipts.append({'set': number, 'card': index, 'source': url, 'file': f'assets/{line}/{name}', 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
                print(f'{SETS[number]}: downloaded {index}/{len(images)}', flush=True)
                time.sleep(0.3)
        (output / 'sources.json').write_text(json.dumps({'source': SOURCE, 'mode': 'download' if args.download else 'remote', 'galleries': pages, 'files': receipts}, indent=2) + '\n', encoding='utf-8')
        (output / 'catalog.json').write_text(json.dumps(catalog, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    except Exception:
        (output / 'INCOMPLETE.txt').write_text('Import did not finish. No catalog was activated. Retry into a new directory.\n')
        raise
    print('Import complete. No live configuration was changed. Review catalog.json before activation.' + (' Set ASSET_ROOT to the assets directory for local scans.' if args.download else ' Images load directly from the source website; no image copies were written.'))

if __name__ == '__main__':
    main()
