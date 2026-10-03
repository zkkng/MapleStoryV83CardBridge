import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('itcg_import', ROOT / 'tools/import-itcg.py')
importer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(importer)
HTML = b"<a href='/uploads/2/3/2302393/01_orig.jpg' rel='lightbox[gallery123]'>Card</a><a href='/uploads/2/3/2302393/01_orig.jpg' rel='lightbox[gallery123]'>Duplicate</a>"
JPEG = b'\xff\xd8\xff\xe0fixture-jpeg'

class ImportTests(unittest.TestCase):
    def test_gallery_only_accepts_deduplicated_source_scans(self):
        gallery = importer.Gallery()
        gallery.feed(HTML.decode())
        self.assertEqual(len(gallery.images), 1)
        with self.assertRaises(ValueError):
            gallery.feed("<a href='https://other.invalid/art.jpg' rel='lightbox[gallery123]'>")

    def test_selected_sets_remain_separate_without_code_pool_or_invented_rarity(self):
        base = json.loads((ROOT / 'data/catalog.example.json').read_text(encoding='utf-8'))
        catalog = importer.build_catalog(base, {1: ['one'], 5: ['five']}, 250, 4)
        self.assertEqual([p['id'] for p in catalog['products']], ['itcg-set-1', 'itcg-set-5'])
        self.assertEqual(catalog['version'], 4)
        self.assertTrue(all(p['price']['amount'] == 250 and p['slots'][0]['count'] == 8 for p in catalog['products']))
        self.assertTrue(all(not v.get('codes') for v in catalog['variants']))
        self.assertTrue(all(v['rarityId'] == 'scan' for v in catalog['variants']))

    def test_complete_import_records_hashes_and_refuses_overwrite(self):
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / 'cards'
            def fetch(url):
                return HTML if url.endswith('.html') else JPEG
            args = ['import-itcg', '--output', str(output), '--sets', '1,5', '--download']
            with patch('sys.argv', args), patch.object(importer, 'fetch', side_effect=fetch), patch.object(importer.time, 'sleep'):
                importer.main()
                catalog = json.loads((output / 'catalog.json').read_text(encoding='utf-8'))
                receipt = json.loads((output / 'sources.json').read_text())
                self.assertEqual(len(catalog['products']), 2)
                self.assertEqual(len(receipt['files']), 2)
                self.assertEqual(receipt['files'][0]['sha256'], importer.hashlib.sha256(JPEG).hexdigest())
                self.assertEqual((output / receipt['files'][0]['file']).read_bytes(), JPEG)
                with self.assertRaises(SystemExit):
                    importer.main()
                self.assertEqual((output / receipt['files'][0]['file']).read_bytes(), JPEG)

    def test_failed_download_never_writes_an_activatable_catalog(self):
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / 'cards'
            with patch('sys.argv', ['import-itcg', '--output', str(output), '--sets', '2', '--download']), patch.object(importer, 'fetch', side_effect=[HTML, b'<html>unavailable</html>']), patch.object(importer.time, 'sleep'):
                with self.assertRaises(ValueError):
                    importer.main()
            self.assertFalse((output / 'catalog.json').exists())
            self.assertTrue((output / 'INCOMPLETE.txt').exists())

    def test_inspect_writes_nothing(self):
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / 'cards'
            with patch('sys.argv', ['import-itcg', '--output', str(output), '--sets', '3', '--inspect']), patch.object(importer, 'fetch', return_value=HTML), patch.object(importer.time, 'sleep'):
                importer.main()
            self.assertFalse(output.exists())

    def test_default_references_scans_without_downloading_or_hosting_art(self):
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / 'remote'
            with patch('sys.argv', ['import-itcg', '--output', str(output), '--sets', '1']), patch.object(importer, 'fetch', return_value=HTML) as fetch, patch.object(importer.time, 'sleep'):
                importer.main()
            self.assertEqual(fetch.call_count, 1)
            self.assertFalse((output / 'assets').exists())
            catalog = json.loads((output / 'catalog.json').read_text(encoding='utf-8'))
            self.assertEqual(catalog['cards'][0]['metadata']['image'], importer.SOURCE + '/uploads/2/3/2302393/01_orig.jpg')
            self.assertEqual(json.loads((output / 'sources.json').read_text())['mode'], 'remote')

    def test_redirects_are_rejected_before_following_an_untrusted_host(self):
        handler = importer.SourceRedirect()
        with self.assertRaises(ValueError):
            handler.redirect_request(None, None, 302, '', {}, 'https://other.invalid/art.jpg')
        for value in ['http://maplestoryitcg.weebly.com/a', importer.SOURCE + '/a?q=1', importer.SOURCE + '/a#fragment']:
            self.assertFalse(importer.source_url(value))

if __name__ == '__main__':
    unittest.main()
