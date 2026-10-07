#!/usr/bin/env python3
"""Build the metadata-only example from preserved local experiment artifacts.

Only reads/hashes existing files. Never invokes the saved raster commands.
Requires Python 3.10+; no third-party packages.
"""

import argparse
import hashlib
import json
from pathlib import Path

RUN_IDS = ("20261007T093734Z_horn_2787d459", "20261007T093742Z_zt_64ecf72b")
REPLAY_ID = "20261007T094003Z_horn_replay_0074404a"
PACKAGE = "Chongqing_Slope_Experiment_20261007"
ARCHIVE = "Chongqing_Slope_Reproducibility_20261007.zip"
DEFAULT_OUTPUT = Path(__file__).with_name("chongqing-slope.json")


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def require(condition, message):
    if not condition:
        raise ValueError(message)


class Verification:
    def __init__(self):
        self.files = set()
        self.assertions = 0

    def verify(self, path, sha256, size=None):
        digest = hashlib.sha256()
        with path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
        require(digest.hexdigest() == sha256, f"SHA-256 mismatch: {path.name}")
        if size is not None:
            require(path.stat().st_size == size, f"Size mismatch: {path.name}")
        self.files.add(path.resolve())
        self.assertions += 1

    def manifest(self, root, manifest):
        for record in manifest["files"]:
            relative = Path(record["path"])
            require(not relative.is_absolute() and ".." not in relative.parts,
                    "Manifest must contain safe relative paths")
            self.verify(root / relative, record["sha256"], record["size_bytes"])


def file_record(record):
    return {"name": record["filename"], "sha256": record["sha256"],
            "sizeBytes": record["size_bytes"]}


def convert_run(source, run_id, replay):
    run_dir = source / "runs" / run_id
    metadata = read_json(run_dir / "metadata.json")
    inp, out = metadata["input"], metadata["output"]
    stats = out["valid_pixel_stats"]
    notes = [
        metadata["source_surface"],
        "Source: runs/" + run_id + "/metadata.json; stdout.txt and stderr.txt are copied verbatim.",
        "The code hash identifies this run's saved code/run_slope.py snapshot.",
        "Command uses the saved {input}/{output} template; it is inert text in Cumora.",
        "Raster bytes and executable code are not included in this import.",
        "Vertical datum: " + metadata["vertical_datum"],
        "The input band has no embedded unit; metres are inherited from preserved source documentation.",
    ]
    if run_id == replay["original_run_id"]:
        notes.extend([
            "Recorded replay " + replay["replay_run_id"] + " reused the saved command template.",
            "Recorded replay: TIFF SHA-256 equal = " + str(replay["file_sha256_equal"]).lower()
            + "; pixel arrays including nodata identical = "
            + str(replay["pixel_arrays_identical_including_nodata"]).lower()
            + "; masks identical = " + str(replay["mask_identical"]).lower()
            + "; environment versions equal = " + str(replay["same_environment_versions"]).lower()
            + "; maximum absolute pixel difference (degrees) = "
            + str(replay["max_absolute_pixel_difference_degrees"]) + ".",
            "Replay output SHA-256: " + replay["replay_sha256"],
            replay["scope"],
            "Source: comparison_final/reproduction_verification.json. This import does not execute a replay.",
        ])
    else:
        notes.append("No separate Zevenbergen–Thorne replay is claimed by this example.")
    return {
        "id": run_id,
        "label": "Horn · 100 m" if metadata["algorithm"] == "Horn" else "Zevenbergen–Thorne · 100 m",
        "status": metadata["status"],
        "startedAt": metadata["start_utc"],
        "finishedAt": metadata["end_utc"],
        "inputs": [file_record(inp)],
        "code": {"name": "code/run_slope.py", "sha256": metadata["code_sha256"],
                 "sizeBytes": (run_dir / "code/run_slope.py").stat().st_size},
        "parameters": {
            "algorithm": metadata["algorithm"], "operation": metadata["operation"],
            "slope_units": metadata["units"], "elevation_units": metadata["vertical_units"],
            "scale": metadata["scale"], "compute_edges": metadata["compute_edges"],
            "nodata_policy": metadata["nodata_policy"],
            "input_width_pixels": inp["width"], "input_height_pixels": inp["height"],
            "pixel_width_m": inp["pixel_size_metres"][0], "pixel_height_m": inp["pixel_size_metres"][1],
            "input_dtype": inp["dtype"], "input_nodata_m": inp["nodata"],
            "input_band_unit_embedded": inp["band_unit_embedded"],
            "horizontal_unit": inp["horizontal_unit_name"], "crs_proj4": inp["crs_proj4"],
            "output_dtype": out["dtype"], "output_nodata": out["nodata"],
        },
        "environment": {key: metadata["environment"][key] for key in (
            "python", "platform", "gdal", "gdal_version_number", "proj", "numpy",
            "GDAL_NUM_THREADS", "GDAL_PAM_ENABLED")},
        "command": metadata["command_template"],
        "logs": {"stdout": (run_dir / "stdout.txt").read_text(encoding="utf-8"),
                 "stderr": (run_dir / "stderr.txt").read_text(encoding="utf-8"),
                 "exitCode": metadata["exit_status"]},
        "results": {
            "valid_pixel_count": out["valid_pixel_count"], "nodata_pixel_count": out["nodata_pixel_count"],
            **{f"slope_{key}_degrees": stats[key] for key in ("min", "max", "mean", "stddev_population", "p50", "p95")},
            "percentile_method": stats["percentile_method"], **metadata["checks"],
        },
        "outputs": [file_record(out)], "notes": notes,
    }


