"""Offline checks; no SSH or Move files used."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('project_probe', Path(__file__).parents[1] / 'scripts/probe-twain-project.py')
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)
A = 'b073d20f-bd7c-4ebe-8a2a-b4e81f7cb654'
B = '01190092-7038-4282-afeb-85e90d2cd963'


class SnapshotTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.base = self.root / 'data/UserData'
        (self.base / 'settings').mkdir(parents=True)
        (self.base / 'settings/Settings.json').write_text(json.dumps({'currentSongIndex': 3}))
        (self.base / 'schwung').mkdir()
        (self.base / 'schwung/active_set.txt').write_text(A + '\nTest')
        for uid in [A, B]:
            folder = self.base / 'UserLibrary/Sets' / uid / 'Test'
            folder.mkdir(parents=True)
            (folder / 'Song.abl').write_bytes(b'same-size-and-content')

    def capture(self, positions=None):
        positions = positions or {A: 3, B: 7}
        with patch.object(probe.os, 'getxattr', create=True, side_effect=lambda path, key: str(positions[path.name]).encode()):
            return probe.snapshot(self.root)

    def test_matched_identity_is_disk_evidence_only(self):
        result = self.capture()
        self.assertTrue(result['disk_sources_agree'])
        self.assertIn('not observed', result['live_document_alignment'])
        self.assertEqual(result['native_matches'], [A])
        self.assertTrue(all(p['copy_source'] is None for p in result['projects']))

    def test_wrong_or_ambiguous_mapping_is_not_consistent(self):
        self.assertFalse(self.capture({A: 7, B: 3})['disk_sources_agree'])
        self.assertFalse(self.capture({A: 3, B: 3})['disk_sources_agree'])

    def test_move_preserves_id_when_position_changes(self):
        before = self.capture()
        (self.base / 'settings/Settings.json').write_text(json.dumps({'currentSongIndex': 9}))
        after = self.capture({A: 9, B: 7})
        self.assertTrue(after['disk_sources_agree'])
        self.assertEqual(before['native_matches'], after['native_matches'])

    def test_transition_is_not_consistent(self):
        with patch.object(probe, 'read_index', side_effect=[3, 7]):
            self.assertFalse(self.capture()['disk_sources_agree'])

    def test_explicit_copy_marker_is_not_a_hash_guess(self):
        folder = self.base / 'schwung/set_state' / B
        folder.mkdir(parents=True)
        (folder / 'copy_source.txt').write_text(A)
        result = self.capture()
        self.assertEqual(next(p for p in result['projects'] if p['id'] == B)['copy_source'], A)


if __name__ == '__main__':
    unittest.main()
