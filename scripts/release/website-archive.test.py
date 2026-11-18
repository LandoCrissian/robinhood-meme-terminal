import importlib.util
from pathlib import Path
import stat
import sys
import unittest
import zipfile

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("website_archive", Path(__file__).with_name("website-archive.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def entry(name, value=b"", link=False):
    item = zipfile.ZipInfo(name)
    item.external_attr = ((stat.S_IFLNK | 0o777) if link else (stat.S_IFREG | 0o644)) << 16
    return item, value


class ArchiveBoundaries(unittest.TestCase):
    def test_relative_in_archive_link(self):
        self.assertEqual(module.inspect_entries([entry("node_modules/module/file.js"), entry("node_modules/alias", b"module", True)]), [("node_modules/alias", "module")])

    def test_unsafe_or_missing_links_and_duplicate_paths_rejected(self):
        for target in (b"/tmp/private", b"C:\\Users\\private", b"../../../private", b"missing"):
            with self.subTest(target=target), self.assertRaises(AssertionError):
                module.inspect_entries([entry("node_modules/alias", target, True)])
        with self.assertRaises(AssertionError):
            module.inspect_entries([entry("same"), entry("same")])
        with self.assertRaises(AssertionError):
            module.inspect_entries([entry("../private")])


if __name__ == "__main__":
    unittest.main()