def convert(source):
    verification = Verification()
    package = source / "bundle" / PACKAGE
    delivery = read_json(source / "deliverables.json")
    verification.verify(source / ARCHIVE, delivery["archive"]["sha256"], delivery["archive"]["bytes"])
    verification.manifest(package, read_json(package / "bundle_manifest.json"))
    provenance = read_json(source / "provenance/input_provenance.json")
    comparison = read_json(source / "comparison_final/comparison.json")
    replay = read_json(source / "comparison_final/reproduction_verification.json")
    # Verify that source records used below equal their authenticated bundle copies.
    for relative, archived in (
        ("provenance/input_provenance.json", "provenance/input_provenance.json"),
        ("comparison_final/comparison.json", "comparison/comparison.json"),
        ("comparison_final/reproduction_verification.json", "comparison/reproduction_verification.json"),
        ("comparison_final/tile_manifest.json", "comparison/tile_manifest.json"),
    ):
        require((source / relative).read_bytes() == (package / archived).read_bytes(),
                f"Source and archived record differ: {relative}")
    verification.verify(source / "input/chongqing_dem_100m.tif", provenance["input_sha256"], provenance["input_size_bytes"])
    verification.verify(source / "compare_slope.py", comparison["code_sha256"])
    require(comparison["run_ids"] == list(RUN_IDS), "Unexpected comparison run pair")
    require(comparison["input_sha256"] == provenance["input_sha256"], "Comparison input differs")
    require(replay["original_run_id"] == RUN_IDS[0] and replay["replay_run_id"] == REPLAY_ID,
            "Unexpected replay run pair")
    for category, run_id in [("runs", run_id) for run_id in RUN_IDS] + [("verification", REPLAY_ID)]:
        run_dir = source / category / run_id
        verification.manifest(run_dir, read_json(run_dir / "manifest.json"))
        for name in ("metadata.json", "manifest.json"):
            require((run_dir / name).read_bytes() == (package / category / run_id / name).read_bytes(),
                    f"Source and archived record differ: {run_id}/{name}")
        metadata = read_json(run_dir / "metadata.json")
        require(metadata["run_id"] == run_id, "Run ID differs from source directory")
        require(metadata["input"]["sha256"] == provenance["input_sha256"], "Run input differs")
        verification.verify(run_dir / "code/run_slope.py", metadata["code_sha256"])
        verification.verify(run_dir / "slope_degrees.tif", metadata["output"]["sha256"], metadata["output"]["size_bytes"])
    verification.verify(source / "runs" / RUN_IDS[0] / "slope_degrees.tif", replay["original_sha256"])
    verification.verify(source / "verification" / REPLAY_ID / "slope_degrees.tif", replay["replay_sha256"])
    # Verify available separately delivered TIFF files too; no tile bytes enter the fixture.
    for tile in read_json(source / "comparison_final/tile_manifest.json")["tiles"]:
        verification.verify(source / "comparison_final" / tile["filename"], tile["sha256"], tile["size_bytes"])
    metrics = {
        "common_valid_pixels": comparison["common_valid_pixels"],
        "common_grid_area_km2": comparison["common_grid_area_km2"],
        "same_valid_mask": comparison["same_valid_mask"],
        "rmse_degrees": comparison["rmse_degrees"],
        "proportion_absolute_difference_gt_1_degree": comparison["proportion_absolute_difference_gt_1_degree"],
        "proportion_absolute_difference_gt_5_degrees": comparison["proportion_absolute_difference_gt_5_degrees"],
    }
    for group in ("absolute_difference", "signed_difference_zt_minus_horn"):
        metrics.update({f"{group}_{key}_degrees": comparison[group][key]
                        for key in ("min", "max", "mean", "stddev_population", "p50", "p95")})
    bundle = {
        "schemaVersion": 1,
        "title": "Chongqing slope: Horn vs Zevenbergen–Thorne",
        "description": "Two real GDAL slope runs on the same preserved 100 m DSM, with recorded comparison metrics and a verified Horn replay. Metadata only; Cumora does not execute raster commands.",
        "provenance": [
            provenance["source_dataset"], provenance["coverage"], provenance["prior_processing"],
            provenance["reproduction_boundary"],
            "The input is a previously resampled and Int16-quantised DSM, not a native 100 m terrain DTM.",
            "Input, output, and source raster tile bytes are absent from this repository fixture.",
            "The archived Horn replay was verified on Linux/GDAL 3.10.3 only. Windows execution was not verified.",
            provenance["source_timestamp_note"],
            "Source archive: " + ARCHIVE + "; SHA-256: " + delivery["archive"]["sha256"],
            *provenance["source_urls"], provenance["boundary_url"],
        ],
        "runs": [convert_run(source, run_id, replay) for run_id in RUN_IDS],
        "comparisons": [{
            "leftRunId": RUN_IDS[0], "rightRunId": RUN_IDS[1],
            "label": "Horn vs Zevenbergen–Thorne · common valid pixels",
            "metrics": metrics,
            "notes": [
                comparison["interpretation"],
                "Signed differences are Zevenbergen–Thorne minus Horn; proportions are fractions from 0 to 1.",
                "Percentile method: " + comparison["absolute_difference"]["percentile_method"],
                "Source: comparison_final/comparison.json, generated " + comparison["generated_utc"],
                "Comparison code SHA-256: " + comparison["code_sha256"],
                "Recorded metrics are imported without rerunning raster processing or validating against surveyed terrain.",
            ],
        }],
    }
    return bundle, verification


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="Local directory of the complete preserved experiment")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--check", action="store_true", help="Verify sources and require identical existing output; do not write")
    args = parser.parse_args()
    bundle, verification = convert(args.source)
    encoded = (json.dumps(bundle, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode("utf-8")
    require(len(encoded) < 256 * 1024, "Fixture exceeds the 256 KiB API body limit")
    text = encoded.decode("utf-8")
    for private_marker in ("/workspace/", "/home/", "/Users/", "libfile_", "input_library_id", "command_argv"):
        require(private_marker not in text, f"Private source field leaked: {private_marker}")
    if args.check:
        require(args.output.read_bytes() == encoded, "Fixture differs; rerun without --check to regenerate")
    else:
        args.output.write_bytes(encoded)
    print(json.dumps({"fixture_bytes": len(encoded), "fixture_sha256": hashlib.sha256(encoded).hexdigest(),
                      "sha256_checks_passed": verification.assertions,
                      "unique_local_files_hashed": len(verification.files),
                      "runs": len(bundle["runs"]), "comparisons": len(bundle["comparisons"]),
                      "mode": "check" if args.check else "write"}, indent=2))


if __name__ == "__main__":
    main()
