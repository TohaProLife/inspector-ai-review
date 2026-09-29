import os
import unittest
from unittest.mock import patch

from inspector_worker.platform_support import require_posix_file_locks


class PlatformSupportTests(unittest.TestCase):
    def test_unsupported_platform_refuses_storage_mutations(self):
        with patch("inspector_worker.platform_support.os.name", "nt"):
            with self.assertRaisesRegex(RuntimeError, "Linux worker container"):
                require_posix_file_locks()

    @unittest.skipUnless(os.name == "posix", "Real fcntl locking requires the POSIX worker host")
    def test_supported_platform_uses_real_fcntl(self):
        import fcntl

        self.assertIs(require_posix_file_locks(), fcntl)
