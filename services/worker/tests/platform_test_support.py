"""Explicit prerequisites for tests exercising the Linux worker storage."""

import os
import unittest


requires_posix_storage = unittest.skipUnless(
    os.name == "posix" and hasattr(os, "O_NOFOLLOW"),
    "POSIX worker storage requires real fcntl.flock and O_NOFOLLOW; run on Linux",
)
