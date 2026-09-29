"""Platform requirements for durable, process-shared worker storage."""

import os
from types import ModuleType


def require_posix_file_locks() -> ModuleType:
    """Load real POSIX locking only when a cache or index writer needs it."""
    if os.name != "posix" or not hasattr(os, "O_NOFOLLOW"):
        raise RuntimeError(
            "Worker cache/index writes require POSIX fcntl.flock and O_NOFOLLOW; "
            "run this operation in the Linux worker container."
        )
    import fcntl

    return fcntl
