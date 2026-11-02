#!/usr/bin/env python3
"""Create transparent Miles pose cutouts from the approved square renders.

The source files in ``public/miles`` are RGB WebP images with a nearly
uniform warm off-white studio background baked in.  This script does not
redraw or regenerate any artwork.  For each pose it:

1. estimates the background from the median colour of the four corner
   patches;
2. labels connected pixels whose Euclidean RGB distance from that colour
   is below the pose tolerance;
3. makes only the labelled regions connected to an image border
   transparent (so similarly pale details enclosed by the subject, such
   as the white T-shirt, remain opaque);

Two refinements, both forced by how the renders are framed:

* Border seeding uses the top, left, and right edges only.  The bust is
  cropped by the bottom edge of the square, so pale subject pixels that
  touch the bottom row (the white T-shirt, in every pose) are subject,
  not backdrop — seeding from the bottom eats a strip out of the shirt
  (worst in ``thinking``: a 17k-pixel strip).  Genuine backdrop along
  the bottom edge wraps around the sides and is still reached.
* The candidate mask is dilated by 2 px before labelling.  A few
  backdrop pockets are sealed off from the exterior backdrop by
  hairline seams — a soft shadow the subject casts on the backdrop, an
  anti-aliased edge — and would otherwise survive as cream wedges.
  Two pixels of dilation bridges those seams; real barriers (jacket
  panels, lips, fingers) are far thicker and still protect the pale
  subject details inside them.
* Two backdrop pockets are sealed by subject overlap, not hairlines,
  and no dilation bridges them: the diagonal gap between forearm and
  torso in ``pointing`` (it opens only below the bottom edge of the
  frame) and the wedge between thumb and hair in ``wave``.  These get
  explicit extra flood-fill seeds (EXTRA_BACKDROP_SEEDS below): the
  candidate component containing a seed is backdrop by declaration.
  The seeds are points verified to sit inside those pockets.
* Finally, any opaque component that is detached from the subject,
  small (<= 30,000 px), and backdrop-coloured on average (mean RGB
  distance < 60) is removed.  Everything that is really Miles is one
  connected component — hands, watch, and pendant all join the torso —
  so a detached pale speck can only be backdrop texture noise or a
  backdrop sliver at the frame edge.
4. colour-decontaminates and lightly feathers the resulting alpha edge;
   and
5. crops to the subject's alpha bounding box with 2% padding.

The generated files are named ``miles-<pose>-cut.webp`` beside the
untouched originals.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage


POSES = (
    "idle",
    "speaking",
    "listening",
    "thinking",
    "wave",
    "pointing",
    "liked",
)

# Parent-verified default from the idle proof: Euclidean RGB distance
# below 26 from the corner-median background.  Keep this table explicit:
# if a pose needs a different value, put it here rather than changing the
# global default silently.  No per-pose deviations are currently needed.
DEFAULT_TOLERANCE = 26.0
TOLERANCES: dict[str, float] = {}

# A 1.2-pixel Gaussian is enough to remove the hard sticker edge while
# retaining the hand, fingers, hair, and glasses geometry at phone size.
FEATHER_SIGMA = 1.2

# KNOWN LIMITATION (deliberate): in ``wave``, the backdrop visible
# through the crook of the raised arm (roughly x 360-540, y 520-850)
# survives.  Its candidate component is fused with the palm's pale
# highlights — the skin meets the backdrop along a soft shadow
# gradient with no non-candidate seam — so declaring that component
# backdrop would punch a hole in the palm.  A cream pocket was judged
# less bad than a holed palm: on the app's cream surfaces it reads as
# sky.  If it ever bothers anyone in situ, it wants a hand-painted
# alpha touch-up, not a threshold change.
#
# Extra flood-fill seeds for backdrop pockets sealed by subject
# overlap (see the module docstring).  Coordinates are (x, y) in the
# 1600x1600 source frame, verified to sit inside the pocket's
# candidate component:
#   pointing (355, 1520) — the diagonal backdrop gap between the
#     lowered forearm and the torso; it reaches the outside only
#     below the bottom edge of the frame.
#   wave (450, 335) and (470, 430) — the backdrop pocket between the
#     raised hand and the head, in two candidate components split by
#     a hair strand: the wedge above the thumb, and the larger area
#     between thumb, ear, and sleeve.
EXTRA_BACKDROP_SEEDS: dict[str, list[tuple[int, int]]] = {
    "pointing": [(355, 1520)],
    "wave": [(450, 335), (470, 430)],
}


def corner_median(rgb: np.ndarray) -> np.ndarray:
    """Return the median RGB colour across four 64x64 corner patches."""
    h, w, _ = rgb.shape
    patch = min(64, h, w)
    corners = np.concatenate(
        (
            rgb[:patch, :patch].reshape(-1, 3),
            rgb[:patch, -patch:].reshape(-1, 3),
            rgb[-patch:, :patch].reshape(-1, 3),
            rgb[-patch:, -patch:].reshape(-1, 3),
        ),
        axis=0,
    )
    return np.median(corners, axis=0)


def make_cutout(
    source: Path, destination: Path, tolerance: float, pose: str
) -> dict[str, object]:
    image = Image.open(source).convert("RGB")
    rgb = np.asarray(image).astype(np.float32)
    height, width, _ = rgb.shape
    background = corner_median(rgb)

    distance = np.sqrt(np.sum((rgb - background) ** 2, axis=2))
    background_like = distance < tolerance

    # Connected-component labelling is the flood fill: candidate regions
    # are background only when their component touches a seeded border.
    # Seeding is top/left/right only, and labelling runs on a 2 px
    # dilation of the candidate mask — see the module docstring for why
    # both refinements are needed.  A candidate pixel inherits the
    # label of the dilated component it belongs to.
    structure = np.array([[0, 1, 0], [1, 1, 1], [0, 1, 0]], dtype=int)
    dilated = ndimage.binary_dilation(background_like, iterations=2)
    labels, _ = ndimage.label(dilated, structure=structure)
    border_labels = np.unique(
        np.concatenate((labels[0, :], labels[:, 0], labels[:, -1]))
    )
    border_labels = border_labels[border_labels != 0]
    # Declared extra seeds: the candidate component containing a seed
    # point is backdrop even though subject overlap seals it off from
    # every seeded border.
    seed_labels = []
    for seed_x, seed_y in EXTRA_BACKDROP_SEEDS.get(pose, []):
        if not background_like[seed_y, seed_x] or labels[seed_y, seed_x] == 0:
            raise RuntimeError(
                f"Extra backdrop seed {(seed_x, seed_y)} for {pose} does "
                "not sit inside a background-like component"
            )
        seed_labels.append(int(labels[seed_y, seed_x]))
    if seed_labels:
        border_labels = np.unique(
            np.concatenate((border_labels, np.array(seed_labels)))
        )
    reached_background = background_like & np.isin(labels, border_labels)

    alpha = np.where(reached_background, 0.0, 255.0).astype(np.float32)

    # Detached-component cleanup (see docstring): Miles is a single
    # connected component, so a small, backdrop-coloured opaque island
    # detached from him is backdrop noise, never a body part.
    opaque_labels, _ = ndimage.label(
        alpha >= 128.0, structure=np.ones((3, 3), dtype=int)
    )
    opaque_sizes = np.bincount(opaque_labels.ravel())
    opaque_sizes[0] = 0
    subject_label = int(np.argmax(opaque_sizes))
    removed: list[dict[str, float]] = []
    for label_id in range(1, len(opaque_sizes)):
        if label_id == subject_label or opaque_sizes[label_id] > 30_000:
            continue
        component = opaque_labels == label_id
        mean_distance = float(
            np.sqrt(
                np.sum((rgb[component].mean(axis=0) - background) ** 2)
            )
        )
        if mean_distance < 60.0:
            alpha[component] = 0.0
            removed.append(
                {
                    "pixels": int(opaque_sizes[label_id]),
                    "mean_distance": round(mean_distance, 1),
                }
            )
    cleanup_stats = {
        "components_removed": len(removed),
        "pixels_removed": sum(int(r["pixels"]) for r in removed),
        "largest_removed": max((int(r["pixels"]) for r in removed), default=0),
    }

    subject_coverage = float(np.mean(alpha >= 128.0) * 100.0)

    # Feather only after the hard flood-fill decision.  Gaussian spill
    # below the crop threshold is ignored when finding the subject box.
    feathered_alpha = ndimage.gaussian_filter(alpha, sigma=FEATHER_SIGMA)
    feathered_alpha = np.clip(feathered_alpha, 0.0, 255.0)

    # Crop to the MAIN subject component, not to every opaque pixel.
    # The studio backdrop has a fine texture, so a handful of backdrop
    # pixels land just beyond the flood-fill tolerance and survive as
    # isolated opaque specks (single digits to ~150 px, versus ~1.1M px
    # for Miles himself).  They are invisible at display size, but if
    # one sits in a corner it would poison the bounding box and the
    # corner-alpha check.  Miles is one connected component in every
    # pose (arms, hands, watch, and pendant all connect to the torso),
    # so the largest component is the subject.
    component_labels, _ = ndimage.label(
        feathered_alpha > 4.0,
        structure=np.ones((3, 3), dtype=int),
    )
    component_sizes = np.bincount(component_labels.ravel())
    component_sizes[0] = 0
    main_component = int(np.argmax(component_sizes))
    ys, xs = np.where(component_labels == main_component)
    if len(xs) == 0 or len(ys) == 0:
        raise RuntimeError(f"No subject remained after cutting out {source}")

    x0, x1 = int(xs.min()), int(xs.max())
    y0, y1 = int(ys.min()), int(ys.max())
    bbox_w = x1 - x0 + 1
    bbox_h = y1 - y0 + 1
    pad_x = max(1, round(bbox_w * 0.02))
    pad_y = max(1, round(bbox_h * 0.02))
    crop_box = (
        max(0, x0 - pad_x),
        max(0, y0 - pad_y),
        min(width, x1 + pad_x + 1),
        min(height, y1 + pad_y + 1),
    )

    # The source edge pixels are the subject colour composited over the
    # known background.  Undo that contribution on semi-transparent edge
    # pixels so a cream fringe does not reappear over ink or sage.
    alpha_fraction = (feathered_alpha / 255.0)[..., None]
    decontaminated = rgb.copy()
    partial = (alpha_fraction[..., 0] > 0.0) & (alpha_fraction[..., 0] < 1.0)
    if np.any(partial):
        a = alpha_fraction[partial]
        decontaminated[partial] = np.clip(
            (rgb[partial] - (1.0 - a) * background) / np.maximum(a, 1.0 / 255.0),
            0.0,
            255.0,
        )

    rgba = np.dstack((decontaminated, feathered_alpha)).astype(np.uint8)
    cutout = Image.fromarray(rgba, mode="RGBA").crop(crop_box)
    destination.parent.mkdir(parents=True, exist_ok=True)
    # High-quality lossy WebP preserves alpha and keeps the seven-pose
    # payload close to the originals; exact colour is less important here
    # than a clean alpha edge at phone scale.
    cutout.save(destination, format="WEBP", lossless=False, quality=95, method=6)

    saved = Image.open(destination)
    saved_alpha = np.asarray(saved.getchannel("A"))
    corners = [
        int(saved_alpha[0, 0]),
        int(saved_alpha[0, -1]),
        int(saved_alpha[-1, 0]),
        int(saved_alpha[-1, -1]),
    ]
    if saved.mode != "RGBA" or any(value != 0 for value in corners):
        raise RuntimeError(
            f"Saved cutout failed alpha verification for {destination}: "
            f"mode={saved.mode}, corners={corners}"
        )

    return {
        "pose": source.stem.removeprefix("miles-"),
        "source_size": [width, height],
        "background_rgb": [round(float(v), 1) for v in background],
        "tolerance": tolerance,
        "extra_backdrop_seeds": EXTRA_BACKDROP_SEEDS.get(pose, []),
        "detached_cleanup": cleanup_stats,
        "subject_coverage_pct_alpha_ge_128": round(subject_coverage, 2),
        "main_component_pixels": int(component_sizes[main_component]),
        "alpha_bbox_before_crop": [x0, y0, x1, y1],
        "crop_box": list(crop_box),
        "output": str(destination),
        "output_size": list(saved.size),
        "corner_alpha": corners,
        "output_bytes": destination.stat().st_size,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--public-dir",
        type=Path,
        default=Path(__file__).resolve().parents[2] / "public" / "miles",
        help="Directory containing miles-<pose>.webp files",
    )
    parser.add_argument(
        "--pose",
        choices=POSES,
        action="append",
        dest="poses",
        help="Generate one pose (may be repeated); default is all poses",
    )
    args = parser.parse_args()

    reports = []
    for pose in args.poses or POSES:
        source = args.public_dir / f"miles-{pose}.webp"
        destination = args.public_dir / f"miles-{pose}-cut.webp"
        tolerance = TOLERANCES.get(pose, DEFAULT_TOLERANCE)
        reports.append(make_cutout(source, destination, tolerance, pose))

    print(json.dumps(reports, indent=2))


if __name__ == "__main__":
    main()
