"""
VM/CT flavor presets ("T-Shirt sizes" for the LabCloud portal).

They mirror section 7 of `docs/LabCloud_Plan.md`. Keep them here (and not in the
database) so that the sizes are easy to change in code – that was the whole point
of forking this project.

Each preset is a starting point: the user may still pick "Custom" and choose any
size inside the organization quota.
"""
from typing import Any, Dict, List, Optional

from app.core.config import settings

# Storage used for the boot disk of a preset VM. Prefer the fast pool.
DEFAULT_BOOT_STORAGE = "fast-local"

# Allowed ranges for "Custom" VMs. The real upper bound is the organization quota,
# these are absolute safety limits so nobody can request 4 TB by accident.
MIN_CORES = 1
MAX_CORES = 64
MIN_MEMORY_MB = 512
MAX_MEMORY_MB = 262144
MIN_DISK_GB = 10
MAX_DISK_GB = 1024

FLAVORS: List[Dict[str, Any]] = [
    {
        "id": "lxc-small",
        "label": "LXC Small",
        "description": "Kleine Container-Workload, Ubuntu LTS",
        "cpu_cores": 2,
        "memory_mb": 2048,
        "disk_gb": 20,
        "storage_pool": DEFAULT_BOOT_STORAGE,
        "vm_type": "lxc",
        "os_type": "linux",
    },
    {
        "id": "vm-small",
        "label": "VM Small",
        "description": "Webserver, kleine Dienste",
        "cpu_cores": 2,
        "memory_mb": 4096,
        "disk_gb": 40,
        "storage_pool": DEFAULT_BOOT_STORAGE,
        "vm_type": "qemu",
        "os_type": "linux",
    },
    {
        "id": "vm-medium",
        "label": "VM Medium",
        "description": "Datenbank, Anwendungen mit mehr Last",
        "cpu_cores": 4,
        "memory_mb": 8192,
        "disk_gb": 80,
        "storage_pool": DEFAULT_BOOT_STORAGE,
        "vm_type": "qemu",
        "os_type": "linux",
    },
    {
        "id": "vm-large",
        "label": "VM Large",
        "description": "Große Anwendungen (Obergrenze fast-local pro VM: 150 GB)",
        "cpu_cores": 8,
        "memory_mb": 16384,
        "disk_gb": 150,
        "storage_pool": DEFAULT_BOOT_STORAGE,
        "vm_type": "qemu",
        "os_type": "linux",
    },
]

# Optional additional volume on the capacity pool (section 7, "Zusatzvolume")
EXTRA_VOLUMES: List[Dict[str, Any]] = [
    {"id": "cap-100", "label": "100 GB capacity-nfs", "size_gb": 100, "storage_pool": "capacity-nfs"},
    {"id": "cap-250", "label": "250 GB capacity-nfs", "size_gb": 250, "storage_pool": "capacity-nfs"},
]


def get_flavor(flavor_id: str) -> Optional[Dict[str, Any]]:
    """Return a preset by id or None."""
    for flavor in FLAVORS:
        if flavor["id"] == flavor_id:
            return flavor
    return None


def get_extra_volume(volume_id: str) -> Optional[Dict[str, Any]]:
    for volume in EXTRA_VOLUMES:
        if volume["id"] == volume_id:
            return volume
    return None


def _default_lxc_template() -> Optional[int]:
    """Optional: VMID of a default LXC template used for LXC presets."""
    value = getattr(settings, "DEFAULT_LXC_TEMPLATE_VMID", None) or 9001
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def flavor_catalog() -> List[Dict[str, Any]]:
    """Flavors enriched with runtime defaults (e.g. the LXC template VMID)."""
    catalog: List[Dict[str, Any]] = []
    for flavor in FLAVORS:
        item = dict(flavor)
        if item.get("vm_type") == "lxc":
            item["template_vmid"] = _default_lxc_template()
        catalog.append(item)
    return catalog
